"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  DEFAULT_EAVE_PARAMETERS,
  EaveDetailEditor,
  EaveDetailPreview,
  SYSTEM_LABELS,
} from "./EaveDetailEditor";
import type {
  EaveDetailDraft,
  EaveParameters,
  RoofSystemType,
} from "./EaveDetailEditor";

type RoofKind = "gable" | "hip" | "shed";
type ViewMode = "split" | "plan" | "form";
type DrawCommand = "select" | "walls" | "roof";
type EaveDriver = "heel" | "seat";
type Point2 = { x: number; z: number };
type Point3 = { x: number; y: number; z: number };
type ScreenPoint = { x: number; y: number };
type DepthPoint = ScreenPoint & { depth: number };
type DepthSurface = {
  points: DepthPoint[];
  fill: string;
  stroke: string;
  lineWidth: number;
};
type DepthLine = {
  points: DepthPoint[];
  stroke: string;
  lineWidth: number;
};
type EaveCondition = {
  id: string;
  name: string;
  systemType: RoofSystemType;
  parameters: EaveParameters;
  driver: EaveDriver;
  height: number;
  inset: number;
};
type EdgeRelationship = {
  conditionId: string;
  elevationOffset: number;
};
type Room = {
  id: string;
  name: string;
};
type Ceiling = {
  id: string;
  roomId: string;
  bottomOfFramingElevationFeet: number;
  framingThicknessInches: number;
  finishThicknessInches: number;
};
type Selection =
  | { kind: "wall"; index: number }
  | { kind: "ceiling"; id: string }
  | { kind: "roof" }
  | { kind: "roof-edge"; index: number }
  | { kind: "catalog"; id: string }
  | null;

const INITIAL_WALL_POINTS: Point2[] = [
  { x: -14, z: -20 },
  { x: 14, z: -20 },
  { x: 14, z: 20 },
  { x: -14, z: 20 },
];

const INITIAL_ROOF_POINTS: Point2[] = [
  { x: -16, z: -22 },
  { x: 16, z: -22 },
  { x: 16, z: 22 },
  { x: -16, z: 22 },
];

const PRIMARY_ROOM: Room = { id: "room-1", name: "Room 1" };
const CEILING_FRAMING_THICKNESS_INCHES = 3.5;
const CEILING_FINISH_THICKNESS_INCHES = 0.5;

const INITIAL_EAVE_CONDITIONS: EaveCondition[] = [
  {
    id: "rafter-seat",
    name: "Rafter · standard birdsmouth",
    systemType: "rafter",
    parameters: { ...DEFAULT_EAVE_PARAMETERS },
    driver: "seat",
    height: DEFAULT_EAVE_PARAMETERS.rafterDepth / 12,
    inset: DEFAULT_EAVE_PARAMETERS.seatCut / 12,
  },
  {
    id: "raised-heel",
    name: "Raised heel · standard",
    systemType: "raisedHeelTruss",
    parameters: { ...DEFAULT_EAVE_PARAMETERS },
    driver: "heel",
    height: DEFAULT_EAVE_PARAMETERS.heelHeight / 12,
    inset: 0,
  },
  {
    id: "cantilevered-raised-heel",
    name: "Cantilevered raised heel · standard",
    systemType: "cantileveredRaisedHeelTruss",
    parameters: { ...DEFAULT_EAVE_PARAMETERS, overhang: 14 },
    driver: "heel",
    height: DEFAULT_EAVE_PARAMETERS.heelHeight / 12,
    inset: 0,
  },
  {
    id: "common-truss",
    name: "Common truss · standard",
    systemType: "commonTruss",
    parameters: { ...DEFAULT_EAVE_PARAMETERS },
    driver: "heel",
    height: DEFAULT_EAVE_PARAMETERS.topChordDepth / 12,
    inset: 0,
  },
];

const ROOF_FORMS: Record<RoofKind, { label: string; description: string }> = {
  hip: {
    label: "Hip",
    description: "Each boundary edge contributes a roof plane.",
  },
  gable: {
    label: "Gable",
    description: "Boundary planes resolve toward a central ridge.",
  },
  shed: {
    label: "Shed",
    description: "One broad plane crosses the authored boundary.",
  },
};

function feetInches(value: number) {
  const sign = value < 0 ? "−" : "";
  const absolute = Math.abs(value);
  let feet = Math.floor(absolute);
  let inches = Math.round((absolute - feet) * 12);
  if (inches === 12) {
    feet += 1;
    inches = 0;
  }
  return `${sign}${feet}′ ${inches}″`;
}

function segmentLength(start: Point2, end: Point2) {
  return Math.hypot(end.x - start.x, end.z - start.z);
}

function midpoint(start: Point2, end: Point2): Point2 {
  return { x: (start.x + end.x) / 2, z: (start.z + end.z) / 2 };
}

function pointToSegmentDistance(point: Point2, start: Point2, end: Point2) {
  const deltaX = end.x - start.x;
  const deltaZ = end.z - start.z;
  const lengthSquared = deltaX * deltaX + deltaZ * deltaZ;
  if (lengthSquared === 0) {
    return Math.hypot(point.x - start.x, point.z - start.z);
  }
  const amount = Math.max(
    0,
    Math.min(
      1,
      ((point.x - start.x) * deltaX + (point.z - start.z) * deltaZ) /
        lengthSquared,
    ),
  );
  return Math.hypot(
    point.x - (start.x + amount * deltaX),
    point.z - (start.z + amount * deltaZ),
  );
}

function prepareCanvas(canvas: HTMLCanvasElement) {
  const rect = canvas.getBoundingClientRect();
  const ratio = window.devicePixelRatio || 1;
  canvas.width = Math.round(rect.width * ratio);
  canvas.height = Math.round(rect.height * ratio);
  const context = canvas.getContext("2d");
  if (!context) return null;
  context.setTransform(ratio, 0, 0, ratio, 0, 0);
  context.clearRect(0, 0, rect.width, rect.height);
  return { context, width: rect.width, height: rect.height };
}

function drawPolygon(
  context: CanvasRenderingContext2D,
  points: ScreenPoint[],
  fill: string,
  stroke: string,
  lineWidth = 1,
) {
  if (points.length < 3) return;
  context.beginPath();
  context.moveTo(points[0].x, points[0].y);
  points.slice(1).forEach((point) => context.lineTo(point.x, point.y));
  context.closePath();
  context.fillStyle = fill;
  context.fill();
  context.strokeStyle = stroke;
  context.lineWidth = lineWidth;
  context.stroke();
}

function hexColor(value: string) {
  const normalized = value.replace("#", "");
  const expanded =
    normalized.length === 3
      ? normalized
          .split("")
          .map((character) => `${character}${character}`)
          .join("")
      : normalized;
  const parsed = Number.parseInt(expanded, 16);
  return {
    red: (parsed >> 16) & 255,
    green: (parsed >> 8) & 255,
    blue: parsed & 255,
  };
}

function triangleContainsPoint(
  point: ScreenPoint,
  first: ScreenPoint,
  second: ScreenPoint,
  third: ScreenPoint,
) {
  const sign = (a: ScreenPoint, b: ScreenPoint, c: ScreenPoint) =>
    (a.x - c.x) * (b.y - c.y) - (b.x - c.x) * (a.y - c.y);
  const firstSign = sign(point, first, second);
  const secondSign = sign(point, second, third);
  const thirdSign = sign(point, third, first);
  const hasNegative = firstSign < -0.001 || secondSign < -0.001 || thirdSign < -0.001;
  const hasPositive = firstSign > 0.001 || secondSign > 0.001 || thirdSign > 0.001;
  return !(hasNegative && hasPositive);
}

function triangulateDepthPolygon(points: DepthPoint[]) {
  if (points.length < 3) return [] as [number, number, number][];
  const signedArea = points.reduce((area, point, index) => {
    const next = points[(index + 1) % points.length];
    return area + point.x * next.y - next.x * point.y;
  }, 0);
  const orientation = signedArea >= 0 ? 1 : -1;
  const remaining = points.map((_, index) => index);
  const triangles: [number, number, number][] = [];
  let guard = points.length * points.length;

  while (remaining.length > 3 && guard > 0) {
    guard -= 1;
    let clipped = false;
    for (let index = 0; index < remaining.length; index += 1) {
      const previousIndex =
        remaining[(index + remaining.length - 1) % remaining.length];
      const currentIndex = remaining[index];
      const nextIndex = remaining[(index + 1) % remaining.length];
      const previous = points[previousIndex];
      const current = points[currentIndex];
      const next = points[nextIndex];
      const cross =
        (current.x - previous.x) * (next.y - previous.y) -
        (current.y - previous.y) * (next.x - previous.x);
      if (cross * orientation <= 0.001) continue;
      const containsVertex = remaining.some((candidateIndex) => {
        if (
          candidateIndex === previousIndex ||
          candidateIndex === currentIndex ||
          candidateIndex === nextIndex
        ) {
          return false;
        }
        return triangleContainsPoint(
          points[candidateIndex],
          previous,
          current,
          next,
        );
      });
      if (containsVertex) continue;
      triangles.push([previousIndex, currentIndex, nextIndex]);
      remaining.splice(index, 1);
      clipped = true;
      break;
    }
    if (!clipped) break;
  }

  if (remaining.length === 3) {
    triangles.push([remaining[0], remaining[1], remaining[2]]);
  }
  if (!triangles.length) {
    for (let index = 1; index < points.length - 1; index += 1) {
      triangles.push([0, index, index + 1]);
    }
  }
  return triangles;
}

function renderDepthScene(
  context: CanvasRenderingContext2D,
  canvas: HTMLCanvasElement,
  width: number,
  height: number,
  surfaces: DepthSurface[],
  lines: DepthLine[],
) {
  const rasterWidth = Math.max(1, Math.ceil(width));
  const rasterHeight = Math.max(1, Math.ceil(height));
  const layer = document.createElement("canvas");
  layer.width = rasterWidth;
  layer.height = rasterHeight;
  const layerContext = layer.getContext("2d");
  if (!layerContext) return;
  const image = layerContext.createImageData(rasterWidth, rasterHeight);
  const depthBuffer = new Float32Array(rasterWidth * rasterHeight);
  depthBuffer.fill(Number.NEGATIVE_INFINITY);

  const writePixel = (
    x: number,
    y: number,
    depth: number,
    color: { red: number; green: number; blue: number },
    updateDepth: boolean,
  ) => {
    if (x < 0 || y < 0 || x >= rasterWidth || y >= rasterHeight) return;
    const pixelIndex = y * rasterWidth + x;
    if (depth < depthBuffer[pixelIndex] - 0.025) return;
    if (updateDepth) depthBuffer[pixelIndex] = depth;
    const colorIndex = pixelIndex * 4;
    image.data[colorIndex] = color.red;
    image.data[colorIndex + 1] = color.green;
    image.data[colorIndex + 2] = color.blue;
    image.data[colorIndex + 3] = 255;
  };

  surfaces.forEach((surface) => {
    const color = hexColor(surface.fill);
    triangulateDepthPolygon(surface.points).forEach((triangle) => {
      const first = surface.points[triangle[0]];
      const second = surface.points[triangle[1]];
      const third = surface.points[triangle[2]];
      const minimumX = Math.max(
        0,
        Math.floor(Math.min(first.x, second.x, third.x)),
      );
      const maximumX = Math.min(
        rasterWidth - 1,
        Math.ceil(Math.max(first.x, second.x, third.x)),
      );
      const minimumY = Math.max(
        0,
        Math.floor(Math.min(first.y, second.y, third.y)),
      );
      const maximumY = Math.min(
        rasterHeight - 1,
        Math.ceil(Math.max(first.y, second.y, third.y)),
      );
      const denominator =
        (second.y - third.y) * (first.x - third.x) +
        (third.x - second.x) * (first.y - third.y);
      if (Math.abs(denominator) < 0.00001) return;
      for (let y = minimumY; y <= maximumY; y += 1) {
        for (let x = minimumX; x <= maximumX; x += 1) {
          const sampleX = x + 0.5;
          const sampleY = y + 0.5;
          const firstWeight =
            ((second.y - third.y) * (sampleX - third.x) +
              (third.x - second.x) * (sampleY - third.y)) /
            denominator;
          const secondWeight =
            ((third.y - first.y) * (sampleX - third.x) +
              (first.x - third.x) * (sampleY - third.y)) /
            denominator;
          const thirdWeight = 1 - firstWeight - secondWeight;
          if (
            firstWeight < -0.001 ||
            secondWeight < -0.001 ||
            thirdWeight < -0.001
          ) {
            continue;
          }
          const depth =
            first.depth * firstWeight +
            second.depth * secondWeight +
            third.depth * thirdWeight;
          writePixel(x, y, depth, color, true);
        }
      }
    });
  });

  const renderLine = (line: DepthLine) => {
    const color = hexColor(line.stroke);
    line.points.slice(1).forEach((end, index) => {
      const start = line.points[index];
      const distance = Math.hypot(end.x - start.x, end.y - start.y);
      const steps = Math.max(1, Math.ceil(distance * 1.5));
      const radius = Math.max(0.75, line.lineWidth / 2);
      for (let step = 0; step <= steps; step += 1) {
        const amount = step / steps;
        const centerX = start.x + (end.x - start.x) * amount;
        const centerY = start.y + (end.y - start.y) * amount;
        const depth = start.depth + (end.depth - start.depth) * amount;
        const minimumX = Math.floor(centerX - radius);
        const maximumX = Math.ceil(centerX + radius);
        const minimumY = Math.floor(centerY - radius);
        const maximumY = Math.ceil(centerY + radius);
        for (let y = minimumY; y <= maximumY; y += 1) {
          for (let x = minimumX; x <= maximumX; x += 1) {
            if (Math.hypot(x + 0.5 - centerX, y + 0.5 - centerY) > radius) {
              continue;
            }
            writePixel(x, y, depth, color, false);
          }
        }
      }
    });
  };

  surfaces.forEach((surface) => {
    renderLine({
      points: [...surface.points, surface.points[0]],
      stroke: surface.stroke,
      lineWidth: surface.lineWidth,
    });
  });
  lines.forEach(renderLine);

  layerContext.putImageData(image, 0, 0);
  context.save();
  context.setTransform(1, 0, 0, 1, 0, 0);
  context.imageSmoothingEnabled = true;
  context.drawImage(layer, 0, 0, canvas.width, canvas.height);
  context.restore();
}

function pointInPolygon(point: ScreenPoint, polygon: ScreenPoint[]) {
  let inside = false;
  for (
    let index = 0, previous = polygon.length - 1;
    index < polygon.length;
    previous = index, index += 1
  ) {
    const currentPoint = polygon[index];
    const previousPoint = polygon[previous];
    const crosses =
      currentPoint.y > point.y !== previousPoint.y > point.y &&
      point.x <
        ((previousPoint.x - currentPoint.x) *
          (point.y - currentPoint.y)) /
          (previousPoint.y - currentPoint.y) +
          currentPoint.x;
    if (crosses) inside = !inside;
  }
  return inside;
}

function wallSegments(points: Point2[], closed: boolean) {
  const segments = points.slice(1).map((end, index) => ({
    start: points[index],
    end,
    index,
  }));
  if (closed && points.length > 2) {
    segments.push({
      start: points[points.length - 1],
      end: points[0],
      index: points.length - 1,
    });
  }
  return segments;
}

function roofSegments(points: Point2[], closed: boolean) {
  if (!closed || points.length < 3) return [];
  return points.map((start, index) => ({
    start,
    end: points[(index + 1) % points.length],
    index,
  }));
}

function pointInPlanPolygon(point: Point2, polygon: Point2[]) {
  let inside = false;
  for (
    let index = 0, previous = polygon.length - 1;
    index < polygon.length;
    previous = index, index += 1
  ) {
    const currentPoint = polygon[index];
    const previousPoint = polygon[previous];
    const crosses =
      currentPoint.z > point.z !== previousPoint.z > point.z &&
      point.x <
        ((previousPoint.x - currentPoint.x) *
          (point.z - currentPoint.z)) /
          (previousPoint.z - currentPoint.z) +
          currentPoint.x;
    if (crosses) inside = !inside;
  }
  return inside;
}

function modelCenter(walls: Point2[], roof: Point2[]) {
  const points = [...walls, ...roof];
  if (!points.length) return { x: 0, z: 0 };
  return {
    x: points.reduce((sum, point) => sum + point.x, 0) / points.length,
    z: points.reduce((sum, point) => sum + point.z, 0) / points.length,
  };
}

function shiftRoofEdgesByOverhang(
  points: Point2[],
  changes: Array<{ edgeIndex: number; delta: number }>,
): Point2[] {
  if (points.length < 3 || changes.length === 0) {
    return points;
  }
  const signedArea = points.reduce((area, point, index) => {
    const next = points[(index + 1) % points.length];
    return area + point.x * next.z - next.x * point.z;
  }, 0);
  const orientation = signedArea >= 0 ? 1 : -1;
  const offsets = points.map(() => ({ x: 0, z: 0 }));

  changes.forEach(({ edgeIndex, delta }) => {
    const start = points[edgeIndex];
    const endIndex = (edgeIndex + 1) % points.length;
    const end = points[endIndex];
    if (start === undefined || end === undefined) {
      return;
    }
    const deltaX = end.x - start.x;
    const deltaZ = end.z - start.z;
    const length = Math.hypot(deltaX, deltaZ);
    if (length === 0) {
      return;
    }
    const normalX = orientation * deltaZ / length;
    const normalZ = orientation * -deltaX / length;
    offsets[edgeIndex].x += normalX * delta;
    offsets[edgeIndex].z += normalZ * delta;
    offsets[endIndex].x += normalX * delta;
    offsets[endIndex].z += normalZ * delta;
  });

  return points.map((point, index) => ({
    x: point.x + offsets[index].x,
    z: point.z + offsets[index].z,
  }));
}

export default function Home() {
  const [viewMode, setViewMode] = useState<ViewMode>("split");
  const [command, setCommand] = useState<DrawCommand>("select");
  const [wallPoints, setWallPoints] = useState<Point2[]>(INITIAL_WALL_POINTS);
  const [wallsClosed, setWallsClosed] = useState(true);
  const [roofPoints, setRoofPoints] = useState<Point2[]>(INITIAL_ROOF_POINTS);
  const [roofClosed, setRoofClosed] = useState(true);
  const [wallHeights, setWallHeights] = useState([9, 9, 9, 9]);
  const [roofBase, setRoofBase] = useState(10);
  const [clipWalls, setClipWalls] = useState(false);
  const [pitch, setPitch] = useState(6);
  const [roofKind, setRoofKind] = useState<RoofKind>("hip");
  const [roofSystemType, setRoofSystemType] = useState<RoofSystemType>("rafter");
  const [ceiling, setCeiling] = useState<Ceiling>({
    id: "ceiling-1",
    roomId: PRIMARY_ROOM.id,
    bottomOfFramingElevationFeet: 9,
    framingThicknessInches: CEILING_FRAMING_THICKNESS_INCHES,
    finishThicknessInches: CEILING_FINISH_THICKNESS_INCHES,
  });
  const [ceilingHeightDraft, setCeilingHeightDraft] = useState("9.00");
  const [showCeiling, setShowCeiling] = useState(true);
  const [selection, setSelection] = useState<Selection>(null);
  const [pointerWorld, setPointerWorld] = useState<Point2 | null>(null);
  const [wallHeightDraft, setWallHeightDraft] = useState("9.00");
  const [orbit, setOrbit] = useState({ yaw: -42, pitch: 24 });
  const [formZoom, setFormZoom] = useState(1);
  const [formFocusOffset, setFormFocusOffset] = useState<Point3>({
    x: 0,
    y: 0,
    z: 0,
  });
  const [showWalls, setShowWalls] = useState(true);
  const [showTopology, setShowTopology] = useState(true);
  const [showDatums, setShowDatums] = useState(true);
  const [wallHandlePosition, setWallHandlePosition] =
    useState<ScreenPoint | null>(null);
  const [eaveHandlePosition, setEaveHandlePosition] =
    useState<ScreenPoint | null>(null);
  const [eaveCatalog, setEaveCatalog] = useState<EaveCondition[]>(
    INITIAL_EAVE_CONDITIONS,
  );
  const [relationships, setRelationships] = useState<EdgeRelationship[]>(
    INITIAL_ROOF_POINTS.map(() => ({
      conditionId: "rafter-seat",
      elevationOffset: 0,
    })),
  );
  const [catalogDraft, setCatalogDraft] = useState({
    name: "",
    systemType: "rafter" as RoofSystemType,
    parameters: { ...DEFAULT_EAVE_PARAMETERS },
  });
  const [detailEditor, setDetailEditor] = useState<{
    id: string | null;
    draft: EaveDetailDraft;
  } | null>(null);

  const planRef = useRef<HTMLCanvasElement>(null);
  const formRef = useRef<HTMLCanvasElement>(null);
  const formScaleRef = useRef(1);
  const planScaleRef = useRef({ scale: 10, centerX: 0, centerY: 0 });
  const formWallRegions = useRef<
    { index: number; points: ScreenPoint[] }[]
  >([]);
  const formEaveRegions = useRef<
    { index: number; points: ScreenPoint[] }[]
  >([]);
  const formRoofRegions = useRef<ScreenPoint[][]>([]);
  const formCeilingRegions = useRef<ScreenPoint[][]>([]);
  const orbitDrag = useRef<{
    pointerId: number;
    x: number;
    y: number;
    yaw: number;
    pitch: number;
  } | null>(null);
  const panDrag = useRef<{
    pointerId: number;
    x: number;
    y: number;
    focusX: number;
    focusY: number;
    focusZ: number;
    yaw: number;
    pitch: number;
    scale: number;
  } | null>(null);
  const wallHeightDrag = useRef<{
    pointerId: number;
    startY: number;
    startHeight: number;
  } | null>(null);
  const eaveHeightDrag = useRef<{
    pointerId: number;
    startY: number;
    startElevation: number;
  } | null>(null);
  const didOrbit = useRef(false);

  const walls = wallSegments(wallPoints, wallsClosed);
  const roofEdges = roofSegments(roofPoints, roofClosed);
  const center = modelCenter(wallPoints, roofPoints);
  const compatibleEaveDetails = eaveCatalog.filter(
    (condition) => condition.systemType === roofSystemType,
  );

  const conditionForEdge = useCallback(
    (index: number) =>
      eaveCatalog.find(
        (condition) =>
          condition.id === relationships[index]?.conditionId &&
          condition.systemType === roofSystemType,
      ) ?? eaveCatalog.find((condition) => condition.systemType === roofSystemType),
    [eaveCatalog, relationships, roofSystemType],
  );

  const edgeElevation = useCallback(
    (index: number) => roofBase + (relationships[index]?.elevationOffset ?? 0),
    [relationships, roofBase],
  );

  const startCommand = (nextCommand: DrawCommand) => {
    setCommand(nextCommand);
    setSelection(null);
    setPointerWorld(null);
    if (nextCommand === "walls") {
      setWallPoints([]);
      setWallsClosed(false);
      setWallHeights([]);
    }
    if (nextCommand === "roof") {
      setRoofPoints([]);
      setRoofClosed(false);
      setRelationships([]);
    }
  };

  const finishWalls = () => {
    if (wallPoints.length < 2) return;
    setCommand("select");
    setPointerWorld(null);
  };

  const closeWalls = () => {
    if (wallPoints.length < 3) return;
    setWallsClosed(true);
    setWallHeights((current) => [
      ...current.slice(0, wallPoints.length - 1),
      current[wallPoints.length - 1] ?? 9,
    ]);
    setCommand("select");
    setPointerWorld(null);
  };

  const closeRoof = () => {
    if (roofPoints.length < 3) return;
    const fallbackId = compatibleEaveDetails[0]?.id ?? "";
    const nextRelationships = roofPoints.map(() => ({
      conditionId: fallbackId,
      elevationOffset: 0,
    }));
    setRelationships(nextRelationships);
    setRoofClosed(true);
    setCommand("select");
    setPointerWorld(null);
  };

  const reset = () => {
    setWallPoints(INITIAL_WALL_POINTS);
    setWallsClosed(true);
    setRoofPoints(INITIAL_ROOF_POINTS);
    setRoofClosed(true);
    setWallHeights([9, 9, 9, 9]);
    setRoofBase(10);
    setClipWalls(false);
    setPitch(6);
    setRoofKind("hip");
    setRoofSystemType("rafter");
    setCeiling({
      id: "ceiling-1",
      roomId: PRIMARY_ROOM.id,
      bottomOfFramingElevationFeet: 9,
      framingThicknessInches: CEILING_FRAMING_THICKNESS_INCHES,
      finishThicknessInches: CEILING_FINISH_THICKNESS_INCHES,
    });
    setCeilingHeightDraft("9.00");
    setShowCeiling(true);
    setRelationships(
      INITIAL_ROOF_POINTS.map(() => ({
        conditionId: "rafter-seat",
        elevationOffset: 0,
      })),
    );
    setSelection(null);
    setCommand("select");
    setPointerWorld(null);
    setOrbit({ yaw: -42, pitch: 24 });
    setFormZoom(1);
    setFormFocusOffset({ x: 0, y: 0, z: 0 });
  };

  const updateWallHeight = (index: number, value: number) => {
    const safeValue = Math.max(4, Math.min(30, value));
    setWallHeights((current) =>
      current.map((height, wallIndex) =>
        wallIndex === index ? safeValue : height,
      ),
    );
    setWallHeightDraft(safeValue.toFixed(2));
  };

  const updateRelationship = (
    edgeIndex: number,
    changes: Partial<EdgeRelationship>,
  ) => {
    if (changes.conditionId !== undefined) {
      const previous = eaveCatalog.find(
        (condition) => condition.id === relationships[edgeIndex]?.conditionId,
      );
      const next = eaveCatalog.find(
        (condition) => condition.id === changes.conditionId,
      );
      if (previous !== undefined && next !== undefined) {
        const delta = (next.parameters.overhang - previous.parameters.overhang) / 12;
        setRoofPoints((current) =>
          shiftRoofEdgesByOverhang(current, [{ edgeIndex, delta }]),
        );
      }
    }
    setRelationships((current) =>
      current.map((relationship, index) =>
        index === edgeIndex
          ? { ...relationship, ...changes }
          : relationship,
      ),
    );
  };

  const changeRoofSystem = (systemType: RoofSystemType) => {
    const fallback = eaveCatalog.find(
      (condition) => condition.systemType === systemType,
    );
    if (fallback === undefined) {
      return;
    }
    const overhangChanges = relationships.flatMap((relationship, edgeIndex) => {
      const currentDetail = eaveCatalog.find(
        (condition) => condition.id === relationship.conditionId,
      );
      if (currentDetail === undefined || currentDetail.systemType === systemType) {
        return [];
      }
      return [{
        edgeIndex,
        delta:
          (fallback.parameters.overhang - currentDetail.parameters.overhang) / 12,
      }];
    });
    setRoofPoints((current) =>
      shiftRoofEdgesByOverhang(current, overhangChanges),
    );
    setRoofSystemType(systemType);
    setRelationships((current) =>
      current.map((relationship) => {
        const currentDetail = eaveCatalog.find(
          (condition) => condition.id === relationship.conditionId,
        );
        return currentDetail?.systemType === systemType
          ? relationship
          : { ...relationship, conditionId: fallback.id };
      }),
    );
  };

  const openCatalog = (condition: EaveCondition) => {
    setSelection({ kind: "catalog", id: condition.id });
    setCatalogDraft({
      name: condition.name,
      systemType: condition.systemType,
      parameters: { ...condition.parameters },
    });
  };

  const openNewDetail = () => {
    setDetailEditor({
      id: null,
      draft: {
        name: `New ${SYSTEM_LABELS[roofSystemType].toLowerCase()} detail`,
        systemType: roofSystemType,
        parameters: { ...DEFAULT_EAVE_PARAMETERS, pitch },
      },
    });
  };

  const openDetailEditor = (condition: EaveCondition) => {
    setDetailEditor({
      id: condition.id,
      draft: {
        name: condition.name,
        systemType: condition.systemType,
        parameters: { ...condition.parameters },
      },
    });
  };

  const saveDetailEditor = () => {
    if (detailEditor === null) {
      return;
    }
    const id = detailEditor.id ?? `eave-${Date.now()}`;
    const parameters = detailEditor.draft.parameters;
    const condition: EaveCondition = {
      id,
      name: detailEditor.draft.name.trim() || "Untitled eave detail",
      systemType: detailEditor.draft.systemType,
      parameters,
      driver: detailEditor.draft.systemType === "rafter" ? "seat" : "heel",
      height:
        detailEditor.draft.systemType === "raisedHeelTruss"
          ? parameters.heelHeight / 12
          : (detailEditor.draft.systemType === "rafter"
              ? parameters.rafterDepth
              : parameters.topChordDepth) / 12,
      inset:
        detailEditor.draft.systemType === "rafter"
          ? parameters.seatCut / 12
          : 0,
    };
    if (detailEditor.id !== null) {
      const previous = eaveCatalog.find((item) => item.id === detailEditor.id);
      if (previous !== undefined) {
        const replacement =
          condition.systemType === roofSystemType
            ? condition
            : eaveCatalog.find(
                (item) =>
                  item.id !== detailEditor.id &&
                  item.systemType === roofSystemType,
              );
        const delta = replacement === undefined
          ? 0
          : (replacement.parameters.overhang - previous.parameters.overhang) / 12;
        const subscribedEdges = relationships.flatMap((relationship, edgeIndex) =>
          relationship.conditionId === detailEditor.id
            ? [{ edgeIndex, delta }]
            : [],
        );
        setRoofPoints((current) =>
          shiftRoofEdgesByOverhang(current, subscribedEdges),
        );
      }
    }
    setEaveCatalog((current) => {
      if (detailEditor.id === null) {
        return [...current, condition];
      }
      return current.map((item) => item.id === condition.id ? condition : item);
    });
    if (detailEditor.id !== null) {
      setRelationships((current) =>
        current.map((relationship) =>
          relationship.conditionId === detailEditor.id &&
          condition.systemType !== roofSystemType
            ? {
                ...relationship,
                conditionId:
                  eaveCatalog.find(
                    (item) =>
                      item.id !== detailEditor.id &&
                      item.systemType === roofSystemType,
                  )?.id ?? "",
              }
            : relationship,
        ),
      );
    }
    setSelection({ kind: "catalog", id });
    setCatalogDraft({
      name: condition.name,
      systemType: condition.systemType,
      parameters: { ...condition.parameters },
    });
    setDetailEditor(null);
  };

  const deleteCatalog = () => {
    if (selection?.kind !== "catalog" || eaveCatalog.length <= 1) return;
    const selected = eaveCatalog.find((condition) => condition.id === selection.id);
    if (selected === undefined) return;
    const fallback = eaveCatalog.find(
      (condition) =>
        condition.id !== selection.id &&
        condition.systemType === selected.systemType,
    );
    if (!fallback) return;
    const selectedOverhang = selected.parameters.overhang;
    const replacementOverhang = fallback.parameters.overhang;
    const overhangChanges = relationships.flatMap((relationship, edgeIndex) =>
      relationship.conditionId === selection.id
        ? [{ edgeIndex, delta: (replacementOverhang - selectedOverhang) / 12 }]
        : [],
    );
    setRoofPoints((current) =>
      shiftRoofEdgesByOverhang(current, overhangChanges),
    );
    setRelationships((current) =>
      current.map((relationship) =>
        relationship.conditionId === selection.id
          ? { ...relationship, conditionId: fallback.id }
          : relationship,
      ),
    );
    setEaveCatalog((current) =>
      current.filter((condition) => condition.id !== selection.id),
    );
    setSelection(null);
  };

  const drawPlan = useCallback(() => {
    const canvas = planRef.current;
    if (!canvas) return;
    const ready = prepareCanvas(canvas);
    if (!ready) return;
    const { context, width, height } = ready;
    const scale = Math.max(6, Math.min(width / 68, height / 52));
    const centerX = width / 2;
    const centerY = height / 2;
    planScaleRef.current = { scale, centerX, centerY };
    const project = (point: Point2): ScreenPoint => ({
      x: centerX + point.x * scale,
      y: centerY + point.z * scale,
    });

    context.fillStyle = "#fbfaf7";
    context.fillRect(0, 0, width, height);
    const gridStep = scale;
    context.strokeStyle = "#e9e6df";
    context.lineWidth = 1;
    for (
      let x = ((centerX % gridStep) + gridStep) % gridStep;
      x < width;
      x += gridStep
    ) {
      context.beginPath();
      context.moveTo(x, 0);
      context.lineTo(x, height);
      context.stroke();
    }
    for (
      let y = ((centerY % gridStep) + gridStep) % gridStep;
      y < height;
      y += gridStep
    ) {
      context.beginPath();
      context.moveTo(0, y);
      context.lineTo(width, y);
      context.stroke();
    }

    if (showCeiling && wallsClosed && wallPoints.length >= 3) {
      const selected = selection?.kind === "ceiling";
      drawPolygon(
        context,
        wallPoints.map(project),
        selected ? "rgba(38, 127, 103, 0.20)" : "rgba(38, 127, 103, 0.08)",
        selected ? "#267f67" : "rgba(38, 127, 103, 0.45)",
        selected ? 2.5 : 1.25,
      );
      const roomCenter = wallPoints.reduce(
        (result, point) => ({
          x: result.x + point.x / wallPoints.length,
          z: result.z + point.z / wallPoints.length,
        }),
        { x: 0, z: 0 },
      );
      const label = project(roomCenter);
      context.fillStyle = selected ? "#175c4c" : "#267f67";
      context.font = "700 8px monospace";
      context.textAlign = "center";
      context.fillText(
        `CEILING · ${feetInches(ceiling.bottomOfFramingElevationFeet)}`,
        label.x,
        label.y + 3,
      );
    }

    if (roofPoints.length >= 3 && roofClosed) {
      drawPolygon(
        context,
        roofPoints.map(project),
        selection?.kind === "roof"
          ? "rgba(22, 131, 138, 0.10)"
          : "rgba(217, 119, 53, 0.07)",
        selection?.kind === "roof"
          ? "rgba(22, 131, 138, 0.65)"
          : "rgba(217, 119, 53, 0.25)",
        selection?.kind === "roof" ? 2 : 1,
      );
    }

    roofEdges.forEach((edge) => {
      const start = project(edge.start);
      const end = project(edge.end);
      const selected =
        selection?.kind === "roof-edge" && selection.index === edge.index;
      context.strokeStyle = selected ? "#16838a" : "#d97834";
      context.lineWidth = selected ? 4 : 2.5;
      context.lineCap = "round";
      context.beginPath();
      context.moveTo(start.x, start.y);
      context.lineTo(end.x, end.y);
      context.stroke();
      const edgeMidpoint = {
        x: (start.x + end.x) / 2,
        y: (start.y + end.y) / 2,
      };
      context.fillStyle = selected ? "#16838a" : "#fff";
      context.beginPath();
      context.arc(edgeMidpoint.x, edgeMidpoint.y, 5, 0, Math.PI * 2);
      context.fill();
      context.strokeStyle = selected ? "#16838a" : "#d97834";
      context.lineWidth = 1;
      context.stroke();
    });

    if (command === "roof" && roofPoints.length) {
      const projected = roofPoints.map(project);
      context.strokeStyle = "#d97834";
      context.lineWidth = 2.5;
      context.beginPath();
      context.moveTo(projected[0].x, projected[0].y);
      projected.slice(1).forEach((point) => context.lineTo(point.x, point.y));
      if (pointerWorld) {
        const pointer = project(pointerWorld);
        context.setLineDash([6, 5]);
        context.lineTo(pointer.x, pointer.y);
        context.setLineDash([]);
      }
      context.stroke();
    }

    walls.forEach((wall) => {
      const start = project(wall.start);
      const end = project(wall.end);
      const selected =
        selection?.kind === "wall" && selection.index === wall.index;
      context.strokeStyle = selected ? "#171512" : "#817a71";
      context.lineWidth = selected ? 8 : 5;
      context.lineCap = "round";
      context.beginPath();
      context.moveTo(start.x, start.y);
      context.lineTo(end.x, end.y);
      context.stroke();
      const wallMidpoint = {
        x: (start.x + end.x) / 2,
        y: (start.y + end.y) / 2,
      };
      context.fillStyle = selected ? "#171512" : "#fff";
      context.beginPath();
      context.arc(wallMidpoint.x, wallMidpoint.y, 6.5, 0, Math.PI * 2);
      context.fill();
      context.strokeStyle = "#171512";
      context.lineWidth = 1;
      context.stroke();
      context.fillStyle = selected ? "#171512" : "#716a61";
      context.font = "600 8px monospace";
      context.textAlign = "center";
      context.fillText(
        `W${wall.index + 1} · ${feetInches(wallHeights[wall.index] ?? 9)}`,
        wallMidpoint.x,
        wallMidpoint.y - 13,
      );
    });

    if (command === "walls" && wallPoints.length) {
      const projected = wallPoints.map(project);
      context.strokeStyle = "#171512";
      context.lineWidth = 5;
      context.lineCap = "round";
      context.beginPath();
      context.moveTo(projected[0].x, projected[0].y);
      projected.slice(1).forEach((point) => context.lineTo(point.x, point.y));
      if (pointerWorld) {
        const pointer = project(pointerWorld);
        context.setLineDash([6, 5]);
        context.lineTo(pointer.x, pointer.y);
        context.setLineDash([]);
      }
      context.stroke();
    }

    const authoredPoints =
      command === "walls"
        ? wallPoints
        : command === "roof"
          ? roofPoints
          : [];
    authoredPoints.forEach((point, index) => {
      const projected = project(point);
      context.beginPath();
      context.arc(projected.x, projected.y, index === 0 ? 7 : 4.5, 0, Math.PI * 2);
      context.fillStyle = index === 0 ? "#16838a" : "#fff";
      context.fill();
      context.strokeStyle = index === 0 ? "#16838a" : "#171512";
      context.lineWidth = 1.5;
      context.stroke();
    });

    context.textAlign = "left";
    context.fillStyle = "#716a61";
    context.font = "600 8px monospace";
    context.fillText("12″ × 12″ SNAP GRID", 14, 22);
  }, [
    command,
    ceiling.bottomOfFramingElevationFeet,
    pointerWorld,
    roofClosed,
    roofEdges,
    roofPoints,
    selection,
    showCeiling,
    wallHeights,
    wallPoints,
    wallsClosed,
    walls,
  ]);

  const drawForm = useCallback(() => {
    const canvas = formRef.current;
    if (!canvas) return;
    const ready = prepareCanvas(canvas);
    if (!ready) return;
    const { context, width, height } = ready;
    const yaw = (orbit.yaw * Math.PI) / 180;
    const cameraPitch = (orbit.pitch * Math.PI) / 180;
    const allPoints = [...wallPoints, ...roofPoints];
    const spread = Math.max(
      34,
      ...allPoints.map((point) =>
        Math.hypot(point.x - center.x, point.z - center.z),
      ),
    );
    const cameraFrameHeight = Math.max(18, spread * 0.5);
    const scale =
      Math.min(
        width / (spread * 2.5),
        height / (cameraFrameHeight * 2.4),
      ) *
      formZoom;
    formScaleRef.current = scale;
    const origin = { x: width * 0.5, y: height * 0.59 };
    const pivotY = cameraFrameHeight * 0.38;
    const project = (point: Point3): ScreenPoint => {
      const localX = point.x - (center.x + formFocusOffset.x);
      const localZ = point.z - (center.z + formFocusOffset.z);
      const horizontal = localX * Math.cos(yaw) - localZ * Math.sin(yaw);
      const depth = localX * Math.sin(yaw) + localZ * Math.cos(yaw);
      return {
        x: origin.x + horizontal * scale,
        y:
          origin.y +
          depth * scale * Math.sin(cameraPitch) -
          (point.y - (pivotY + formFocusOffset.y)) *
            scale *
            Math.cos(cameraPitch),
      };
    };
    const depthProject = (point: Point3): DepthPoint => {
      const projected = project(point);
      const localX = point.x - (center.x + formFocusOffset.x);
      const localZ = point.z - (center.z + formFocusOffset.z);
      const planDepth = localX * Math.sin(yaw) + localZ * Math.cos(yaw);
      return {
        ...projected,
        depth:
          planDepth * Math.cos(cameraPitch) +
          (point.y - (pivotY + formFocusOffset.y)) * Math.sin(cameraPitch),
      };
    };
    const depthSurfaces: DepthSurface[] = [];
    const depthLines: DepthLine[] = [];
    const eaveMarkers: {
      point: ScreenPoint;
      selected: boolean;
    }[] = [];
    let ceilingOutline: ScreenPoint[] = [];

    context.fillStyle = "#fbfaf7";
    context.fillRect(0, 0, width, height);

    const groundExtent = Math.ceil((spread + 12) / 4) * 4;
    const groundCorners: Point3[] = [
      { x: center.x - groundExtent, y: -0.04, z: center.z - groundExtent },
      { x: center.x + groundExtent, y: -0.04, z: center.z - groundExtent },
      { x: center.x + groundExtent, y: -0.04, z: center.z + groundExtent },
      { x: center.x - groundExtent, y: -0.04, z: center.z + groundExtent },
    ];
    drawPolygon(
      context,
      groundCorners.map(project),
      "rgba(22, 131, 138, 0.045)",
      "rgba(22, 131, 138, 0.16)",
    );
    for (
      let coordinate = -groundExtent;
      coordinate <= groundExtent;
      coordinate += 4
    ) {
      const axis = coordinate === 0;
      context.strokeStyle = axis
        ? "rgba(22, 131, 138, 0.35)"
        : "rgba(113, 106, 97, 0.16)";
      context.lineWidth = axis ? 1.3 : 0.75;
      const xStart = project({
        x: center.x + coordinate,
        y: 0,
        z: center.z - groundExtent,
      });
      const xEnd = project({
        x: center.x + coordinate,
        y: 0,
        z: center.z + groundExtent,
      });
      context.beginPath();
      context.moveTo(xStart.x, xStart.y);
      context.lineTo(xEnd.x, xEnd.y);
      context.stroke();
      const zStart = project({
        x: center.x - groundExtent,
        y: 0,
        z: center.z + coordinate,
      });
      const zEnd = project({
        x: center.x + groundExtent,
        y: 0,
        z: center.z + coordinate,
      });
      context.beginPath();
      context.moveTo(zStart.x, zStart.y);
      context.lineTo(zEnd.x, zEnd.y);
      context.stroke();
    }

    const roofBounds = roofPoints.reduce(
      (result, point) => ({
        minX: Math.min(result.minX, point.x),
        maxX: Math.max(result.maxX, point.x),
        minZ: Math.min(result.minZ, point.z),
        maxZ: Math.max(result.maxZ, point.z),
      }),
      {
        minX: Number.POSITIVE_INFINITY,
        maxX: Number.NEGATIVE_INFINITY,
        minZ: Number.POSITIVE_INFINITY,
        maxZ: Number.NEGATIVE_INFINITY,
      },
    );
    const dominantRoofAxisIsX =
      roofBounds.maxX - roofBounds.minX >=
      roofBounds.maxZ - roofBounds.minZ;
    const roofSurfaceAt = (point: Point2) => {
      if (
        !roofClosed ||
        roofPoints.length < 3 ||
        (!pointInPlanPolygon(point, roofPoints) &&
          !roofEdges.some(
            (edge) =>
              pointToSegmentDistance(point, edge.start, edge.end) < 0.01,
          ))
      ) {
        return null;
      }
      const slope = pitch / 12;
      const nearestEdge = roofEdges
        .map((edge) => ({
          index: edge.index,
          distance: pointToSegmentDistance(point, edge.start, edge.end),
        }))
        .sort((a, b) => a.distance - b.distance)[0];
      const localBase = nearestEdge
        ? edgeElevation(nearestEdge.index)
        : roofBase;
      if (roofKind === "shed") {
        return localBase + (point.x - roofBounds.minX) * slope;
      }
      if (roofKind === "gable") {
        const run = dominantRoofAxisIsX
          ? Math.min(
              point.z - roofBounds.minZ,
              roofBounds.maxZ - point.z,
            )
          : Math.min(
              point.x - roofBounds.minX,
              roofBounds.maxX - point.x,
            );
        return localBase + Math.max(0, run) * slope;
      }
      return localBase + Math.max(0, nearestEdge?.distance ?? 0) * slope;
    };

    formCeilingRegions.current = [];
    if (showCeiling && wallsClosed && wallPoints.length >= 3) {
      const roomBounds = wallPoints.reduce(
        (result, point) => ({
          minX: Math.min(result.minX, point.x),
          maxX: Math.max(result.maxX, point.x),
          minZ: Math.min(result.minZ, point.z),
          maxZ: Math.max(result.maxZ, point.z),
        }),
        {
          minX: Number.POSITIVE_INFINITY,
          maxX: Number.NEGATIVE_INFINITY,
          minZ: Number.POSITIVE_INFINITY,
          maxZ: Number.NEGATIVE_INFINITY,
        },
      );
      const framingBottom = ceiling.bottomOfFramingElevationFeet;
      const framingThickness = ceiling.framingThicknessInches / 12;
      const finishThickness = ceiling.finishThicknessInches / 12;
      const selectedCeiling = selection?.kind === "ceiling";
      const subdivisions = 16;
      const cellWidth = (roomBounds.maxX - roomBounds.minX) / subdivisions;
      const cellDepth = (roomBounds.maxZ - roomBounds.minZ) / subdivisions;
      const clippedBottomAt = (point: Point2) =>
        Math.min(framingBottom, roofSurfaceAt(point) ?? framingBottom);
      const clippedTopAt = (point: Point2) => {
        const bottom = clippedBottomAt(point);
        return Math.max(
          bottom,
          Math.min(
            framingBottom + framingThickness,
            roofSurfaceAt(point) ?? framingBottom + framingThickness,
          ),
        );
      };

      for (let xIndex = 0; xIndex < subdivisions; xIndex += 1) {
        for (let zIndex = 0; zIndex < subdivisions; zIndex += 1) {
          const x0 = roomBounds.minX + xIndex * cellWidth;
          const x1 = roomBounds.minX + (xIndex + 1) * cellWidth;
          const z0 = roomBounds.minZ + zIndex * cellDepth;
          const z1 = roomBounds.minZ + (zIndex + 1) * cellDepth;
          const cellCenter = { x: (x0 + x1) / 2, z: (z0 + z1) / 2 };
          if (!pointInPlanPolygon(cellCenter, wallPoints)) continue;
          const corners: Point2[] = [
            { x: x0, z: z0 },
            { x: x1, z: z0 },
            { x: x1, z: z1 },
            { x: x0, z: z1 },
          ];
          const framingTop = corners.map((point) => ({
            ...point,
            y: clippedTopAt(point),
          }));
          const framingUnderside = corners.map((point) => ({
            ...point,
            y: clippedBottomAt(point),
          }));
          const finishUnderside = corners.map((point) => ({
            ...point,
            y: clippedBottomAt(point) - finishThickness,
          }));
          const topFill = selectedCeiling
            ? (xIndex + zIndex) % 2 === 0
              ? "#6bb49e"
              : "#75bea8"
            : (xIndex + zIndex) % 2 === 0
              ? "#8fbdad"
              : "#99c7b7";
          depthSurfaces.push({
            points: framingTop.map(depthProject),
            fill: topFill,
            stroke: selectedCeiling ? "#267f67" : "#709487",
            lineWidth: selectedCeiling ? 1.15 : 0.45,
          });
          depthSurfaces.push({
            points: [...finishUnderside].reverse().map(depthProject),
            fill: selectedCeiling ? "#e9e2d5" : "#e1dbd0",
            stroke: selectedCeiling ? "#267f67" : "#aaa399",
            lineWidth: selectedCeiling ? 1 : 0.35,
          });
          formCeilingRegions.current.push(framingUnderside.map(project));
        }
      }

      walls.forEach((wall) => {
        const samples = Array.from({ length: 13 }, (_, index) => {
          const amount = index / 12;
          const point = {
            x: wall.start.x + (wall.end.x - wall.start.x) * amount,
            z: wall.start.z + (wall.end.z - wall.start.z) * amount,
          };
          return {
            point,
            bottom: clippedBottomAt(point),
            top: clippedTopAt(point),
          };
        });
        const framingEdge = [
          ...samples.map(({ point, top }) => ({ ...point, y: top })),
          ...samples
            .slice()
            .reverse()
            .map(({ point, bottom }) => ({ ...point, y: bottom })),
        ];
        const finishEdge = [
          ...samples.map(({ point, bottom }) => ({ ...point, y: bottom })),
          ...samples
            .slice()
            .reverse()
            .map(({ point, bottom }) => ({
              ...point,
              y: bottom - finishThickness,
            })),
        ];
        depthSurfaces.push({
          points: framingEdge.map(depthProject),
          fill: selectedCeiling ? "#4d9a82" : "#789f91",
          stroke: selectedCeiling ? "#175c4c" : "#647e75",
          lineWidth: selectedCeiling ? 1.5 : 0.75,
        });
        depthSurfaces.push({
          points: finishEdge.map(depthProject),
          fill: "#e7e0d5",
          stroke: selectedCeiling ? "#267f67" : "#a8a095",
          lineWidth: selectedCeiling ? 1.25 : 0.6,
        });
      });
      ceilingOutline = wallPoints.map((point) =>
        project({ x: point.x, y: clippedBottomAt(point), z: point.z }),
      );
    }

    formWallRegions.current = [];
    if (showWalls) {
      const orderedWalls = [...walls].sort((a, b) => {
        const aMid = midpoint(a.start, a.end);
        const bMid = midpoint(b.start, b.end);
        const aDepth =
          (aMid.x - center.x) * Math.sin(yaw) +
          (aMid.z - center.z) * Math.cos(yaw);
        const bDepth =
          (bMid.x - center.x) * Math.sin(yaw) +
          (bMid.z - center.z) * Math.cos(yaw);
        return aDepth - bDepth;
      });
      orderedWalls.forEach((wall) => {
        const height = wallHeights[wall.index] ?? 9;
        const topPoints: Point3[] = [];
        for (let sample = 12; sample >= 0; sample -= 1) {
          const amount = sample / 12;
          const point = {
            x: wall.start.x + (wall.end.x - wall.start.x) * amount,
            z: wall.start.z + (wall.end.z - wall.start.z) * amount,
          };
          const roofHeight = clipWalls ? roofSurfaceAt(point) : null;
          topPoints.push({
            x: point.x,
            y: roofHeight === null ? height : Math.min(height, roofHeight),
            z: point.z,
          });
        }
        const face = [
          { x: wall.start.x, y: 0, z: wall.start.z },
          { x: wall.end.x, y: 0, z: wall.end.z },
          ...topPoints,
        ];
        const projected = face.map(project);
        formWallRegions.current.push({ index: wall.index, points: projected });
        const selectedWall =
          selection?.kind === "wall" && selection.index === wall.index;
        depthSurfaces.push({
          points: face.map(depthProject),
          fill: selectedWall ? "#d7e7e5" : "#ded9cf",
          stroke: selectedWall ? "#16838a" : "#aaa399",
          lineWidth: selectedWall ? 2.5 : 1,
        });
      });
    }

    if (selection?.kind === "wall") {
      const wall = walls.find((segment) => segment.index === selection.index);
      if (wall) {
        const wallMidpoint = midpoint(wall.start, wall.end);
        const projected = project({
          x: wallMidpoint.x,
          y: wallHeights[wall.index] ?? 9,
          z: wallMidpoint.z,
        });
        setWallHandlePosition((current) =>
          current &&
          Math.abs(current.x - projected.x) < 0.25 &&
          Math.abs(current.y - projected.y) < 0.25
            ? current
            : projected,
        );
      }
    } else {
      setWallHandlePosition((current) => (current ? null : current));
    }
    if (selection?.kind !== "roof-edge") {
      setEaveHandlePosition((current) => (current ? null : current));
    }

    formEaveRegions.current = [];
    formRoofRegions.current = [];
    if (roofClosed && roofPoints.length >= 3) {
      const bounds = roofBounds;
      const dominantX = dominantRoofAxisIsX;
      const roofCenter = {
        x: (bounds.minX + bounds.maxX) / 2,
        z: (bounds.minZ + bounds.maxZ) / 2,
      };
      const roofWidth = bounds.maxX - bounds.minX;
      const roofDepth = bounds.maxZ - bounds.minZ;
      const nominalSlope = Math.max(0.01, pitch / 12);
      const shortSpan = Math.min(roofWidth, roofDepth);
      const ridgeInset = shortSpan / 2;
      const rise = Math.max(0.25, ridgeInset * nominalSlope);
      const ridgeA: Point3 = dominantX
        ? {
            x: bounds.minX + ridgeInset,
            y: roofBase + rise,
            z: roofCenter.z,
          }
        : {
            x: roofCenter.x,
            y: roofBase + rise,
            z: bounds.minZ + ridgeInset,
          };
      const ridgeB: Point3 = dominantX
        ? {
            x: bounds.maxX - ridgeInset,
            y: roofBase + rise,
            z: roofCenter.z,
          }
        : {
            x: roofCenter.x,
            y: roofBase + rise,
            z: bounds.maxZ - ridgeInset,
          };
      const peak: Point3 = {
        x: roofCenter.x,
        y:
          roofKind === "shed"
            ? roofBase + rise * 0.45
            : roofBase + rise,
        z: roofCenter.z,
      };
      const edgeProfiles = roofEdges.map((edge, edgePosition) => {
        const length = segmentLength(edge.start, edge.end);
        const eaveElevation = edgeElevation(edge.index);
        const pointAlongEdge = (amount: number) => ({
          x: edge.start.x + (edge.end.x - edge.start.x) * amount,
          z: edge.start.z + (edge.end.z - edge.start.z) * amount,
        });
        const elevationOffset = eaveElevation - roofBase;

        if (elevationOffset < -0.0001) {
          const points = [
            {
              x: edge.start.x,
              y: eaveElevation,
              z: edge.start.z,
            },
            {
              x: edge.start.x,
              y: eaveElevation,
              z: edge.start.z,
            },
            {
              x: edge.end.x,
              y: eaveElevation,
              z: edge.end.z,
            },
            {
              x: edge.end.x,
              y: eaveElevation,
              z: edge.end.z,
            },
          ];
          return {
            edge,
            hasRaisedTransitions: false,
            points,
            ownedPoints: [points[1], points[2]],
          };
        }

        if (elevationOffset > 0.0001) {
          const transitionRun = Math.min(
            length * 0.45,
            elevationOffset / nominalSlope,
          );
          const transitionFraction =
            length > 0 ? transitionRun / length : 0;
          const plateauStart = pointAlongEdge(transitionFraction);
          const plateauEnd = pointAlongEdge(1 - transitionFraction);
          const points = [
            {
              x: edge.start.x,
              y: roofBase,
              z: edge.start.z,
            },
            {
              x: plateauStart.x,
              y: eaveElevation,
              z: plateauStart.z,
            },
            {
              x: plateauEnd.x,
              y: eaveElevation,
              z: plateauEnd.z,
            },
            {
              x: edge.end.x,
              y: roofBase,
              z: edge.end.z,
            },
          ];
          return {
            edge,
            hasRaisedTransitions: true,
            points,
            ownedPoints: [points[1], points[2]],
          };
        }

        const previousEdge =
          roofEdges[
            (edgePosition + roofEdges.length - 1) % roofEdges.length
          ];
        const nextEdge =
          roofEdges[(edgePosition + 1) % roofEdges.length];
        const startElevation = Math.min(
          roofBase,
          edgeElevation(previousEdge.index),
        );
        const endElevation = Math.min(
          roofBase,
          edgeElevation(nextEdge.index),
        );
        const startRun = Math.min(
          length * 0.45,
          (roofBase - startElevation) / nominalSlope,
        );
        const endRun = Math.min(
          length * 0.45,
          (roofBase - endElevation) / nominalSlope,
        );
        const startBend = pointAlongEdge(length > 0 ? startRun / length : 0);
        const endBend = pointAlongEdge(
          length > 0 ? 1 - endRun / length : 1,
        );
        const points = [
          {
            x: edge.start.x,
            y: startElevation,
            z: edge.start.z,
          },
          {
            x: startBend.x,
            y: roofBase,
            z: startBend.z,
          },
          {
            x: endBend.x,
            y: roofBase,
            z: endBend.z,
          },
          {
            x: edge.end.x,
            y: endElevation,
            z: edge.end.z,
          },
        ];
        return {
          edge,
          hasRaisedTransitions: false,
          points,
          ownedPoints: points,
        };
      });
      if (selection?.kind === "roof-edge") {
        const selectedProfile = edgeProfiles.find(
          ({ edge }) => edge.index === selection.index,
        );
        if (selectedProfile) {
          const { points } = selectedProfile;
          const projected = project({
            x: (points[1].x + points[2].x) / 2,
            y: (points[1].y + points[2].y) / 2,
            z: (points[1].z + points[2].z) / 2,
          });
          setEaveHandlePosition((current) =>
            current &&
            Math.abs(current.x - projected.x) < 0.25 &&
            Math.abs(current.y - projected.y) < 0.25
              ? current
              : projected,
          );
        }
      }
      const nearestRidgeEnd = (point: Point2) =>
        dominantX
          ? Math.abs(point.x - ridgeA.x) <=
            Math.abs(point.x - ridgeB.x)
            ? ridgeA
            : ridgeB
          : Math.abs(point.z - ridgeA.z) <=
              Math.abs(point.z - ridgeB.z)
            ? ridgeA
            : ridgeB;
      const faceDefinitions = edgeProfiles.map(
        ({ edge, points, hasRaisedTransitions, ownedPoints }) => {
        const edgeMidpoint = midpoint(edge.start, edge.end);
        const runsAlongRidge = dominantX
          ? Math.abs(edge.end.x - edge.start.x) >=
            Math.abs(edge.end.z - edge.start.z)
          : Math.abs(edge.end.z - edge.start.z) >=
            Math.abs(edge.end.x - edge.start.x);
        let targetStart = peak;
        let targetEnd = peak;
        if (roofKind === "hip") {
          targetStart = nearestRidgeEnd(edge.start);
          targetEnd = runsAlongRidge
            ? nearestRidgeEnd(edge.end)
            : targetStart;
        } else if (roofKind === "gable") {
          const distanceA = Math.hypot(
            edgeMidpoint.x - ridgeA.x,
            edgeMidpoint.z - ridgeA.z,
          );
          const distanceB = Math.hypot(
            edgeMidpoint.x - ridgeB.x,
            edgeMidpoint.z - ridgeB.z,
          );
          targetStart = distanceA < distanceB ? ridgeA : ridgeB;
          targetEnd = targetStart;
        }
        const mainTargets =
          roofKind === "hip" && runsAlongRidge
            ? [targetEnd, targetStart]
            : [targetStart];
        return {
          edge,
          points,
          hasRaisedTransitions,
          ownedPoints,
          mainTargets,
        };
        },
      );
      const faces = faceDefinitions.map((definition, index) => {
        const previous =
          faceDefinitions[
            (index + faceDefinitions.length - 1) %
              faceDefinitions.length
          ];
        const next =
          faceDefinitions[(index + 1) % faceDefinitions.length];
        const outerBoundary: Point3[] = [];
        const appendPoint = (point: Point3) => {
          const previousPoint = outerBoundary[outerBoundary.length - 1];
          if (
            previousPoint &&
            Math.abs(previousPoint.x - point.x) < 0.001 &&
            Math.abs(previousPoint.y - point.y) < 0.001 &&
            Math.abs(previousPoint.z - point.z) < 0.001
          ) {
            return;
          }
          outerBoundary.push(point);
        };

        if (previous.hasRaisedTransitions) {
          appendPoint(previous.points[2]);
          appendPoint(previous.points[3]);
        }
        definition.ownedPoints.forEach(appendPoint);
        if (next.hasRaisedTransitions) {
          appendPoint(next.points[0]);
          appendPoint(next.points[1]);
        }

        return {
          index: definition.edge.index,
          points: [...outerBoundary, ...definition.mainTargets],
        };
      });
      faces.forEach((face) => {
          const selectedEdge =
            selection?.kind === "roof-edge" &&
            selection.index === face.index;
          const projectedFace = face.points.map(project);
          formRoofRegions.current.push(projectedFace);
          depthSurfaces.push({
            points: face.points.map(depthProject),
            fill: selectedEdge
              ? "#d97834"
              : selection?.kind === "roof"
                ? face.index % 2
                  ? "#e89a65"
                  : "#d97f45"
              : face.index % 2
                ? "#ef9e67"
                : "#df8347",
            stroke: selectedEdge ? "#171512" : "#9b572c",
            lineWidth: selectedEdge ? 2.5 : 1,
          });
        });

      if (showTopology && roofKind !== "shed") {
        depthLines.push({
          points: [depthProject(ridgeA), depthProject(ridgeB)],
          stroke: "#63371f",
          lineWidth: 1.5,
        });
      }

      edgeProfiles.forEach(({ edge, points }) => {
        const projectedProfile = points.map(project);
        formEaveRegions.current.push({
          index: edge.index,
          points: projectedProfile,
        });
        const selectedEdge =
          selection?.kind === "roof-edge" && selection.index === edge.index;
        depthLines.push({
          points: points.map(depthProject),
          stroke: selectedEdge ? "#16838a" : "#a95829",
          lineWidth: selectedEdge ? 4 : 2,
        });
        const middle = {
          x: (projectedProfile[1].x + projectedProfile[2].x) / 2,
          y: (projectedProfile[1].y + projectedProfile[2].y) / 2,
        };
        eaveMarkers.push({ point: middle, selected: selectedEdge });
      });

      walls.forEach((wall) => {
        const wallHeight = wallHeights[wall.index] ?? 9;
        const selectedWall =
          selection?.kind === "wall" && selection.index === wall.index;
        const samples: {
          point: Point2;
          roofHeight: number;
        }[] = [];
        const groups: {
          point: Point2;
          roofHeight: number;
        }[][] = [];

        for (let sample = 0; sample <= 32; sample += 1) {
          const amount = sample / 32;
          const point = {
            x: wall.start.x + (wall.end.x - wall.start.x) * amount,
            z: wall.start.z + (wall.end.z - wall.start.z) * amount,
          };
          const roofHeight = roofSurfaceAt(point);
          if (roofHeight !== null && wallHeight > roofHeight + 0.01) {
            samples.push({ point, roofHeight });
          } else if (samples.length) {
            groups.push([...samples]);
            samples.length = 0;
          }
        }
        if (samples.length) groups.push([...samples]);

        groups.forEach((group) => {
          if (group.length < 2) return;
          depthLines.push({
            points: group.map(({ point, roofHeight }) =>
              depthProject({ x: point.x, y: roofHeight, z: point.z }),
            ),
            stroke: selectedWall ? "#08767e" : "#625b53",
            lineWidth: selectedWall ? 3 : 2,
          });
        });
      });

      renderDepthScene(
        context,
        canvas,
        width,
        height,
        depthSurfaces,
        depthLines,
      );

      if (selection?.kind === "ceiling" && ceilingOutline.length >= 3) {
        context.save();
        context.setLineDash([7, 5]);
        context.strokeStyle = "#175c4c";
        context.lineWidth = 2.5;
        context.beginPath();
        context.moveTo(ceilingOutline[0].x, ceilingOutline[0].y);
        ceilingOutline.slice(1).forEach((point) =>
          context.lineTo(point.x, point.y),
        );
        context.closePath();
        context.stroke();
        context.restore();
      }

      eaveMarkers.forEach(({ point, selected }) => {
        context.beginPath();
        context.arc(point.x, point.y, selected ? 6 : 3.5, 0, Math.PI * 2);
        context.fillStyle = selected ? "#16838a" : "#fff";
        context.fill();
        context.strokeStyle = selected ? "#16838a" : "#a95829";
        context.lineWidth = 1.25;
        context.stroke();
      });

      if (showDatums) {
        context.fillStyle = "#126a70";
        context.font = "600 8px monospace";
        context.fillText(
          `FIXED ROOF BASE · ${feetInches(roofBase)}`,
          16,
          24,
        );
      }
    } else {
      renderDepthScene(
        context,
        canvas,
        width,
        height,
        depthSurfaces,
        depthLines,
      );
      setEaveHandlePosition((current) => (current ? null : current));
      context.fillStyle = "#a95829";
      context.font = "700 10px monospace";
      context.fillText("CLOSE THE ROOF BOUNDARY TO GENERATE VOLUME", 16, 26);
    }
  }, [
    center.x,
    center.z,
    ceiling,
    clipWalls,
    edgeElevation,
    formFocusOffset,
    formZoom,
    orbit,
    pitch,
    roofBase,
    roofClosed,
    roofEdges,
    roofKind,
    roofPoints,
    selection,
    showCeiling,
    showDatums,
    showTopology,
    showWalls,
    wallHeights,
    wallPoints,
    wallsClosed,
    walls,
  ]);

  useEffect(() => {
    const draw = () => {
      drawPlan();
      drawForm();
    };
    draw();
    window.addEventListener("resize", draw);
    return () => window.removeEventListener("resize", draw);
  }, [drawForm, drawPlan, viewMode]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setCommand("select");
        setPointerWorld(null);
      }
      if (event.key === "Enter" && command === "walls") finishWalls();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  });

  const handlePlanClick = (event: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = planRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const { scale, centerX, centerY } = planScaleRef.current;
    const point = {
      x: Math.round((event.clientX - rect.left - centerX) / scale),
      z: Math.round((event.clientY - rect.top - centerY) / scale),
    };

    if (command === "walls") {
      if (
        wallPoints.length >= 3 &&
        segmentLength(point, wallPoints[0]) <= 1
      ) {
        closeWalls();
        return;
      }
      if (
        wallPoints.length &&
        segmentLength(point, wallPoints[wallPoints.length - 1]) < 0.25
      ) {
        return;
      }
      setWallPoints((current) => [...current, point]);
      if (wallPoints.length > 0) {
        setWallHeights((current) => [...current, 9]);
      }
      return;
    }

    if (command === "roof") {
      if (
        roofPoints.length >= 3 &&
        segmentLength(point, roofPoints[0]) <= 1
      ) {
        closeRoof();
        return;
      }
      if (
        roofPoints.length &&
        segmentLength(point, roofPoints[roofPoints.length - 1]) < 0.25
      ) {
        return;
      }
      setRoofPoints((current) => [...current, point]);
      return;
    }

    const roofHit = roofEdges
      .map((edge) => ({
        index: edge.index,
        distance: pointToSegmentDistance(point, edge.start, edge.end),
      }))
      .sort((a, b) => a.distance - b.distance)[0];
    const wallHit = walls
      .map((wall) => ({
        index: wall.index,
        distance: pointToSegmentDistance(point, wall.start, wall.end),
      }))
      .sort((a, b) => a.distance - b.distance)[0];
    if (wallHit && wallHit.distance <= 1 && (!roofHit || wallHit.distance <= roofHit.distance)) {
      setSelection({ kind: "wall", index: wallHit.index });
      setWallHeightDraft((wallHeights[wallHit.index] ?? 9).toFixed(2));
    } else if (roofHit && roofHit.distance <= 1) {
      setSelection({ kind: "roof-edge", index: roofHit.index });
    } else if (
      showCeiling &&
      wallsClosed &&
      wallPoints.length >= 3 &&
      pointInPlanPolygon(point, wallPoints)
    ) {
      setSelection({ kind: "ceiling", id: ceiling.id });
      setCeilingHeightDraft(
        ceiling.bottomOfFramingElevationFeet.toFixed(2),
      );
    } else if (roofClosed && pointInPlanPolygon(point, roofPoints)) {
      setSelection({ kind: "roof" });
    } else {
      setSelection(null);
    }
  };

  const handlePlanPointerMove = (
    event: React.PointerEvent<HTMLCanvasElement>,
  ) => {
    if (command === "select") return;
    const canvas = planRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const { scale, centerX, centerY } = planScaleRef.current;
    setPointerWorld({
      x: Math.round((event.clientX - rect.left - centerX) / scale),
      z: Math.round((event.clientY - rect.top - centerY) / scale),
    });
  };

  const selectedCatalog =
    selection?.kind === "catalog"
      ? eaveCatalog.find((condition) => condition.id === selection.id)
      : null;
  const roomBounds = wallPoints.reduce(
    (result, point) => ({
      minX: Math.min(result.minX, point.x),
      maxX: Math.max(result.maxX, point.x),
      minZ: Math.min(result.minZ, point.z),
      maxZ: Math.max(result.maxZ, point.z),
    }),
    {
      minX: Number.POSITIVE_INFINITY,
      maxX: Number.NEGATIVE_INFINITY,
      minZ: Number.POSITIVE_INFINITY,
      maxZ: Number.NEGATIVE_INFINITY,
    },
  );
  const wallsSharePlateHeight =
    wallHeights.length > 0 &&
    wallHeights.every(
      (height) => Math.abs(height - wallHeights[0]) < 0.001,
    );

  return (
    <main className="studio-shell">
      <header className="topbar">
        <div className="brand-lockup">
          <div className="brand-mark">H</div>
          <div>
            <div className="eyebrow">HIGHARC EXPERIMENTS</div>
            <h1>Roof Form Workbench</h1>
          </div>
        </div>
        <div className="topbar-actions">
          <div className="layout-switch" aria-label="Workspace view">
            {(
              [
                ["split", "Split"],
                ["plan", "2D"],
                ["form", "3D"],
              ] as [ViewMode, string][]
            ).map(([mode, label]) => (
              <button
                key={mode}
                className={viewMode === mode ? "active" : ""}
                aria-pressed={viewMode === mode}
                onClick={() => setViewMode(mode)}
              >
                {label}
              </button>
            ))}
          </div>
          <button className="ghost-button" onClick={reset}>
            Reset
          </button>
          <button className="primary-button">Save study</button>
        </div>
      </header>

      <div className="workspace">
        <aside className="control-panel">
          <div className="control-section command-section">
            <ControlHeading number="01" title="Author geometry" />
            <p className="section-copy">
              Walls and roof boundaries are independent paths.
            </p>
            <div className="command-picker">
              <button
                className={command === "select" ? "active" : ""}
                onClick={() => setCommand("select")}
              >
                <span>↖</span>
                <strong>Select</strong>
                <small>Inspect walls and roof edges</small>
              </button>
              <button
                className={command === "walls" ? "active wall-command" : ""}
                onClick={() => startCommand("walls")}
              >
                <span>⌁</span>
                <strong>Draw walls</strong>
                <small>Each segment becomes one wall</small>
              </button>
              <button
                className={command === "roof" ? "active roof-command" : ""}
                onClick={() => startCommand("roof")}
              >
                <span>◇</span>
                <strong>Draw roof</strong>
                <small>Click the start point to close</small>
              </button>
              <button
                className={selection?.kind === "ceiling" ? "active" : ""}
                disabled={!wallsClosed || wallPoints.length < 3}
                onClick={() => {
                  setCommand("select");
                  setSelection({ kind: "ceiling", id: ceiling.id });
                  setCeilingHeightDraft(
                    ceiling.bottomOfFramingElevationFeet.toFixed(2),
                  );
                }}
              >
                <span>▱</span>
                <strong>Select ceiling</strong>
                <small>{PRIMARY_ROOM.name} · interior wall faces</small>
              </button>
            </div>
            {command !== "select" && (
              <div className="active-command-card">
                <strong>
                  {command === "walls" ? "Drawing walls" : "Drawing roof boundary"}
                </strong>
                <span>
                  {command === "walls"
                    ? `${Math.max(0, wallPoints.length - 1)} wall segments`
                    : `${roofPoints.length} boundary points`}
                </span>
                <div>
                  {command === "walls" && wallPoints.length >= 2 && (
                    <button onClick={finishWalls}>Finish open path</button>
                  )}
                  {command === "walls" && wallPoints.length >= 3 && (
                    <button onClick={closeWalls}>Close path</button>
                  )}
                  <button
                    onClick={() => {
                      setCommand("select");
                      setPointerWorld(null);
                    }}
                  >
                    Stop
                  </button>
                </div>
              </div>
            )}
          </div>

          <div className="control-section">
            <ControlHeading number="02" title="Roof volume" />
            <div className="compact-form-options">
              {(Object.keys(ROOF_FORMS) as RoofKind[]).map((kind) => (
                <button
                  key={kind}
                  className={roofKind === kind ? "active" : ""}
                  onClick={() => setRoofKind(kind)}
                >
                  <strong>{ROOF_FORMS[kind].label}</strong>
                  <small>{ROOF_FORMS[kind].description}</small>
                </button>
              ))}
            </div>
            <div className="roof-system-field">
              <span>Structural system</span>
              <div className="roof-system-options">
                {(Object.keys(SYSTEM_LABELS) as RoofSystemType[]).map((systemType) => (
                  <button
                    key={systemType}
                    className={roofSystemType === systemType ? "active" : ""}
                    onClick={() => changeRoofSystem(systemType)}
                  >
                    {SYSTEM_LABELS[systemType]}
                  </button>
                ))}
              </div>
            </div>
            <Range
              label="Roof base elevation"
              value={roofBase}
              min={4}
              max={30}
              step={0.25}
              output={feetInches(roofBase)}
              onChange={setRoofBase}
            />
            <Range
              label="Pitch"
              value={pitch}
              min={1}
              max={16}
              step={0.5}
              output={`${pitch.toFixed(1)}:12`}
              onChange={setPitch}
            />
            <Check
              label="Clip walls at roof surface"
              value={clipWalls}
              onChange={setClipWalls}
            />
          </div>

          <div className="control-section catalog-section">
            <div className="catalog-heading-row">
              <ControlHeading number="03" title="Eave detail catalog" />
              <button
                className="catalog-new-button"
                onClick={openNewDetail}
                aria-label="Create new eave detail"
              >
                <span aria-hidden="true">+</span> New
              </button>
            </div>
            <p className="catalog-copy">
              <strong>{eaveCatalog.length} saved details.</strong> Reusable
              details are typed by structural system. Edges can only subscribe
              to details compatible with the active roof.
            </p>
            <div className="eave-catalog-list">
              {eaveCatalog.map((condition) => (
                <button
                  key={condition.id}
                  className={`eave-catalog-item ${
                    selection?.kind === "catalog" &&
                    selection.id === condition.id
                      ? "active"
                      : ""
                  }`}
                  onClick={() => openCatalog(condition)}
                >
                  <ConditionDiagram />
                  <span>
                    <strong>{condition.name}</strong>
                    <small>
                      {SYSTEM_LABELS[condition.systemType]}
                    </small>
                  </span>
                  <span className="catalog-chevron">›</span>
                </button>
              ))}
            </div>
          </div>

          <div className="control-section layer-section">
            <ControlHeading number="04" title="View" />
            <Check label="Wall volume" value={showWalls} onChange={setShowWalls} />
            <Check
              label="Ceiling assembly"
              value={showCeiling}
              onChange={setShowCeiling}
            />
            <Check
              label="Construction datums"
              value={showDatums}
              onChange={setShowDatums}
            />
            <Check
              label="Plane topology"
              value={showTopology}
              onChange={setShowTopology}
            />
          </div>
        </aside>

        <section className={`drawing-area ${viewMode}-view`}>
          {viewMode !== "form" && (
            <ViewPanel
              className="plan-panel"
              eyebrow="PLAN / AUTHORING"
              title={
                command === "walls"
                  ? "Draw wall path"
                  : command === "roof"
                    ? "Draw closed roof boundary"
                    : "Independent wall + roof geometry"
              }
              extra={
                <div className="legend">
                  <span>
                    <i className="legend-line bearing" /> Walls
                  </span>
                  <span>
                    <i className="legend-line roof" /> Roof boundary
                  </span>
                  <span>
                    <i className="legend-line ceiling" /> Ceiling
                  </span>
                </div>
              }
            >
              <canvas
                ref={planRef}
                aria-label="Plan authoring canvas"
                onClick={handlePlanClick}
                onPointerMove={handlePlanPointerMove}
                onPointerLeave={() => setPointerWorld(null)}
              />
              <div className="canvas-note">
                {command === "roof"
                  ? "Roof must close on its start point"
                  : command === "walls"
                    ? "Enter finishes an open wall path"
                    : "Select a wall or roof edge to edit"}
              </div>
            </ViewPanel>
          )}

          {viewMode !== "plan" && (
            <ViewPanel
              className="form-panel"
              eyebrow="FORM / STRUCTURE"
              title={
                roofClosed
                  ? "Independent roof volume"
                  : "Roof boundary is open"
              }
              extra={<span className="view-label">LEFT-DRAG TO ORBIT</span>}
            >
              <canvas
                ref={formRef}
                aria-label="Three dimensional roof and wall model"
                onClick={(event) => {
                  if (didOrbit.current) {
                    didOrbit.current = false;
                    return;
                  }
                  const canvas = formRef.current;
                  if (!canvas) return;
                  const rect = canvas.getBoundingClientRect();
                  const pointer = {
                    x: event.clientX - rect.left,
                    y: event.clientY - rect.top,
                  };
                  const eave = formEaveRegions.current.find(
                    (region) =>
                      region.points.slice(1).some(
                        (point, index) =>
                          pointToSegmentDistance(
                            { x: pointer.x, z: pointer.y },
                            {
                              x: region.points[index].x,
                              z: region.points[index].y,
                            },
                            { x: point.x, z: point.y },
                          ) <= 14,
                      ),
                  );
                  if (eave) {
                    setSelection({ kind: "roof-edge", index: eave.index });
                    return;
                  }
                  const wall = [...formWallRegions.current]
                    .reverse()
                    .find((region) => pointInPolygon(pointer, region.points));
                  if (wall) {
                    setSelection({ kind: "wall", index: wall.index });
                    setWallHeightDraft(
                      (wallHeights[wall.index] ?? 9).toFixed(2),
                    );
                    return;
                  }
                  const ceilingRegion = [...formCeilingRegions.current]
                    .reverse()
                    .find((region) => pointInPolygon(pointer, region));
                  if (ceilingRegion) {
                    setSelection({ kind: "ceiling", id: ceiling.id });
                    setCeilingHeightDraft(
                      ceiling.bottomOfFramingElevationFeet.toFixed(2),
                    );
                    return;
                  }
                  const roof = [...formRoofRegions.current]
                    .reverse()
                    .find((region) => pointInPolygon(pointer, region));
                  if (roof) {
                    setSelection({ kind: "roof" });
                    return;
                  }
                  setSelection(null);
                }}
                onPointerDown={(event) => {
                  if (event.button !== 0 && event.button !== 2) return;
                  event.preventDefault();
                  event.currentTarget.setPointerCapture(event.pointerId);
                  didOrbit.current = false;
                  if (event.button === 2) {
                    event.currentTarget.style.cursor = "move";
                    panDrag.current = {
                      pointerId: event.pointerId,
                      x: event.clientX,
                      y: event.clientY,
                      focusX: formFocusOffset.x,
                      focusY: formFocusOffset.y,
                      focusZ: formFocusOffset.z,
                      yaw: (orbit.yaw * Math.PI) / 180,
                      pitch: (orbit.pitch * Math.PI) / 180,
                      scale: formScaleRef.current,
                    };
                    return;
                  }
                  event.currentTarget.style.cursor = "grabbing";
                  orbitDrag.current = {
                    pointerId: event.pointerId,
                    x: event.clientX,
                    y: event.clientY,
                    yaw: orbit.yaw,
                    pitch: orbit.pitch,
                  };
                }}
                onPointerMove={(event) => {
                  const pan = panDrag.current;
                  if (pan && pan.pointerId === event.pointerId) {
                    if (
                      Math.abs(event.clientX - pan.x) +
                        Math.abs(event.clientY - pan.y) >
                      3
                    ) {
                      didOrbit.current = true;
                    }
                    const deltaX = event.clientX - pan.x;
                    const deltaY = event.clientY - pan.y;
                    const horizontal = -deltaX / pan.scale;
                    const vertical = -deltaY / pan.scale;
                    setFormFocusOffset({
                      x:
                        pan.focusX +
                        horizontal * Math.cos(pan.yaw) +
                        vertical *
                          Math.sin(pan.yaw) *
                          Math.sin(pan.pitch),
                      y:
                        pan.focusY -
                        vertical * Math.cos(pan.pitch),
                      z:
                        pan.focusZ -
                        horizontal * Math.sin(pan.yaw) +
                        vertical *
                          Math.cos(pan.yaw) *
                          Math.sin(pan.pitch),
                    });
                    return;
                  }
                  const drag = orbitDrag.current;
                  if (!drag || drag.pointerId !== event.pointerId) return;
                  if (
                    Math.abs(event.clientX - drag.x) +
                      Math.abs(event.clientY - drag.y) >
                    3
                  ) {
                    didOrbit.current = true;
                  }
                  setOrbit({
                    yaw: drag.yaw - (event.clientX - drag.x) * 0.45,
                    pitch: Math.max(
                      -85,
                      Math.min(
                        85,
                        drag.pitch + (event.clientY - drag.y) * 0.35,
                      ),
                    ),
                  });
                }}
                onPointerUp={(event) => {
                  const endedOrbit =
                    orbitDrag.current?.pointerId === event.pointerId;
                  const endedPan =
                    panDrag.current?.pointerId === event.pointerId;
                  if (!endedOrbit && !endedPan) return;
                  event.currentTarget.releasePointerCapture(event.pointerId);
                  event.currentTarget.style.cursor = "grab";
                  if (endedOrbit) orbitDrag.current = null;
                  if (endedPan) panDrag.current = null;
                }}
                onPointerCancel={(event) => {
                  event.currentTarget.style.cursor = "grab";
                  orbitDrag.current = null;
                  panDrag.current = null;
                }}
                onContextMenu={(event) => event.preventDefault()}
                onWheel={(event) => {
                  event.preventDefault();
                  const zoomFactor = Math.exp(-event.deltaY * 0.0015);
                  setFormZoom((current) =>
                    Math.max(0.45, Math.min(3.5, current * zoomFactor)),
                  );
                }}
              />
              <div className="canvas-note orbit-note">
                Left-drag orbit · Right-drag pan · Scroll zoom
              </div>
              <div className="orientation">
                {Math.round(((orbit.yaw % 360) + 360) % 360)}°
              </div>
              {selection?.kind === "wall" && wallHandlePosition && (
                <button
                  className="wall-height-handle"
                  style={{
                    left: wallHandlePosition.x,
                    top: wallHandlePosition.y,
                  }}
                  aria-label={`Drag to change wall ${selection.index + 1} height`}
                  onPointerDown={(event) => {
                    if (event.button !== 0) return;
                    event.preventDefault();
                    event.stopPropagation();
                    event.currentTarget.setPointerCapture(event.pointerId);
                    wallHeightDrag.current = {
                      pointerId: event.pointerId,
                      startY: event.clientY,
                      startHeight: wallHeights[selection.index] ?? 9,
                    };
                  }}
                  onPointerMove={(event) => {
                    const drag = wallHeightDrag.current;
                    if (!drag || drag.pointerId !== event.pointerId) return;
                    const nextHeight = Math.round(
                      Math.max(
                        4,
                        Math.min(
                          30,
                          drag.startHeight + (drag.startY - event.clientY) / 9,
                        ),
                      ) * 4,
                    ) / 4;
                    updateWallHeight(selection.index, nextHeight);
                  }}
                  onPointerUp={(event) => {
                    if (wallHeightDrag.current?.pointerId !== event.pointerId)
                      return;
                    event.currentTarget.releasePointerCapture(event.pointerId);
                    wallHeightDrag.current = null;
                  }}
                  onPointerCancel={() => {
                    wallHeightDrag.current = null;
                  }}
                >
                  <span className="wall-height-arrows" aria-hidden="true">
                    ↑<i />↓
                  </span>
                  <output>
                    {feetInches(wallHeights[selection.index] ?? 9)}
                  </output>
                </button>
              )}
              {selection?.kind === "roof-edge" && eaveHandlePosition && (
                <button
                  className="wall-height-handle"
                  style={{
                    left: eaveHandlePosition.x,
                    top: eaveHandlePosition.y,
                  }}
                  aria-label={`Drag to change roof edge ${selection.index + 1} eave height`}
                  onPointerDown={(event) => {
                    if (event.button !== 0) return;
                    event.preventDefault();
                    event.stopPropagation();
                    event.currentTarget.setPointerCapture(event.pointerId);
                    eaveHeightDrag.current = {
                      pointerId: event.pointerId,
                      startY: event.clientY,
                      startElevation: edgeElevation(selection.index),
                    };
                  }}
                  onPointerMove={(event) => {
                    const drag = eaveHeightDrag.current;
                    if (!drag || drag.pointerId !== event.pointerId) return;
                    const nextElevation =
                      Math.round(
                        Math.max(
                          0,
                          Math.min(
                            40,
                            drag.startElevation +
                              (drag.startY - event.clientY) / 9,
                          ),
                        ) * 4,
                      ) / 4;
                    updateRelationship(selection.index, {
                      elevationOffset: nextElevation - roofBase,
                    });
                  }}
                  onPointerUp={(event) => {
                    if (eaveHeightDrag.current?.pointerId !== event.pointerId)
                      return;
                    event.currentTarget.releasePointerCapture(event.pointerId);
                    eaveHeightDrag.current = null;
                  }}
                  onPointerCancel={() => {
                    eaveHeightDrag.current = null;
                  }}
                >
                  <span className="wall-height-arrows" aria-hidden="true">
                    ↑<i />↓
                  </span>
                  <output>{feetInches(edgeElevation(selection.index))}</output>
                </button>
              )}
            </ViewPanel>
          )}
        </section>

        <aside className="detail-inspector">
          {selection?.kind === "ceiling" ? (
            <>
              <InspectorHeader
                label="SELECTED ROOM CEILING"
                title={`${PRIMARY_ROOM.name} ceiling`}
                onClose={() => setSelection(null)}
              />
              <div className="inspector-selection-summary">
                <span>Owned by {PRIMARY_ROOM.name}</span>
                <strong>
                  {feetInches(roomBounds.maxX - roomBounds.minX)} ×{" "}
                  {feetInches(roomBounds.maxZ - roomBounds.minZ)}
                </strong>
              </div>
              <div className="detail-form inspector-properties">
                <label>
                  <span>Bottom of ceiling framing</span>
                  <div className="height-input">
                    <input
                      type="number"
                      min={4}
                      max={30}
                      step={0.25}
                      value={ceilingHeightDraft}
                      onChange={(event) => {
                        setCeilingHeightDraft(event.target.value);
                        const value = Number(event.target.value);
                        if (Number.isFinite(value) && value >= 4 && value <= 30) {
                          setCeiling((current) => ({
                            ...current,
                            bottomOfFramingElevationFeet: value,
                          }));
                        }
                      }}
                    />
                    <span>ft</span>
                  </div>
                </label>
                <Range
                  label="Ceiling height"
                  value={ceiling.bottomOfFramingElevationFeet}
                  min={4}
                  max={30}
                  step={0.25}
                  output={feetInches(ceiling.bottomOfFramingElevationFeet)}
                  onChange={(value) => {
                    setCeiling((current) => ({
                      ...current,
                      bottomOfFramingElevationFeet: value,
                    }));
                    setCeilingHeightDraft(value.toFixed(2));
                  }}
                />
              </div>
              <div className="detail-inspector-note">
                The flat datum is the bottom of framing. Where it meets the
                roof, perimeter cells fold to the solved roof face instead of
                extruding through it. The ceiling follows this room’s interior
                wall-face footprint automatically.
              </div>
              <dl className="inspector-data">
                <div>
                  <dt>Structural framing</dt>
                  <dd>{ceiling.framingThicknessInches.toFixed(1)}″ upward</dd>
                </div>
                <div>
                  <dt>Separate finish</dt>
                  <dd>{ceiling.finishThicknessInches.toFixed(1)}″ below</dd>
                </div>
                <div>
                  <dt>Roof clipping limit</dt>
                  <dd>Solved top-of-framing face</dd>
                </div>
                <div>
                  <dt>Default datum</dt>
                  <dd>
                    {wallsSharePlateHeight
                      ? `Shared plate · ${feetInches(wallHeights[0])}`
                      : "Explicit · wall plates differ"}
                  </dd>
                </div>
              </dl>
            </>
          ) : selection?.kind === "wall" ? (
            <>
              <InspectorHeader
                label="SELECTED WALL SEGMENT"
                title={`Wall ${selection.index + 1}`}
                onClose={() => setSelection(null)}
              />
              <div className="inspector-selection-summary">
                <span>Individual wall</span>
                <strong>
                  {feetInches(
                    segmentLength(
                      walls[selection.index]?.start ?? { x: 0, z: 0 },
                      walls[selection.index]?.end ?? { x: 0, z: 0 },
                    ),
                  )}{" "}
                  long
                </strong>
              </div>
              <div className="detail-form inspector-properties">
                <label>
                  <span>Top / plate height</span>
                  <div className="height-input">
                    <input
                      type="number"
                      min={4}
                      max={30}
                      step={0.25}
                      value={wallHeightDraft}
                      onChange={(event) => {
                        setWallHeightDraft(event.target.value);
                        const value = Number(event.target.value);
                        if (Number.isFinite(value) && value >= 4 && value <= 30) {
                          updateWallHeight(selection.index, value);
                        }
                      }}
                    />
                    <span>ft</span>
                  </div>
                </label>
              </div>
              <div className="detail-inspector-note">
                This plate height is independently authored. Changing it never
                repositions the roof.
              </div>
              <dl className="inspector-data">
                <div>
                  <dt>Roof clipping</dt>
                  <dd>{clipWalls ? "Displayed wall clips at roof" : "Off"}</dd>
                </div>
              </dl>
            </>
          ) : selection?.kind === "roof" ? (
            <>
              <InspectorHeader
                label="SELECTED ROOF"
                title="Roof volume"
                onClose={() => setSelection(null)}
              />
              <div className="inspector-selection-summary">
                <span>Independent authored object</span>
                <strong>{ROOF_FORMS[roofKind].label}</strong>
              </div>
              <div className="detail-form inspector-properties">
                <label>
                  <span>Roof base elevation</span>
                  <div className="height-input">
                    <input
                      type="number"
                      min={4}
                      max={30}
                      step={0.25}
                      value={roofBase}
                      onChange={(event) => {
                        const value = Number(event.target.value);
                        if (Number.isFinite(value)) {
                          setRoofBase(Math.max(4, Math.min(30, value)));
                        }
                      }}
                    />
                    <span>ft</span>
                  </div>
                </label>
                <label className="inspector-toggle">
                  <span>
                    <strong>Clip walls at roof</strong>
                    <small>
                      Trim displayed wall geometry without changing plate
                      heights.
                    </small>
                  </span>
                  <input
                    type="checkbox"
                    checked={clipWalls}
                    onChange={(event) => setClipWalls(event.target.checked)}
                  />
                </label>
              </div>
              <div className="detail-inspector-note">
                The roof always starts from this fixed base elevation. Wall
                height changes do not move it.
              </div>
              <dl className="inspector-data">
                <div>
                  <dt>Boundary</dt>
                  <dd>{roofEdges.length} closed edges</dd>
                </div>
                <div>
                  <dt>Pitch</dt>
                  <dd>{pitch.toFixed(1)}:12</dd>
                </div>
              </dl>
            </>
          ) : selection?.kind === "roof-edge" ? (
            <>
              <InspectorHeader
                label="SELECTED ROOF EDGE"
                title={`Roof edge ${selection.index + 1}`}
                onClose={() => setSelection(null)}
              />
              <div className="inspector-selection-summary">
                <span>Authored boundary segment</span>
                <strong>
                  {feetInches(
                    segmentLength(
                      roofEdges[selection.index]?.start ?? { x: 0, z: 0 },
                      roofEdges[selection.index]?.end ?? { x: 0, z: 0 },
                    ),
                  )}
                </strong>
              </div>
              <div className="detail-form inspector-properties">
                <label>
                  <span>Eave elevation</span>
                  <div className="height-input">
                    <input
                      type="number"
                      min={0}
                      max={40}
                      step={0.25}
                      value={edgeElevation(selection.index)}
                      onChange={(event) => {
                        const value = Number(event.target.value);
                        if (!Number.isFinite(value)) return;
                        updateRelationship(selection.index, {
                          elevationOffset:
                            Math.max(0, Math.min(40, value)) - roofBase,
                        });
                      }}
                    />
                    <span>ft</span>
                  </div>
                </label>
                <Range
                  label="Raise / lower from roof base"
                  value={relationships[selection.index]?.elevationOffset ?? 0}
                  min={-8}
                  max={8}
                  step={0.25}
                  output={
                    (relationships[selection.index]?.elevationOffset ?? 0) === 0
                      ? "At base"
                      : `${(relationships[selection.index]?.elevationOffset ?? 0) > 0 ? "+" : ""}${feetInches(
                          relationships[selection.index]?.elevationOffset ?? 0,
                        )}`
                  }
                  onChange={(value) =>
                    updateRelationship(selection.index, {
                      elevationOffset: value,
                    })
                  }
                />
                <label>
                  <span>{SYSTEM_LABELS[roofSystemType]} detail</span>
                  <select
                    value={relationships[selection.index]?.conditionId ?? ""}
                    onChange={(event) =>
                      updateRelationship(selection.index, {
                        conditionId: event.target.value,
                      })
                    }
                  >
                    {compatibleEaveDetails.map((condition) => (
                      <option key={condition.id} value={condition.id}>
                        {condition.name}
                      </option>
                    ))}
                  </select>
                </label>
                <div className="condition-coordinate">
                  <span>
                    X{" "}
                    {feetInches(conditionForEdge(selection.index)?.inset ?? 0)}{" "}
                    inboard
                  </span>
                  <span>
                    Y +
                    {feetInches(conditionForEdge(selection.index)?.height ?? 0)}{" "}
                    above plate
                  </span>
                </div>
                <div className="condition-coordinate compact">
                  <span>Catalog overhang</span>
                  <strong>
                    {(conditionForEdge(selection.index)?.parameters.overhang ?? 0).toFixed(2)}″
                  </strong>
                </div>
              </div>
              <div className="detail-inspector-note">
                This eave is independently positioned from the fixed roof base.
                Its middle run stays horizontal while the two neighboring roof
                faces extend to its ends. The roof remains four faces; only this
                face changes slope. Lowered eaves keep the authored rectangular
                footprint while the neighboring side eaves bend down to their
                shared corners.
              </div>
              <dl className="inspector-data">
                <div>
                  <dt>Roof base elevation</dt>
                  <dd>{feetInches(roofBase)}</dd>
                </div>
                <div>
                  <dt>Eave offset</dt>
                  <dd>
                    {feetInches(
                      relationships[selection.index]?.elevationOffset ?? 0,
                    )}
                  </dd>
                </div>
              </dl>
            </>
          ) : selectedCatalog ? (
            <>
              <InspectorHeader
                label="EAVE DETAIL CATALOG"
                title={selectedCatalog.name}
                onClose={() => setSelection(null)}
              />
              <div className="detail-preview shared-eave-preview">
                <EaveDetailPreview
                  className="inspector-eave-canvas"
                  draft={{
                    name: catalogDraft.name,
                    systemType: catalogDraft.systemType,
                    parameters: catalogDraft.parameters,
                  }}
                />
              </div>
              <p className="detail-preview-caption">
                This detail remains edge metadata. It does not reposition the
                roof’s fixed base elevation.
              </p>
              <div className="catalog-detail-summary">
                <span>Structural system</span>
                <strong>{SYSTEM_LABELS[selectedCatalog.systemType]}</strong>
              </div>
              <div className="detail-inspector-actions">
                <button
                  className="delete-detail"
                  disabled={eaveCatalog.filter((condition) => condition.systemType === selectedCatalog.systemType).length <= 1}
                  onClick={deleteCatalog}
                >
                  Delete
                </button>
                <button
                  className="save-detail"
                  onClick={() => openDetailEditor(selectedCatalog)}
                >
                  Edit in 2D detail lab
                </button>
              </div>
            </>
          ) : (
            <div className="inspector-empty inspector-model-summary">
              <span className="view-label">MODEL INSPECTOR</span>
              <div className="inspector-empty-glyph" aria-hidden="true">
                <i />
                <b />
              </div>
              <h2>Room, ceiling, and roof are coordinated</h2>
              <p>
                The room owns a ceiling whose footprint follows the interior
                wall faces. Select the ceiling, roof, a wall, or an edge to edit
                its properties.
              </p>
              <dl className="model-counts">
                <div>
                  <dt>Walls</dt>
                  <dd>{walls.length}</dd>
                </div>
                <div>
                  <dt>Roof edges</dt>
                  <dd>{roofEdges.length}</dd>
                </div>
                <div>
                  <dt>Ceilings</dt>
                  <dd>{wallsClosed && wallPoints.length >= 3 ? 1 : 0}</dd>
                </div>
                <div>
                  <dt>Clip walls</dt>
                  <dd>{clipWalls ? "On" : "Off"}</dd>
                </div>
              </dl>
            </div>
          )}
        </aside>
      </div>

      <footer className="statusbar">
        <span>
          <i className={roofClosed ? "healthy-dot" : "warning-dot"} />
          {roofClosed
            ? "Roof boundary closed · volume generated"
            : "Roof boundary must close on its first point"}
        </span>
        <span>
          {walls.length} walls · {roofEdges.length} roof edges ·{" "}
          {wallsClosed && wallPoints.length >= 3 ? 1 : 0} ceiling
        </span>
        <span>
          Roof base {feetInches(roofBase)} · ceiling framing bottom{" "}
          {feetInches(ceiling.bottomOfFramingElevationFeet)}
        </span>
      </footer>
      {detailEditor !== null ? (
        <EaveDetailEditor
          draft={detailEditor.draft}
          onChange={(draft) =>
            setDetailEditor((current) => current === null ? null : { ...current, draft })
          }
          onCancel={() => setDetailEditor(null)}
          onSave={saveDetailEditor}
          saveLabel={detailEditor.id === null ? "Add to catalog" : "Save detail"}
        />
      ) : null}
    </main>
  );
}

function ControlHeading({ number, title }: { number: string; title: string }) {
  return (
    <div className="section-heading">
      <span>{number}</span>
      <h2>{title}</h2>
    </div>
  );
}

function Range({
  label,
  value,
  min,
  max,
  step,
  output,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  output: string;
  onChange: (value: number) => void;
}) {
  return (
    <label className="range-control">
      <span>
        {label}
        <output>{output}</output>
      </span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(event) => onChange(Number(event.target.value))}
      />
    </label>
  );
}

function Check({
  label,
  value,
  onChange,
}: {
  label: string;
  value: boolean;
  onChange: (value: boolean) => void;
}) {
  return (
    <label className="check-control">
      <input
        type="checkbox"
        checked={value}
        onChange={(event) => onChange(event.target.checked)}
      />
      <span>{label}</span>
    </label>
  );
}

function ConditionDiagram() {
  return (
    <span className="condition-diagram">
      <i className="condition-wall" />
      <i className="condition-roof" />
      <i className="condition-point" />
    </span>
  );
}

function InspectorHeader({
  label,
  title,
  onClose,
}: {
  label: string;
  title: string;
  onClose: () => void;
}) {
  return (
    <header className="detail-inspector-header">
      <div>
        <span className="view-label">{label}</span>
        <h2>{title}</h2>
      </div>
      <button aria-label="Clear selection" onClick={onClose}>
        ×
      </button>
    </header>
  );
}

function ViewPanel({
  className,
  eyebrow,
  title,
  extra,
  children,
}: {
  className: string;
  eyebrow: string;
  title: string;
  extra?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className={`view-panel ${className}`}>
      <header className="panel-heading">
        <div>
          <span className="view-label">{eyebrow}</span>
          <h2>{title}</h2>
        </div>
        {extra}
      </header>
      <div className="canvas-wrap">{children}</div>
    </section>
  );
}
