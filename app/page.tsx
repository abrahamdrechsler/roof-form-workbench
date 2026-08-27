"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
type IndexedPlanSegment = { start: Point2; end: Point2; index: number };

const SPLIT_DIVIDER_WIDTH = 9;
const SPLIT_MIN_PANE_WIDTH = 220;
type DepthPoint = ScreenPoint & { depth: number };
type DepthSurface = {
  points: DepthPoint[];
  fill: string;
  stroke: string;
  lineWidth: number;
  outline?: boolean;
};
type DepthLine = {
  points: DepthPoint[];
  stroke: string;
  lineWidth: number;
};
type ModelPick =
  | { kind: "wall"; index: number }
  | { kind: "ceiling"; id: string }
  | { kind: "roof" };
type ModelSurface = Omit<DepthSurface, "points"> & {
  points: Point3[];
  pick?: ModelPick;
  solidId?: string;
};
type ModelLine = Omit<DepthLine, "points"> & { points: Point3[] };
type SectionBounds = {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
  minZ: number;
  maxZ: number;
};
type SectionFace = keyof SectionBounds;
type StudSize = 3.5 | 5.5 | 11.25;
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
  conditionIds: string[];
  elevationOffset: number;
};
type Room = { id: string; name: string };
type Ceiling = {
  id: string;
  roomId: string;
  bottomOfFramingElevationFeet: number;
  framingThicknessInches: number;
  finishThicknessInches: number;
};
type RoofAssembly = {
  /** Perpendicular depth of the shared structural member, in inches. */
  structuralDepthInches: number;
  /** Shared roof covering / sheathing build-up above structural framing. */
  buildUpThicknessInches: number;
};
type Selection =
  | ModelPick
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

const INITIAL_SECTION_BOX: SectionBounds = {
  minX: -18,
  maxX: 18,
  minY: -0.5,
  maxY: 20,
  minZ: -24,
  maxZ: 24,
};

const STUD_SIZE_LABELS: Record<StudSize, string> = {
  3.5: "2×4",
  5.5: "2×6",
  11.25: "2×12",
};

const PRIMARY_ROOM: Room = { id: "room-1", name: "Room 1" };
const CEILING_FRAMING_THICKNESS_INCHES = 3.5;
const CEILING_FINISH_THICKNESS_INCHES = 0.5;
const DEFAULT_BEARING_ELEVATION_FEET = 9;
const DEFAULT_ROOF_ASSEMBLY: RoofAssembly = {
  structuralDepthInches: 5.5,
  buildUpThicknessInches: 0.6,
};

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

function defaultConditionIdsBySystem(catalog: EaveCondition[]) {
  const assignedSystems = new Set<RoofSystemType>();
  return catalog.flatMap((condition) => {
    if (assignedSystems.has(condition.systemType)) return [];
    assignedSystems.add(condition.systemType);
    return [condition.id];
  });
}

function activeConditionForRelationship(
  relationship: EdgeRelationship | undefined,
  catalog: EaveCondition[],
  systemType: RoofSystemType,
) {
  if (!relationship) return undefined;
  return relationship.conditionIds
    .map((id) => catalog.find((condition) => condition.id === id))
    .find((condition) => condition?.systemType === systemType);
}

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

function axisAlignedRectangleBounds(points: Point2[]) {
  if (points.length !== 4) return null;
  const minX = Math.min(...points.map((point) => point.x));
  const maxX = Math.max(...points.map((point) => point.x));
  const minZ = Math.min(...points.map((point) => point.z));
  const maxZ = Math.max(...points.map((point) => point.z));
  if (maxX - minX < 0.01 || maxZ - minZ < 0.01) return null;
  const tolerance = 0.01;
  const cornerKeys = new Set(
    points.map((point) => {
      const x = Math.abs(point.x - minX) <= tolerance
        ? "min"
        : Math.abs(point.x - maxX) <= tolerance
          ? "max"
          : "invalid";
      const z = Math.abs(point.z - minZ) <= tolerance
        ? "min"
        : Math.abs(point.z - maxZ) <= tolerance
          ? "max"
          : "invalid";
      return `${x}:${z}`;
    }),
  );
  const edgesAreOrthogonal = points.every((point, index) => {
    const next = points[(index + 1) % points.length];
    return (
      Math.abs(point.x - next.x) <= tolerance ||
      Math.abs(point.z - next.z) <= tolerance
    );
  });
  if (
    !edgesAreOrthogonal ||
    cornerKeys.size !== 4 ||
    [...cornerKeys].some((key) => key.includes("invalid"))
  ) {
    return null;
  }
  return { minX, maxX, minZ, maxZ };
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

function clipPlanPolygonToConvexBoundary(
  polygon: Point2[],
  boundary: Point2[],
) {
  if (polygon.length < 3 || boundary.length < 3) return [];
  const signedArea = boundary.reduce((area, point, index) => {
    const next = boundary[(index + 1) % boundary.length];
    return area + point.x * next.z - next.x * point.z;
  }, 0);
  const orientation = signedArea >= 0 ? 1 : -1;
  return boundary.reduce<Point2[]>((clipped, edgeStart, edgeIndex) => {
    if (clipped.length < 3) return [];
    const edgeEnd = boundary[(edgeIndex + 1) % boundary.length];
    const edgeX = edgeEnd.x - edgeStart.x;
    const edgeZ = edgeEnd.z - edgeStart.z;
    const side = (point: Point2) =>
      orientation *
      (edgeX * (point.z - edgeStart.z) -
        edgeZ * (point.x - edgeStart.x));
    const result: Point2[] = [];
    clipped.forEach((current, index) => {
      const previous = clipped[(index + clipped.length - 1) % clipped.length];
      const currentSide = side(current);
      const previousSide = side(previous);
      const currentInside = currentSide >= -0.0001;
      const previousInside = previousSide >= -0.0001;
      if (currentInside !== previousInside) {
        const denominator = previousSide - currentSide;
        const amount =
          Math.abs(denominator) < 0.00001
            ? 0
            : previousSide / denominator;
        result.push({
          x: previous.x + (current.x - previous.x) * amount,
          z: previous.z + (current.z - previous.z) * amount,
        });
      }
      if (currentInside) result.push(current);
    });
    return result;
  }, polygon);
}

function wallUnderRoofEdge(
  edge: IndexedPlanSegment,
  walls: IndexedPlanSegment[],
) {
  const edgeLength = Math.max(0.0001, segmentLength(edge.start, edge.end));
  const edgeDirection = {
    x: (edge.end.x - edge.start.x) / edgeLength,
    z: (edge.end.z - edge.start.z) / edgeLength,
  };
  const parallelWalls = walls.filter((wall) => {
    const wallLength = Math.max(0.0001, segmentLength(wall.start, wall.end));
    const alignment = Math.abs(
      edgeDirection.x * ((wall.end.x - wall.start.x) / wallLength) +
        edgeDirection.z * ((wall.end.z - wall.start.z) / wallLength),
    );
    return alignment > 0.98;
  });
  const candidates = parallelWalls.length > 0 ? parallelWalls : walls;
  const edgeMidpoint = midpoint(edge.start, edge.end);
  return [...candidates].sort(
    (first, second) =>
      pointToSegmentDistance(edgeMidpoint, first.start, first.end) -
      pointToSegmentDistance(edgeMidpoint, second.start, second.end),
  )[0];
}

function prepareCanvas(canvas: HTMLCanvasElement) {
  const rect = canvas.getBoundingClientRect();
  const ratio = Math.min(2, window.devicePixelRatio || 1);
  const pixelWidth = Math.round(rect.width * ratio);
  const pixelHeight = Math.round(rect.height * ratio);
  if (canvas.width !== pixelWidth) canvas.width = pixelWidth;
  if (canvas.height !== pixelHeight) canvas.height = pixelHeight;
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

function roofHeightFromFaces(point: Point2, faces: Point3[][]) {
  const heights: number[] = [];
  faces.forEach((face) => {
    const planPoints = face.map((vertex) => ({
      x: vertex.x,
      y: vertex.z,
      depth: vertex.y,
    }));
    triangulateDepthPolygon(planPoints).forEach(([firstIndex, secondIndex, thirdIndex]) => {
      const first = planPoints[firstIndex];
      const second = planPoints[secondIndex];
      const third = planPoints[thirdIndex];
      const denominator =
        (second.y - third.y) * (first.x - third.x) +
        (third.x - second.x) * (first.y - third.y);
      if (Math.abs(denominator) < 0.00001) return;
      const firstWeight =
        ((second.y - third.y) * (point.x - third.x) +
          (third.x - second.x) * (point.z - third.y)) /
        denominator;
      const secondWeight =
        ((third.y - first.y) * (point.x - third.x) +
          (first.x - third.x) * (point.z - third.y)) /
        denominator;
      const thirdWeight = 1 - firstWeight - secondWeight;
      if (
        firstWeight < -0.0001 ||
        secondWeight < -0.0001 ||
        thirdWeight < -0.0001
      ) {
        return;
      }
      heights.push(
        first.depth * firstWeight +
          second.depth * secondWeight +
          third.depth * thirdWeight,
      );
    });
  });
  return heights.length ? Math.min(...heights) : null;
}

function clipPlanPolygonByHeight(
  polygon: Point2[],
  heightAt: (point: Point2) => number | null,
  threshold: number,
  keepAbove: boolean,
) {
  const result: Point2[] = [];
  const sampledHeight = (point: Point2) => heightAt(point) ?? threshold + 1;
  const isInside = (height: number) =>
    keepAbove ? height >= threshold - 0.0001 : height < threshold - 0.0001;
  polygon.forEach((current, index) => {
    const previous = polygon[(index + polygon.length - 1) % polygon.length];
    const currentHeight = sampledHeight(current);
    const previousHeight = sampledHeight(previous);
    const currentInside = isInside(currentHeight);
    const previousInside = isInside(previousHeight);
    if (currentInside !== previousInside) {
      const denominator = currentHeight - previousHeight;
      const amount =
        Math.abs(denominator) < 0.00001
          ? 0
          : (threshold - previousHeight) / denominator;
      result.push({
        x: previous.x + (current.x - previous.x) * amount,
        z: previous.z + (current.z - previous.z) * amount,
      });
    }
    if (currentInside) result.push(current);
  });
  return result;
}

/** Returns the upward normal of a solved roof face.  Thickness is measured
 * perpendicular to the roof, rather than vertically, so eave sections retain
 * their authored slope. */
function roofFaceNormal(points: Point3[]): Point3 {
  for (let first = 0; first < points.length - 2; first += 1) {
    const a = points[first];
    const b = points[first + 1];
    const c = points[first + 2];
    const ux = b.x - a.x;
    const uy = b.y - a.y;
    const uz = b.z - a.z;
    const vx = c.x - a.x;
    const vy = c.y - a.y;
    const vz = c.z - a.z;
    let nx = uy * vz - uz * vy;
    let ny = uz * vx - ux * vz;
    let nz = ux * vy - uy * vx;
    const length = Math.hypot(nx, ny, nz);
    if (length < 0.00001) continue;
    if (ny < 0) {
      nx *= -1;
      ny *= -1;
      nz *= -1;
    }
    return { x: nx / length, y: ny / length, z: nz / length };
  }
  return { x: 0, y: 1, z: 0 };
}

function offsetRoofFacesWatertight(
  faces: Point3[][],
  distanceFeet: number,
  boundaryPoints: Point3[] = [],
  boundarySlope = 0,
) {
  const offsets = new Map<string, { total: number; count: number }>();
  const pointKey = (point: Point3) =>
    `${point.x.toFixed(4)}:${point.y.toFixed(4)}:${point.z.toFixed(4)}`;
  const boundaryKeys = new Set(boundaryPoints.map(pointKey));
  const boundaryVerticalOffset =
    distanceFeet * Math.sqrt(1 + boundarySlope * boundarySlope);

  faces.forEach((face) => {
    const normal = roofFaceNormal(face);
    const faceVerticalOffset = distanceFeet / Math.max(0.05, normal.y);
    face.forEach((point) => {
      const key = pointKey(point);
      const verticalOffset = boundaryKeys.has(key)
        ? boundaryVerticalOffset
        : faceVerticalOffset;
      const current = offsets.get(key) ?? { total: 0, count: 0 };
      current.total += verticalOffset;
      current.count += 1;
      offsets.set(key, current);
    });
  });

  return faces.map((face) =>
    face.map((point) => {
      const offset = offsets.get(pointKey(point));
      return {
        x: point.x,
        y: point.y + (offset ? offset.total / offset.count : 0),
        z: point.z,
      };
    }),
  );
}

function clipPolygonToSectionBox(points: Point3[], bounds: SectionBounds) {
  const planes: {
    inside: (point: Point3) => boolean;
    intersection: (start: Point3, end: Point3) => Point3;
  }[] = [
    {
      inside: (point) => point.x >= bounds.minX,
      intersection: (start, end) =>
        interpolatePoint3(start, end, (bounds.minX - start.x) / (end.x - start.x)),
    },
    {
      inside: (point) => point.x <= bounds.maxX,
      intersection: (start, end) =>
        interpolatePoint3(start, end, (bounds.maxX - start.x) / (end.x - start.x)),
    },
    {
      inside: (point) => point.y >= bounds.minY,
      intersection: (start, end) =>
        interpolatePoint3(start, end, (bounds.minY - start.y) / (end.y - start.y)),
    },
    {
      inside: (point) => point.y <= bounds.maxY,
      intersection: (start, end) =>
        interpolatePoint3(start, end, (bounds.maxY - start.y) / (end.y - start.y)),
    },
    {
      inside: (point) => point.z >= bounds.minZ,
      intersection: (start, end) =>
        interpolatePoint3(start, end, (bounds.minZ - start.z) / (end.z - start.z)),
    },
    {
      inside: (point) => point.z <= bounds.maxZ,
      intersection: (start, end) =>
        interpolatePoint3(start, end, (bounds.maxZ - start.z) / (end.z - start.z)),
    },
  ];
  return planes.reduce<Point3[]>((polygon, plane) => {
    if (!polygon.length) return polygon;
    const clipped: Point3[] = [];
    polygon.forEach((end, index) => {
      const start = polygon[(index + polygon.length - 1) % polygon.length];
      const startInside = plane.inside(start);
      const endInside = plane.inside(end);
      if (startInside && endInside) clipped.push(end);
      else if (startInside) clipped.push(plane.intersection(start, end));
      else if (endInside) {
        clipped.push(plane.intersection(start, end));
        clipped.push(end);
      }
    });
    return clipped;
  }, points);
}

function interpolatePoint3(start: Point3, end: Point3, amount: number): Point3 {
  return {
    x: start.x + (end.x - start.x) * amount,
    y: start.y + (end.y - start.y) * amount,
    z: start.z + (end.z - start.z) * amount,
  };
}

function clipSegmentToSectionBox(
  start: Point3,
  end: Point3,
  bounds: SectionBounds,
) {
  let minimum = 0;
  let maximum = 1;
  const axes: [number, number, number, number][] = [
    [start.x, end.x, bounds.minX, bounds.maxX],
    [start.y, end.y, bounds.minY, bounds.maxY],
    [start.z, end.z, bounds.minZ, bounds.maxZ],
  ];
  for (const [startValue, endValue, lower, upper] of axes) {
    const direction = endValue - startValue;
    if (Math.abs(direction) < 0.00001) {
      if (startValue < lower || startValue > upper) return null;
      continue;
    }
    const first = (lower - startValue) / direction;
    const second = (upper - startValue) / direction;
    minimum = Math.max(minimum, Math.min(first, second));
    maximum = Math.min(maximum, Math.max(first, second));
    if (minimum > maximum) return null;
  }
  return [
    interpolatePoint3(start, end, minimum),
    interpolatePoint3(start, end, maximum),
  ] as [Point3, Point3];
}

function sectionBoundaryFaces(
  start: Point3,
  end: Point3,
  bounds: SectionBounds,
) {
  const tolerance = 0.002;
  const coordinate = (point: Point3, face: SectionFace) =>
    face.endsWith("X") ? point.x : face.endsWith("Y") ? point.y : point.z;
  return (Object.keys(bounds) as SectionFace[]).filter(
    (face) =>
      Math.abs(coordinate(start, face) - bounds[face]) < tolerance &&
      Math.abs(coordinate(end, face) - bounds[face]) < tolerance,
  );
}

function sectionCapLoops(segments: [Point3, Point3][]) {
  const tolerance = 0.002;
  const samePoint = (first: Point3, second: Point3) =>
    Math.abs(first.x - second.x) < tolerance &&
    Math.abs(first.y - second.y) < tolerance &&
    Math.abs(first.z - second.z) < tolerance;
  const unused = [...segments];
  const loops: Point3[][] = [];

  while (unused.length) {
    const [start, end] = unused.pop()!;
    const loop = [start, end];
    let closed = false;
    while (unused.length) {
      const tail = loop[loop.length - 1];
      const nextIndex = unused.findIndex(
        ([first, second]) => samePoint(first, tail) || samePoint(second, tail),
      );
      if (nextIndex < 0) break;
      const [first, second] = unused.splice(nextIndex, 1)[0];
      loop.push(samePoint(first, tail) ? second : first);
      if (samePoint(loop[loop.length - 1], loop[0])) {
        loop.pop();
        closed = true;
        break;
      }
    }
    if (closed && loop.length >= 3) loops.push(loop);
  }
  return loops;
}

function renderDepthScene(
  context: CanvasRenderingContext2D,
  canvas: HTMLCanvasElement,
  width: number,
  height: number,
  surfaces: DepthSurface[],
  lines: DepthLine[],
) {
  const rasterScale = Math.min(2, Math.max(1, window.devicePixelRatio || 1));
  const rasterWidth = Math.max(1, Math.ceil(width * rasterScale));
  const rasterHeight = Math.max(1, Math.ceil(height * rasterScale));
  const scalePoint = (point: DepthPoint): DepthPoint => ({
    x: point.x * rasterScale,
    y: point.y * rasterScale,
    depth: point.depth,
  });
  const rasterSurfaces = surfaces.map((surface) => ({
    ...surface,
    points: surface.points.map(scalePoint),
    lineWidth: surface.lineWidth * rasterScale,
  }));
  const rasterLines = lines.map((line) => ({
    ...line,
    points: line.points.map(scalePoint),
    lineWidth: line.lineWidth * rasterScale,
  }));
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

  rasterSurfaces.forEach((surface) => {
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

  rasterSurfaces.forEach((surface) => {
    if (surface.outline === false) return;
    renderLine({
      points: [...surface.points, surface.points[0]],
      stroke: surface.stroke,
      lineWidth: surface.lineWidth,
    });
  });
  rasterLines.forEach(renderLine);

  layerContext.putImageData(image, 0, 0);
  context.save();
  context.setTransform(1, 0, 0, 1, 0, 0);
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = "high";
  context.drawImage(layer, 0, 0, canvas.width, canvas.height);
  context.restore();
}

function depthAtScreenPoint(point: ScreenPoint, polygon: DepthPoint[]) {
  let frontmost: number | null = null;
  triangulateDepthPolygon(polygon).forEach(([firstIndex, secondIndex, thirdIndex]) => {
    const first = polygon[firstIndex];
    const second = polygon[secondIndex];
    const third = polygon[thirdIndex];
    const denominator =
      (second.y - third.y) * (first.x - third.x) +
      (third.x - second.x) * (first.y - third.y);
    if (Math.abs(denominator) < 0.00001) return;
    const firstWeight =
      ((second.y - third.y) * (point.x - third.x) +
        (third.x - second.x) * (point.y - third.y)) /
      denominator;
    const secondWeight =
      ((third.y - first.y) * (point.x - third.x) +
        (first.x - third.x) * (point.y - third.y)) /
      denominator;
    const thirdWeight = 1 - firstWeight - secondWeight;
    if (firstWeight < -0.001 || secondWeight < -0.001 || thirdWeight < -0.001) return;
    const depth =
      first.depth * firstWeight +
      second.depth * secondWeight +
      third.depth * thirdWeight;
    frontmost = frontmost === null ? depth : Math.max(frontmost, depth);
  });
  return frontmost;
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

function wallInwardNormal(
  wall: { start: Point2; end: Point2 },
  points: Point2[],
  closed: boolean,
) {
  const deltaX = wall.end.x - wall.start.x;
  const deltaZ = wall.end.z - wall.start.z;
  const length = Math.hypot(deltaX, deltaZ) || 1;
  const signedArea = points.reduce((area, point, index) => {
    const next = points[(index + 1) % points.length];
    return area + point.x * next.z - next.x * point.z;
  }, 0);
  const inwardDirection = closed && signedArea < 0 ? -1 : 1;
  return {
    x: (-deltaZ / length) * inwardDirection,
    z: (deltaX / length) * inwardDirection,
  };
}

function lineIntersection(
  firstStart: Point2,
  firstEnd: Point2,
  secondStart: Point2,
  secondEnd: Point2,
) {
  const firstX = firstEnd.x - firstStart.x;
  const firstZ = firstEnd.z - firstStart.z;
  const secondX = secondEnd.x - secondStart.x;
  const secondZ = secondEnd.z - secondStart.z;
  const denominator = firstX * secondZ - firstZ * secondX;
  if (Math.abs(denominator) < 0.00001) return null;
  const amount =
    ((secondStart.x - firstStart.x) * secondZ -
      (secondStart.z - firstStart.z) * secondX) /
    denominator;
  return {
    x: firstStart.x + firstX * amount,
    z: firstStart.z + firstZ * amount,
  };
}

function interiorWallFacePolygon(
  points: Point2[],
  thicknesses: StudSize[],
  closed: boolean,
) {
  const segments = wallSegments(points, closed);
  if (!closed || segments.length < 3) return [];
  const offsetSegments = segments.map((wall) => {
    const inward = wallInwardNormal(wall, points, closed);
    const thickness = (thicknesses[wall.index] ?? 5.5) / 12;
    return {
      start: {
        x: wall.start.x + inward.x * thickness,
        z: wall.start.z + inward.z * thickness,
      },
      end: {
        x: wall.end.x + inward.x * thickness,
        z: wall.end.z + inward.z * thickness,
      },
    };
  });
  return offsetSegments.map((current, index) => {
    const previous =
      offsetSegments[(index + offsetSegments.length - 1) % offsetSegments.length];
    return lineIntersection(previous.start, previous.end, current.start, current.end) ??
      current.start;
  });
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
  const [splitPosition, setSplitPosition] = useState(50);
  const [isResizingSplit, setIsResizingSplit] = useState(false);
  const [command, setCommand] = useState<DrawCommand>("select");
  const [wallPoints, setWallPoints] = useState<Point2[]>(INITIAL_WALL_POINTS);
  const [wallsClosed, setWallsClosed] = useState(true);
  const [roofPoints, setRoofPoints] = useState<Point2[]>(INITIAL_ROOF_POINTS);
  const [roofClosed, setRoofClosed] = useState(true);
  const [wallHeights, setWallHeights] = useState([9, 9, 9, 9]);
  const [wallThicknesses, setWallThicknesses] = useState<StudSize[]>([
    5.5, 5.5, 5.5, 5.5,
  ]);
  const [roofBase, setRoofBase] = useState(DEFAULT_BEARING_ELEVATION_FEET);
  const [clipWalls, setClipWalls] = useState(false);
  const [pitch, setPitch] = useState(6);
  const [roofKind, setRoofKind] = useState<RoofKind>("hip");
  const [roofSystemType, setRoofSystemType] = useState<RoofSystemType>("rafter");
  const [roofAssembly, setRoofAssembly] = useState<RoofAssembly>(
    DEFAULT_ROOF_ASSEMBLY,
  );
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
  const [sectionBox, setSectionBox] = useState<SectionBounds>(INITIAL_SECTION_BOX);
  const [showSectionBox, setShowSectionBox] = useState(true);
  const [selectedSectionFace, setSelectedSectionFace] =
    useState<SectionFace | null>(null);
  const [sectionHandles, setSectionHandles] = useState<
    Partial<Record<SectionFace, ScreenPoint & { axis: ScreenPoint }>>
  >({});
  const [showWalls, setShowWalls] = useState(true);
  const [showTopology, setShowTopology] = useState(true);
  const [showDatums, setShowDatums] = useState(true);
  const [wallHandlePosition, setWallHandlePosition] =
    useState<ScreenPoint | null>(null);
  const [eaveHandlePosition, setEaveHandlePosition] =
    useState<ScreenPoint | null>(null);
  const [ceilingHandlePosition, setCeilingHandlePosition] =
    useState<ScreenPoint | null>(null);
  const [eaveCatalog, setEaveCatalog] = useState<EaveCondition[]>(
    INITIAL_EAVE_CONDITIONS,
  );
  const [relationships, setRelationships] = useState<EdgeRelationship[]>(
    INITIAL_ROOF_POINTS.map(() => ({
      conditionIds: defaultConditionIdsBySystem(INITIAL_EAVE_CONDITIONS),
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
  const drawingAreaRef = useRef<HTMLElement>(null);
  const splitDrag = useRef<{ pointerId: number } | null>(null);
  const sectionDrag = useRef<{
    pointerId: number;
    face: SectionFace;
    startX: number;
    startY: number;
    startValue: number;
    screenAxis: ScreenPoint;
  } | null>(null);
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
  const formPickRegions = useRef<
    { target: ModelPick; points: DepthPoint[] }[]
  >([]);
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
  const ceilingHeightDrag = useRef<{
    pointerId: number;
    startY: number;
    startHeight: number;
  } | null>(null);
  const didOrbit = useRef(false);

  const walls = wallSegments(wallPoints, wallsClosed);
  const roomInteriorPoints = interiorWallFacePolygon(
    wallPoints,
    wallThicknesses,
    wallsClosed,
  );
  const roofEdges = roofSegments(roofPoints, roofClosed);
  const structuralCeilingFootprint = useMemo(
    () =>
      roofClosed
        ? clipPlanPolygonToConvexBoundary(wallPoints, roofPoints)
        : [],
    [roofClosed, roofPoints, wallPoints],
  );
  const finishCeilingFootprint = useMemo(
    () =>
      roofClosed
        ? clipPlanPolygonToConvexBoundary(roomInteriorPoints, roofPoints)
        : [],
    [roofClosed, roofPoints, roomInteriorPoints],
  );
  const center = modelCenter(wallPoints, roofPoints);
  const conditionForEdge = useCallback(
    (index: number) =>
      activeConditionForRelationship(
        relationships[index],
        eaveCatalog,
        roofSystemType,
      ),
    [eaveCatalog, relationships, roofSystemType],
  );

  const edgeElevation = useCallback(
    (index: number) => roofBase + (relationships[index]?.elevationOffset ?? 0),
    [relationships, roofBase],
  );

  const maximumEaveElevationForEdge = useCallback(
    (index: number) => {
      const edge = roofEdges[index];
      if (!edge) return roofBase;
      const datumPoints =
        wallsClosed && wallPoints.length >= 3 ? wallPoints : roofPoints;
      if (datumPoints.length < 3) return roofBase;
      const minX = Math.min(...datumPoints.map((point) => point.x));
      const maxX = Math.max(...datumPoints.map((point) => point.x));
      const minZ = Math.min(...datumPoints.map((point) => point.z));
      const maxZ = Math.max(...datumPoints.map((point) => point.z));
      const nominalSlope = Math.max(0.01, pitch / 12);
      const ridgeRise =
        (Math.min(maxX - minX, maxZ - minZ) / 2) * nominalSlope;
      const wall = wallUnderRoofEdge(edge, walls);
      const bearingRun = wall
        ? pointToSegmentDistance(
            midpoint(edge.start, edge.end),
            wall.start,
            wall.end,
          )
        : 0;
      return roofBase + ridgeRise + bearingRun * nominalSlope;
    },
    [pitch, roofBase, roofEdges, roofPoints, wallPoints, walls, wallsClosed],
  );

  const isTrussRoof = roofSystemType !== "rafter";
  const trussWallBounds = useMemo(
    () => axisAlignedRectangleBounds(wallPoints),
    [wallPoints],
  );
  const trussRoofBounds = useMemo(
    () => axisAlignedRectangleBounds(roofPoints),
    [roofPoints],
  );
  const trussEdgeElevations = roofEdges.map((edge) => edgeElevation(edge.index));
  const trussBearingElevation = trussEdgeElevations[0] ?? roofBase;
  const trussEnvelopeIssue = !isTrussRoof
    ? null
    : !roofClosed || !wallsClosed
      ? "Close both the wall and roof boundaries to generate the experimental truss envelope."
      : roofKind !== "gable"
        ? "The first truss-envelope primitive supports the Gable roof form only."
        : trussWallBounds === null || trussRoofBounds === null
          ? "The first truss-envelope primitive requires rectangular wall and roof boundaries."
          : trussEdgeElevations.some(
                (elevation) =>
                  Math.abs(elevation - trussBearingElevation) > 0.001,
              )
            ? "The first truss-envelope primitive requires equal bearing elevations on every roof edge."
            : null;
  const ceilingDatumElevation = isTrussRoof
    ? trussBearingElevation
    : ceiling.bottomOfFramingElevationFeet;

  const derivedSupportForWall = useCallback(
    (wallIndex: number) => {
      const wall = walls[wallIndex];
      if (!wall) return undefined;
      const matchingEdges = roofEdges.filter(
        (edge) => wallUnderRoofEdge(edge, walls)?.index === wallIndex,
      );
      const edge = matchingEdges.sort(
        (first, second) =>
          edgeElevation(second.index) - edgeElevation(first.index),
      )[0];
      const authoredTop = wallHeights[wallIndex] ?? 9;
      const bearingElevation = edge ? edgeElevation(edge.index) : authoredTop;
      if (!edge || bearingElevation <= authoredTop + 0.001) return undefined;
      return {
        wallIndex,
        edgeIndex: edge.index,
        authoredTop,
        bearingElevation,
      };
    },
    [edgeElevation, roofEdges, wallHeights, walls],
  );

  const derivedRoofSupports = walls.flatMap((wall) => {
    const support = derivedSupportForWall(wall.index);
    return support ? [support] : [];
  });

  const updateRoofAssembly = (changes: Partial<RoofAssembly>) => {
    if (changes.structuralDepthInches !== undefined) {
      // A catalog detail remains an edge condition, not a second source of
      // roof depth. Keep its 2D rafter/truss depiction synchronized with the
      // one roof-wide structural member value.
      setEaveCatalog((catalog) =>
        catalog.map((condition) => ({
          ...condition,
          parameters: {
            ...condition.parameters,
            rafterDepth: changes.structuralDepthInches!,
            topChordDepth: changes.structuralDepthInches!,
          },
        })),
      );
    }
    setRoofAssembly((current) => ({ ...current, ...changes }));
  };

  const startCommand = (nextCommand: DrawCommand) => {
    setCommand(nextCommand);
    setSelection(null);
    setPointerWorld(null);
    if (nextCommand === "walls") {
      setWallPoints([]);
      setWallsClosed(false);
      setWallHeights([]);
      setWallThicknesses([]);
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
    setWallThicknesses((current) => [
      ...current.slice(0, wallPoints.length - 1),
      current[wallPoints.length - 1] ?? 5.5,
    ]);
    setCommand("select");
    setPointerWorld(null);
  };

  const closeRoof = () => {
    if (roofPoints.length < 3) return;
    const defaultConditionIds = defaultConditionIdsBySystem(eaveCatalog);
    const nextRelationships = roofPoints.map(() => ({
      conditionIds: defaultConditionIds,
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
    setWallThicknesses([5.5, 5.5, 5.5, 5.5]);
    setRoofBase(DEFAULT_BEARING_ELEVATION_FEET);
    setClipWalls(false);
    setPitch(6);
    setRoofKind("hip");
    setRoofSystemType("rafter");
    setRoofAssembly(DEFAULT_ROOF_ASSEMBLY);
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
        conditionIds: defaultConditionIdsBySystem(INITIAL_EAVE_CONDITIONS),
        elevationOffset: 0,
      })),
    );
    setSelection(null);
    setCommand("select");
    setPointerWorld(null);
    setOrbit({ yaw: -42, pitch: 24 });
    setFormZoom(1);
    setFormFocusOffset({ x: 0, y: 0, z: 0 });
    setSectionBox(INITIAL_SECTION_BOX);
    setShowSectionBox(true);
    setSelectedSectionFace(null);
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
    const safeChanges = changes.elevationOffset === undefined
      ? changes
      : {
          ...changes,
          elevationOffset: Math.min(
            maximumEaveElevationForEdge(edgeIndex) - roofBase,
            Math.max(-roofBase, changes.elevationOffset),
          ),
        };
    setRelationships((current) =>
      current.map((relationship, index) =>
        index === edgeIndex
          ? { ...relationship, ...safeChanges }
          : relationship,
      ),
    );
  };

  const assignConditionToEdge = (edgeIndex: number, conditionId: string) => {
    const nextCondition = eaveCatalog.find(
      (condition) => condition.id === conditionId,
    );
    if (!nextCondition) return;
    const previousCondition = conditionForEdge(edgeIndex);
    if (
      nextCondition.systemType === roofSystemType &&
      previousCondition !== undefined &&
      previousCondition.id !== nextCondition.id
    ) {
      const delta =
        (nextCondition.parameters.overhang -
          previousCondition.parameters.overhang) /
        12;
      setRoofPoints((current) =>
        shiftRoofEdgesByOverhang(current, [{ edgeIndex, delta }]),
      );
    }
    setRelationships((current) =>
      current.map((relationship, index) => {
        if (index !== edgeIndex) return relationship;
        const conditionIds = relationship.conditionIds.filter((id) => {
          const assigned = eaveCatalog.find((condition) => condition.id === id);
          return assigned?.systemType !== nextCondition.systemType;
        });
        return {
          ...relationship,
          conditionIds: [...conditionIds, nextCondition.id],
        };
      }),
    );
  };

  const changeRoofSystem = (systemType: RoofSystemType) => {
    const overhangChanges = relationships.flatMap((relationship, edgeIndex) => {
      const currentDetail = activeConditionForRelationship(
        relationship,
        eaveCatalog,
        roofSystemType,
      );
      const nextDetail = activeConditionForRelationship(
        relationship,
        eaveCatalog,
        systemType,
      );
      if (currentDetail === undefined || nextDetail === undefined) {
        return [];
      }
      return [{
        edgeIndex,
        delta:
          (nextDetail.parameters.overhang - currentDetail.parameters.overhang) /
          12,
      }];
    });
    setRoofPoints((current) =>
      shiftRoofEdgesByOverhang(current, overhangChanges),
    );
    if (systemType !== "rafter") {
      setRoofKind("gable");
    }
    setRoofSystemType(systemType);
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
    const parameters = {
      ...detailEditor.draft.parameters,
      // The detail lab is a fixed 6:12 graphic. The main roof-volume pitch is
      // the only slope control that can drive the 3D roof.
      pitch: DEFAULT_EAVE_PARAMETERS.pitch,
      // Conditions own the eave profile, but not the depth of the roof they
      // are assigned to. Saving cannot introduce a conflicting member depth.
      rafterDepth: roofAssembly.structuralDepthInches,
      topChordDepth: roofAssembly.structuralDepthInches,
    };
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
    const nextCatalog = detailEditor.id === null
      ? [...eaveCatalog, condition]
      : eaveCatalog.map((item) => item.id === condition.id ? condition : item);
    let nextRelationships = relationships;
    if (detailEditor.id !== null) {
      const previous = eaveCatalog.find((item) => item.id === detailEditor.id);
      if (previous !== undefined) {
        const previousTypeFallback = eaveCatalog.find(
          (item) =>
            item.id !== detailEditor.id &&
            item.systemType === previous.systemType,
        );
        nextRelationships = relationships.map((relationship) => {
          if (!relationship.conditionIds.includes(detailEditor.id!)) {
            return relationship;
          }
          const conditionIds = relationship.conditionIds.filter((assignedId) => {
            if (assignedId === detailEditor.id) return true;
            const assigned = eaveCatalog.find((item) => item.id === assignedId);
            return assigned?.systemType !== condition.systemType;
          });
          if (
            previous.systemType !== condition.systemType &&
            previousTypeFallback !== undefined &&
            !conditionIds.some((assignedId) =>
              eaveCatalog.find((item) => item.id === assignedId)?.systemType ===
              previous.systemType,
            )
          ) {
            conditionIds.push(previousTypeFallback.id);
          }
          return { ...relationship, conditionIds: [...new Set(conditionIds)] };
        });
        const overhangChanges = relationships.flatMap((relationship, edgeIndex) => {
          const previousActive = activeConditionForRelationship(
            relationship,
            eaveCatalog,
            roofSystemType,
          );
          const nextActive = activeConditionForRelationship(
            nextRelationships[edgeIndex],
            nextCatalog,
            roofSystemType,
          );
          if (!previousActive || !nextActive) return [];
          return [{
            edgeIndex,
            delta:
              (nextActive.parameters.overhang -
                previousActive.parameters.overhang) /
              12,
          }];
        });
        setRoofPoints((current) =>
          shiftRoofEdgesByOverhang(current, overhangChanges),
        );
      }
    }
    setEaveCatalog(nextCatalog);
    setRelationships(nextRelationships);
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
    const nextCatalog = eaveCatalog.filter(
      (condition) => condition.id !== selection.id,
    );
    const nextRelationships = relationships.map((relationship) => ({
      ...relationship,
      conditionIds: relationship.conditionIds.includes(selection.id)
        ? relationship.conditionIds.map((id) =>
            id === selection.id ? fallback.id : id,
          )
        : relationship.conditionIds,
    }));
    const overhangChanges = relationships.flatMap((relationship, edgeIndex) => {
      const previousActive = activeConditionForRelationship(
        relationship,
        eaveCatalog,
        roofSystemType,
      );
      const nextActive = activeConditionForRelationship(
        nextRelationships[edgeIndex],
        nextCatalog,
        roofSystemType,
      );
      if (!previousActive || !nextActive) return [];
      return [{
        edgeIndex,
        delta:
          (nextActive.parameters.overhang - previousActive.parameters.overhang) /
          12,
      }];
    });
    setRoofPoints((current) =>
      shiftRoofEdgesByOverhang(current, overhangChanges),
    );
    setRelationships(nextRelationships);
    setEaveCatalog(nextCatalog);
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

    if (showCeiling && finishCeilingFootprint.length >= 3) {
      const selected = selection?.kind === "ceiling";
      if (!isTrussRoof) {
        drawPolygon(
          context,
          structuralCeilingFootprint.map(project),
          selected ? "rgba(38, 127, 103, 0.13)" : "rgba(38, 127, 103, 0.05)",
          selected ? "#175c4c" : "rgba(23, 92, 76, 0.38)",
          selected ? 2.5 : 1,
        );
      }
      drawPolygon(
        context,
        finishCeilingFootprint.map(project),
        selected ? "rgba(238, 232, 221, 0.38)" : "rgba(238, 232, 221, 0.15)",
        selected ? "#766e63" : "rgba(118, 110, 99, 0.45)",
        selected ? 1.75 : 0.9,
      );
      const labelFootprint = finishCeilingFootprint.length >= 3
        ? finishCeilingFootprint
        : structuralCeilingFootprint;
      const roomCenter = labelFootprint.reduce(
        (result, point) => ({
          x: result.x + point.x / labelFootprint.length,
          z: result.z + point.z / labelFootprint.length,
        }),
        { x: 0, z: 0 },
      );
      const label = project(roomCenter);
      context.fillStyle = selected ? "#175c4c" : "#267f67";
      context.font = "700 8px monospace";
      context.textAlign = "center";
      context.fillText(
        `${isTrussRoof ? "TRUSS CEILING FINISH" : "CEILING"} · ${feetInches(ceilingDatumElevation)}`,
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
      const inward = wallInwardNormal(wall, wallPoints, wallsClosed);
      const thickness = (wallThicknesses[wall.index] ?? 5.5) / 12;
      const insideStart = project({
        x: wall.start.x + inward.x * thickness,
        z: wall.start.z + inward.z * thickness,
      });
      const insideEnd = project({
        x: wall.end.x + inward.x * thickness,
        z: wall.end.z + inward.z * thickness,
      });
      const selected =
        selection?.kind === "wall" && selection.index === wall.index;
      drawPolygon(
        context,
        [start, end, insideEnd, insideStart],
        selected ? "rgba(36, 127, 130, 0.20)" : "rgba(103, 109, 113, 0.16)",
        selected ? "#247f82" : "#777d81",
        selected ? 1.75 : 1,
      );
      context.strokeStyle = selected ? "#155f62" : "#4f5559";
      context.lineWidth = selected ? 2.5 : 1.75;
      context.lineCap = "butt";
      context.beginPath();
      context.moveTo(start.x, start.y);
      context.lineTo(end.x, end.y);
      context.stroke();
      const support = derivedSupportForWall(wall.index);
      if (support) {
        context.save();
        context.setLineDash([5, 4]);
        context.strokeStyle = "#16838a";
        context.lineWidth = 2.25;
        context.beginPath();
        context.moveTo(insideStart.x, insideStart.y);
        context.lineTo(insideEnd.x, insideEnd.y);
        context.stroke();
        context.restore();
      }
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
        `W${wall.index + 1} · ${STUD_SIZE_LABELS[wallThicknesses[wall.index] ?? 5.5]} · ${feetInches(wallHeights[wall.index] ?? 9)}${support ? " · ROOF SUPPORT" : ""}`,
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
    ceilingDatumElevation,
    derivedSupportForWall,
    finishCeilingFootprint,
    isTrussRoof,
    pointerWorld,
    roofClosed,
    roofEdges,
    roofPoints,
    selection,
    showCeiling,
    structuralCeilingFootprint,
    wallHeights,
    wallThicknesses,
    wallPoints,
    walls,
    wallsClosed,
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
    const modelSurfaces: ModelSurface[] = [];
    const modelLines: ModelLine[] = [];
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

    formWallRegions.current = [];
    const addWallSurfaces = (
      displayedRoofHeightAt: (point: Point2) => number | null,
    ) => {
      if (!showWalls) return;
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
        const inward = wallInwardNormal(wall, wallPoints, wallsClosed);
        const thickness = (wallThicknesses[wall.index] ?? 5.5) / 12;
        const outsideTop: Point3[] = [];
        const insideTop: Point3[] = [];
        const clippedHeight = (point: Point2) => {
          let roofHeight = clipWalls ? displayedRoofHeightAt(point) : null;
          const underRoofBoundary =
            pointInPlanPolygon(point, roofPoints) ||
            roofEdges.some(
              (edge) =>
                pointToSegmentDistance(point, edge.start, edge.end) < 0.02,
            );
          if (clipWalls && roofHeight === null && underRoofBoundary) {
            roofHeight = Math.min(
              roofBase,
              ...roofEdges.map((edge) => edgeElevation(edge.index)),
            );
          }
          return roofHeight === null
            ? height
            : Math.min(height, roofHeight - 0.02);
        };
        for (let sample = 0; sample <= 48; sample += 1) {
          const amount = sample / 48;
          const outsidePoint = {
            x: wall.start.x + (wall.end.x - wall.start.x) * amount,
            z: wall.start.z + (wall.end.z - wall.start.z) * amount,
          };
          const insidePoint = {
            x: outsidePoint.x + inward.x * thickness,
            z: outsidePoint.z + inward.z * thickness,
          };
          outsideTop.push({
            ...outsidePoint,
            y: clippedHeight(outsidePoint),
          });
          insideTop.push({
            ...insidePoint,
            y: clippedHeight(insidePoint),
          });
        }
        const outsideFace = [
          { x: wall.start.x, y: 0, z: wall.start.z },
          { x: wall.end.x, y: 0, z: wall.end.z },
          ...[...outsideTop].reverse(),
        ];
        const insideStart = {
          x: wall.start.x + inward.x * thickness,
          z: wall.start.z + inward.z * thickness,
        };
        const insideEnd = {
          x: wall.end.x + inward.x * thickness,
          z: wall.end.z + inward.z * thickness,
        };
        const insideFace = [
          { ...insideEnd, y: 0 },
          { ...insideStart, y: 0 },
          ...insideTop,
        ];
        const topFace = [...outsideTop, ...[...insideTop].reverse()];
        const bottomFace = [
          { x: wall.end.x, y: 0, z: wall.end.z },
          { x: wall.start.x, y: 0, z: wall.start.z },
          { ...insideStart, y: 0 },
          { ...insideEnd, y: 0 },
        ];
        const startCap = [
          { x: wall.start.x, y: 0, z: wall.start.z },
          { ...insideStart, y: 0 },
          insideTop[0],
          outsideTop[0],
        ];
        const endCap = [
          { ...insideEnd, y: 0 },
          { x: wall.end.x, y: 0, z: wall.end.z },
          outsideTop[outsideTop.length - 1],
          insideTop[insideTop.length - 1],
        ];
        const projected = outsideFace.map(project);
        formWallRegions.current.push({ index: wall.index, points: projected });
        const selectedWall =
          selection?.kind === "wall" && selection.index === wall.index;
        [outsideFace, insideFace, topFace, startCap, endCap, bottomFace].forEach(
          (points, faceIndex) => {
            modelSurfaces.push({
              points,
              pick: { kind: "wall", index: wall.index },
              solidId: `wall-${wall.index}`,
              fill: selectedWall
                ? faceIndex === 2
                  ? "#a8cfcd"
                  : "#d7e7e5"
                : faceIndex === 2
                  ? "#c8c3b9"
                  : "#ded9cf",
              stroke: selectedWall ? "#16838a" : "#aaa399",
              lineWidth: selectedWall ? 2.2 : 0.9,
            });
          },
        );
      });
    };

    const addDerivedRoofSupportSurfaces = (
      roofUndersideAt: (point: Point2) => number | null,
    ) => {
      if (!showWalls) return;
      walls.forEach((wall) => {
        const support = derivedSupportForWall(wall.index);
        if (!support) return;
        const inward = wallInwardNormal(wall, wallPoints, wallsClosed);
        const thickness = (wallThicknesses[wall.index] ?? 5.5) / 12;
        const outsideBottom: Point3[] = [];
        const insideBottom: Point3[] = [];
        const outsideTop: Point3[] = [];
        const insideTop: Point3[] = [];
        for (let sample = 0; sample <= 48; sample += 1) {
          const amount = sample / 48;
          const outsidePoint = {
            x: wall.start.x + (wall.end.x - wall.start.x) * amount,
            z: wall.start.z + (wall.end.z - wall.start.z) * amount,
          };
          const insidePoint = {
            x: outsidePoint.x + inward.x * thickness,
            z: outsidePoint.z + inward.z * thickness,
          };
          const supportTopAt = (point: Point2) =>
            Math.max(
              support.authoredTop,
              roofUndersideAt(point) ?? support.bearingElevation,
            );
          outsideBottom.push({ ...outsidePoint, y: support.authoredTop });
          insideBottom.push({ ...insidePoint, y: support.authoredTop });
          outsideTop.push({ ...outsidePoint, y: supportTopAt(outsidePoint) });
          insideTop.push({ ...insidePoint, y: supportTopAt(insidePoint) });
        }
        const faces = [
          [...outsideBottom, ...[...outsideTop].reverse()],
          [[...insideBottom].reverse(), ...insideTop].flat(),
          [...outsideTop, ...[...insideTop].reverse()],
          [[...outsideBottom].reverse(), ...insideBottom].flat(),
          [outsideBottom[0], insideBottom[0], insideTop[0], outsideTop[0]],
          [
            insideBottom[insideBottom.length - 1],
            outsideBottom[outsideBottom.length - 1],
            outsideTop[outsideTop.length - 1],
            insideTop[insideTop.length - 1],
          ],
        ];
        const selectedWall =
          selection?.kind === "wall" && selection.index === wall.index;
        faces.forEach((points, faceIndex) => {
          modelSurfaces.push({
            points,
            pick: { kind: "wall", index: wall.index },
            solidId: `derived-roof-support-${wall.index}`,
            fill: selectedWall
              ? faceIndex === 2
                ? "#5ca9a8"
                : "#96ceca"
              : faceIndex === 2
                ? "#70aaa8"
                : "#a7cac6",
            stroke: selectedWall ? "#0f696c" : "#4f8583",
            lineWidth: selectedWall ? 2.2 : 1,
          });
        });
      });
    };

    const addCeilingSurfaces = (
      roofUndersideAt: (point: Point2) => number | null,
      roofFinishUndersideAt: (point: Point2) => number | null,
    ) => {
      formCeilingRegions.current = [];
      if (
        !showCeiling ||
        !roofClosed ||
        structuralCeilingFootprint.length < 3 ||
        finishCeilingFootprint.length < 3
      ) {
        setCeilingHandlePosition((current) => (current ? null : current));
        return;
      }
      const framingBottom = ceiling.bottomOfFramingElevationFeet;
      const framingThickness = ceiling.framingThicknessInches / 12;
      const finishThickness = ceiling.finishThicknessInches / 12;
      const selectedCeiling = selection?.kind === "ceiling";
      const subdivisions = 12;
      const ceilingFramingTopAt = (point: Point2) =>
        Math.max(
          framingBottom,
          Math.min(
            framingBottom + framingThickness,
            (roofFinishUndersideAt(point) ?? framingBottom) - 0.01,
          ),
        );
      const clippedBottomAt = (point: Point2) =>
        Math.min(framingBottom, roofUndersideAt(point) ?? framingBottom);
      const finishBottomAt = (point: Point2) => {
        const roofHeight = roofUndersideAt(point);
        if (roofHeight === null || roofHeight >= framingBottom) {
          return framingBottom - finishThickness;
        }
        const sampleDistance = 0.04;
        const sampleRoofHeight = (samplePoint: Point2) =>
          roofUndersideAt(samplePoint) ?? roofHeight;
        const slopeX =
          (sampleRoofHeight({ x: point.x + sampleDistance, z: point.z }) -
            sampleRoofHeight({ x: point.x - sampleDistance, z: point.z })) /
          (sampleDistance * 2);
        const slopeZ =
          (sampleRoofHeight({ x: point.x, z: point.z + sampleDistance }) -
            sampleRoofHeight({ x: point.x, z: point.z - sampleDistance })) /
          (sampleDistance * 2);
        const verticalThickness =
          finishThickness * Math.sqrt(1 + slopeX * slopeX + slopeZ * slopeZ);
        return roofHeight - verticalThickness;
      };

      const addClosedLayer = ({
        footprint,
        solidId,
        topAt,
        bottomAt,
        limitAt,
        breakAt,
        topFill,
        bottomFill,
        sideFill,
        stroke,
      }: {
        footprint: Point2[];
        solidId: string;
        topAt: (point: Point2) => number;
        bottomAt: (point: Point2) => number;
        limitAt?: {
          heightAt: (point: Point2) => number | null;
          minimum: number;
        };
        breakAt?: {
          heightAt: (point: Point2) => number | null;
          height: number;
        };
        topFill: (checker: boolean) => string;
        bottomFill: string;
        sideFill: string;
        stroke: string;
      }) => {
        if (footprint.length < 3) return;
        const bounds = footprint.reduce(
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
        const cellWidth = (bounds.maxX - bounds.minX) / subdivisions;
        const cellDepth = (bounds.maxZ - bounds.minZ) / subdivisions;
        const limitedBoundaryEdges = new Map<
          string,
          { start: Point2; end: Point2; count: number }
        >();
        const boundaryEdgeKey = (start: Point2, end: Point2) => {
          const pointKey = (point: Point2) =>
            `${point.x.toFixed(5)}:${point.z.toFixed(5)}`;
          const startKey = pointKey(start);
          const endKey = pointKey(end);
          return startKey < endKey
            ? `${startKey}|${endKey}`
            : `${endKey}|${startKey}`;
        };
        for (let xIndex = 0; xIndex < subdivisions; xIndex += 1) {
          for (let zIndex = 0; zIndex < subdivisions; zIndex += 1) {
            const x0 = bounds.minX + xIndex * cellWidth;
            const x1 = bounds.minX + (xIndex + 1) * cellWidth;
            const z0 = bounds.minZ + zIndex * cellDepth;
            const z1 = bounds.minZ + (zIndex + 1) * cellDepth;
            const corners: Point2[] = [
              { x: x0, z: z0 },
              { x: x1, z: z0 },
              { x: x1, z: z1 },
              { x: x0, z: z1 },
            ];
            let boundedCell = clipPlanPolygonToConvexBoundary(corners, footprint);
            if (limitAt) {
              boundedCell = clipPlanPolygonByHeight(
                boundedCell,
                limitAt.heightAt,
                limitAt.minimum,
                true,
              );
            }
            if (boundedCell.length < 3) continue;
            const patches = breakAt
              ? [
                  clipPlanPolygonByHeight(
                    boundedCell,
                    breakAt.heightAt,
                    breakAt.height,
                    true,
                  ),
                  clipPlanPolygonByHeight(
                    boundedCell,
                    breakAt.heightAt,
                    breakAt.height,
                    false,
                  ),
                ].filter((patch) => patch.length >= 3)
              : [boundedCell];
            patches.forEach((patch) => {
              const topFace = patch.map((point) => ({ ...point, y: topAt(point) }));
              const bottomFace = patch.map((point) => ({
                ...point,
                y: bottomAt(point),
              }));
              const planPatch = patch.map((point) => ({
                x: point.x,
                y: point.z,
                depth: 0,
              }));
              triangulateDepthPolygon(planPatch).forEach((triangle) => {
                modelSurfaces.push({
                  points: triangle.map((index) => topFace[index]),
                  pick: { kind: "ceiling", id: ceiling.id },
                  solidId,
                  fill: topFill((xIndex + zIndex) % 2 === 0),
                  stroke,
                  lineWidth: selectedCeiling ? 1.1 : 0.4,
                });
                modelSurfaces.push({
                  points: triangle
                    .map((index) => bottomFace[index])
                    .reverse(),
                  pick: { kind: "ceiling", id: ceiling.id },
                  solidId,
                  fill: bottomFill,
                  stroke,
                  lineWidth: selectedCeiling ? 1 : 0.35,
                });
              });
              if (limitAt) {
                patch.forEach((start, edgeIndex) => {
                  const end = patch[(edgeIndex + 1) % patch.length];
                  const key = boundaryEdgeKey(start, end);
                  const existing = limitedBoundaryEdges.get(key);
                  limitedBoundaryEdges.set(key, {
                    start,
                    end,
                    count: (existing?.count ?? 0) + 1,
                  });
                });
              }
              formCeilingRegions.current.push(bottomFace.map(project));
            });
          }
        }
        if (limitAt) {
          limitedBoundaryEdges.forEach(({ start, end, count }) => {
            if (count !== 1) return;
            modelSurfaces.push({
              points: [
                { ...start, y: topAt(start) },
                { ...end, y: topAt(end) },
                { ...end, y: bottomAt(end) },
                { ...start, y: bottomAt(start) },
              ],
              pick: { kind: "ceiling", id: ceiling.id },
              solidId,
              fill: sideFill,
              stroke,
              lineWidth: selectedCeiling ? 1.5 : 0.7,
            });
          });
        }
        if (!limitAt) footprint.forEach((start, edgeIndex) => {
          const end = footprint[(edgeIndex + 1) % footprint.length];
          const samples = Array.from({ length: 13 }, (_, index) => {
            const amount = index / 12;
            const point = {
              x: start.x + (end.x - start.x) * amount,
              z: start.z + (end.z - start.z) * amount,
            };
            return { point, top: topAt(point), bottom: bottomAt(point) };
          });
          modelSurfaces.push({
            points: [
              ...samples.map(({ point, top }) => ({ ...point, y: top })),
              ...samples
                .slice()
                .reverse()
                .map(({ point, bottom }) => ({ ...point, y: bottom })),
            ],
            pick: { kind: "ceiling", id: ceiling.id },
            solidId,
            fill: sideFill,
            stroke,
            lineWidth: selectedCeiling ? 1.5 : 0.7,
          });
        });
      };

      if (isTrussRoof) {
        const finishTop = ceilingDatumElevation;
        const finishBottom = finishTop - finishThickness;
        addClosedLayer({
          footprint: finishCeilingFootprint,
          solidId: `ceiling-${ceiling.id}-truss-finish`,
          topAt: () => finishTop,
          bottomAt: () => finishBottom,
          topFill: () => (selectedCeiling ? "#eee8dd" : "#e7e1d7"),
          bottomFill: selectedCeiling ? "#f6f2eb" : "#eeeae3",
          sideFill: "#ded7cc",
          stroke: selectedCeiling ? "#766e63" : "#aaa399",
        });
        ceilingOutline = selectedCeiling
          ? finishCeilingFootprint.map((point) =>
              project({ ...point, y: finishBottom }),
            )
          : [];
        setCeilingHandlePosition((current) => (current ? null : current));
        return;
      }

      addClosedLayer({
        footprint: structuralCeilingFootprint,
        solidId: `ceiling-${ceiling.id}-framing`,
        topAt: ceilingFramingTopAt,
        bottomAt: () => framingBottom,
        limitAt: {
          heightAt: roofFinishUndersideAt,
          minimum: framingBottom + 0.01,
        },
        topFill: (checker) =>
          selectedCeiling
            ? checker ? "#58a78f" : "#67b198"
            : checker ? "#82ad9e" : "#8ab6a6",
        bottomFill: selectedCeiling ? "#70b8a2" : "#9ac4b5",
        sideFill: selectedCeiling ? "#3f8d75" : "#759b8d",
        stroke: selectedCeiling ? "#175c4c" : "#647e75",
      });
      addClosedLayer({
        footprint: finishCeilingFootprint,
        solidId: `ceiling-${ceiling.id}-finish`,
        topAt: clippedBottomAt,
        bottomAt: finishBottomAt,
        breakAt: {
          heightAt: roofUndersideAt,
          height: framingBottom,
        },
        topFill: () => (selectedCeiling ? "#eee8dd" : "#e7e1d7"),
        bottomFill: selectedCeiling ? "#f6f2eb" : "#eeeae3",
        sideFill: "#ded7cc",
        stroke: selectedCeiling ? "#766e63" : "#aaa399",
      });

      ceilingOutline = [];
      if (selectedCeiling) {
        const anchor = finishCeilingFootprint.reduce(
          (result, point) => ({
            x: result.x + point.x / finishCeilingFootprint.length,
            z: result.z + point.z / finishCeilingFootprint.length,
          }),
          { x: 0, z: 0 },
        );
        const projectedAnchor = project({
          x: anchor.x,
          y: clippedBottomAt(anchor),
          z: anchor.z,
        });
        setCeilingHandlePosition((current) =>
          current &&
          Math.abs(current.x - projectedAnchor.x) < 0.25 &&
          Math.abs(current.y - projectedAnchor.y) < 0.25
            ? current
            : projectedAnchor,
        );
      } else {
        setCeilingHandlePosition((current) => (current ? null : current));
      }
    };

    const renderClippedModel = () => {
      const clippedSurfaces: DepthSurface[] = [];
      const clippedLines: DepthLine[] = [];
      const solidSurfaces = new Map<string, ModelSurface[]>();
      const capSegments = new Map<string, [Point3, Point3][]>();
      formPickRegions.current = [];
      modelSurfaces.forEach((surface) => {
        if (surface.solidId) {
          const grouped = solidSurfaces.get(surface.solidId) ?? [];
          grouped.push(surface);
          solidSurfaces.set(surface.solidId, grouped);
        }
        const clipped = clipPolygonToSectionBox(surface.points, sectionBox);
        if (clipped.length < 3) return;
        const projected = clipped.map(depthProject);
        clippedSurfaces.push({ ...surface, points: projected });
        if (surface.pick) {
          formPickRegions.current.push({ target: surface.pick, points: projected });
        }
        clipped.forEach((end, index) => {
          const start = clipped[(index + clipped.length - 1) % clipped.length];
          const boundaryFaces = sectionBoundaryFaces(start, end, sectionBox);
          if (!boundaryFaces.length) return;
          clippedLines.push({
            points: [depthProject(start), depthProject(end)],
            stroke: surface.solidId ? "#000000" : "#49382e",
            lineWidth: 2.6,
          });
          if (!surface.solidId) return;
          boundaryFaces.forEach((face) => {
            const coordinate = (point: Point3) =>
              face.endsWith("X") ? point.x : face.endsWith("Y") ? point.y : point.z;
            const surfaceIsCoplanar = surface.points.every(
              (point) => Math.abs(coordinate(point) - sectionBox[face]) < 0.002,
            );
            if (surfaceIsCoplanar) return;
            const key = `${surface.solidId}:${face}`;
            const grouped = capSegments.get(key) ?? [];
            grouped.push([start, end]);
            capSegments.set(key, grouped);
          });
        });
      });
      solidSurfaces.forEach((surfaces, solidId) => {
        (Object.keys(sectionBox) as SectionFace[]).forEach((face) => {
          const coordinate = (point: Point3) =>
            face.endsWith("X") ? point.x : face.endsWith("Y") ? point.y : point.z;
          const values = surfaces.flatMap((surface) => surface.points.map(coordinate));
          const crossesPlane =
            Math.min(...values) < sectionBox[face] - 0.002 &&
            Math.max(...values) > sectionBox[face] + 0.002;
          if (!crossesPlane) return;
          sectionCapLoops(capSegments.get(`${solidId}:${face}`) ?? []).forEach(
            (loop) => {
              clippedSurfaces.push({
                points: loop.map(depthProject),
                fill: "#77736d",
                stroke: "#000000",
                lineWidth: 1.8,
              });
            },
          );
        });
      });
      modelLines.forEach((line) => {
        line.points.slice(1).forEach((end, index) => {
          const clipped = clipSegmentToSectionBox(
            line.points[index],
            end,
            sectionBox,
          );
          if (!clipped) return;
          clippedLines.push({ ...line, points: clipped.map(depthProject) });
        });
      });
      renderDepthScene(
        context,
        canvas,
        width,
        height,
        clippedSurfaces,
        clippedLines,
      );

      if (!showSectionBox) {
        setSectionHandles((current) =>
          Object.keys(current).length ? {} : current,
        );
        return;
      }

      const xCenter = (sectionBox.minX + sectionBox.maxX) / 2;
      const yCenter = (sectionBox.minY + sectionBox.maxY) / 2;
      const zCenter = (sectionBox.minZ + sectionBox.maxZ) / 2;
      const corners: Point3[] = [
        { x: sectionBox.minX, y: sectionBox.minY, z: sectionBox.minZ },
        { x: sectionBox.maxX, y: sectionBox.minY, z: sectionBox.minZ },
        { x: sectionBox.maxX, y: sectionBox.maxY, z: sectionBox.minZ },
        { x: sectionBox.minX, y: sectionBox.maxY, z: sectionBox.minZ },
        { x: sectionBox.minX, y: sectionBox.minY, z: sectionBox.maxZ },
        { x: sectionBox.maxX, y: sectionBox.minY, z: sectionBox.maxZ },
        { x: sectionBox.maxX, y: sectionBox.maxY, z: sectionBox.maxZ },
        { x: sectionBox.minX, y: sectionBox.maxY, z: sectionBox.maxZ },
      ];
      const edgeIndices = [
        [0, 1], [1, 2], [2, 3], [3, 0],
        [4, 5], [5, 6], [6, 7], [7, 4],
        [0, 4], [1, 5], [2, 6], [3, 7],
      ];
      context.save();
      context.strokeStyle = "rgba(22, 131, 138, 0.72)";
      context.lineWidth = 1.25;
      context.setLineDash([5, 4]);
      edgeIndices.forEach(([startIndex, endIndex]) => {
        const start = project(corners[startIndex]);
        const end = project(corners[endIndex]);
        context.beginPath();
        context.moveTo(start.x, start.y);
        context.lineTo(end.x, end.y);
        context.stroke();
      });
      context.restore();

      const faceCenters: Record<SectionFace, Point3> = {
        minX: { x: sectionBox.minX, y: yCenter, z: zCenter },
        maxX: { x: sectionBox.maxX, y: yCenter, z: zCenter },
        minY: { x: xCenter, y: sectionBox.minY, z: zCenter },
        maxY: { x: xCenter, y: sectionBox.maxY, z: zCenter },
        minZ: { x: xCenter, y: yCenter, z: sectionBox.minZ },
        maxZ: { x: xCenter, y: yCenter, z: sectionBox.maxZ },
      };
      const nextHandles = {} as Record<
        SectionFace,
        ScreenPoint & { axis: ScreenPoint }
      >;
      (Object.keys(faceCenters) as SectionFace[]).forEach((face) => {
        const centerPoint = faceCenters[face];
        const projected = project(centerPoint);
        const axisPoint = project({
          x: centerPoint.x + (face.endsWith("X") ? 1 : 0),
          y: centerPoint.y + (face.endsWith("Y") ? 1 : 0),
          z: centerPoint.z + (face.endsWith("Z") ? 1 : 0),
        });
        nextHandles[face] = {
          ...projected,
          axis: {
            x: axisPoint.x - projected.x,
            y: axisPoint.y - projected.y,
          },
        };
      });
      setSectionHandles((current) => {
        const unchanged = (Object.keys(nextHandles) as SectionFace[]).every(
          (face) =>
            current[face] &&
            Math.abs(current[face]!.x - nextHandles[face].x) < 0.25 &&
            Math.abs(current[face]!.y - nextHandles[face].y) < 0.25,
        );
        return unchanged ? current : nextHandles;
      });
    };

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
      const bearingDatumPoints =
        wallsClosed && wallPoints.length >= 3 ? wallPoints : roofPoints;
      const bounds = bearingDatumPoints.reduce(
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
      const dominantX =
        bounds.maxX - bounds.minX >= bounds.maxZ - bounds.minZ;
      const roofCenter = {
        x: (bounds.minX + bounds.maxX) / 2,
        z: (bounds.minZ + bounds.maxZ) / 2,
      };
      const roofWidth = bounds.maxX - bounds.minX;
      const roofDepth = bounds.maxZ - bounds.minZ;
      const nominalSlope = Math.max(0.01, pitch / 12);
      const bearingRunForEdge = (edge: (typeof roofEdges)[number]) => {
        const wall = wallUnderRoofEdge(edge, walls);
        return wall
          ? pointToSegmentDistance(midpoint(edge.start, edge.end), wall.start, wall.end)
          : 0;
      };
      const bearingRuns = new Map(
        roofEdges.map((edge) => [edge.index, bearingRunForEdge(edge)]),
      );
      // `roofBase` is the bearing elevation at the wall line. The solved roof
      // surfaces are the structural underside, extended outward to the authored
      // roof boundary. Rafter depth is added above these fixed bearing planes.
      const structuralUndersideElevationForEdge = (
        edge: (typeof roofEdges)[number],
      ) =>
        edgeElevation(edge.index) -
        nominalSlope * (bearingRuns.get(edge.index) ?? 0);
      const shortSpan = Math.min(roofWidth, roofDepth);
      const ridgeInset = shortSpan / 2;
      const rise = Math.max(0.25, ridgeInset * nominalSlope);
      const ridgeElevation = roofBase + rise;
      const ridgeA: Point3 = dominantX
        ? {
            x: bounds.minX + ridgeInset,
            y: ridgeElevation,
            z: roofCenter.z,
          }
        : {
            x: roofCenter.x,
            y: ridgeElevation,
            z: bounds.minZ + ridgeInset,
          };
      const ridgeB: Point3 = dominantX
        ? {
            x: bounds.maxX - ridgeInset,
            y: ridgeElevation,
            z: roofCenter.z,
          }
        : {
            x: roofCenter.x,
            y: ridgeElevation,
            z: bounds.maxZ - ridgeInset,
          };
      const peak: Point3 = {
        x: roofCenter.x,
        y:
          roofKind === "shed"
            ? roofBase + rise * 0.45
            : ridgeElevation,
        z: roofCenter.z,
      };
      const transitionSlopeAtLoweredCorner = (elevation: number) =>
        roofKind === "hip"
          ? Math.max(
              nominalSlope,
              (ridgeElevation - elevation) / Math.max(0.01, ridgeInset),
            )
          : nominalSlope;
      const eaveElevations = new Map(
        roofEdges.map((edge) => [
          edge.index,
          structuralUndersideElevationForEdge(edge),
        ]),
      );
      const edgeProfiles = roofEdges.map((edge, edgePosition) => {
        const length = segmentLength(edge.start, edge.end);
        const eaveElevation = eaveElevations.get(edge.index) ?? roofBase;
        const previousEdge =
          roofEdges[
            (edgePosition + roofEdges.length - 1) % roofEdges.length
          ];
        const nextEdge =
          roofEdges[(edgePosition + 1) % roofEdges.length];
        const startElevation = Math.min(
          eaveElevation,
          eaveElevations.get(previousEdge.index) ?? eaveElevation,
        );
        const endElevation = Math.min(
          eaveElevation,
          eaveElevations.get(nextEdge.index) ?? eaveElevation,
        );
        const pointAlongEdge = (amount: number) => ({
          x: edge.start.x + (edge.end.x - edge.start.x) * amount,
          z: edge.start.z + (edge.end.z - edge.start.z) * amount,
        });
        const startRun = Math.min(
          length * 0.5,
          (eaveElevation - startElevation) /
            transitionSlopeAtLoweredCorner(startElevation),
        );
        const endRun = Math.min(
          length * 0.5,
          (eaveElevation - endElevation) /
            transitionSlopeAtLoweredCorner(endElevation),
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
            y: eaveElevation,
            z: startBend.z,
          },
          {
            x: endBend.x,
            y: eaveElevation,
            z: endBend.z,
          },
          {
            x: edge.end.x,
            y: endElevation,
            z: edge.end.z,
          },
        ];
        const hasTransitions =
          startElevation < eaveElevation - 0.0001 ||
          endElevation < eaveElevation - 0.0001;
        return {
          edge,
          hasRaisedTransitions: hasTransitions,
          points,
          ownedPoints: hasTransitions ? [points[1], points[2]] : points,
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
      const runsAlongRidgeForEdge = (edge: (typeof roofEdges)[number]) =>
        dominantX
          ? Math.abs(edge.end.x - edge.start.x) >=
            Math.abs(edge.end.z - edge.start.z)
          : Math.abs(edge.end.z - edge.start.z) >=
            Math.abs(edge.end.x - edge.start.x);
      const morphedRidgeEnd = (ridgeEnd: Point3) => {
        if (roofKind !== "hip") return ridgeEnd;
        const endEdge = roofEdges
          .filter((edge) => !runsAlongRidgeForEdge(edge))
          .sort(
            (first, second) =>
              segmentLength(midpoint(first.start, first.end), ridgeEnd) -
              segmentLength(midpoint(second.start, second.end), ridgeEnd),
          )[0];
        if (!endEdge) return ridgeEnd;
        const maximumElevation = maximumEaveElevationForEdge(endEdge.index);
        const availableRise = Math.max(0.001, maximumElevation - roofBase);
        const progress = Math.max(
          0,
          Math.min(
            1,
            (edgeElevation(endEdge.index) - roofBase) / availableRise,
          ),
        );
        const edgeMiddle = midpoint(endEdge.start, endEdge.end);
        return {
          x: ridgeEnd.x + (edgeMiddle.x - ridgeEnd.x) * progress,
          y: ridgeEnd.y,
          z: ridgeEnd.z + (edgeMiddle.z - ridgeEnd.z) * progress,
        };
      };
      const resolvedRidgeA = morphedRidgeEnd(ridgeA);
      const resolvedRidgeB = morphedRidgeEnd(ridgeB);
      const nearestRidgeEnd = (point: Point2) =>
        dominantX
          ? Math.abs(point.x - ridgeA.x) <=
            Math.abs(point.x - ridgeB.x)
            ? resolvedRidgeA
            : resolvedRidgeB
          : Math.abs(point.z - ridgeA.z) <=
              Math.abs(point.z - ridgeB.z)
            ? resolvedRidgeA
            : resolvedRidgeB;
      const faceDefinitions = edgeProfiles.map(
        ({
          edge,
          points,
          hasRaisedTransitions,
          ownedPoints,
        }) => {
        const edgeMidpoint = midpoint(edge.start, edge.end);
        const runsAlongRidge = runsAlongRidgeForEdge(edge);
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
          runsAlongRidge,
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

      if (isTrussRoof) {
        const bottomChordElevation = trussBearingElevation;
        addWallSurfaces(() => bottomChordElevation);
        addDerivedRoofSupportSurfaces(() => bottomChordElevation);
        addCeilingSurfaces(
          () => bottomChordElevation,
          () => bottomChordElevation,
        );

        if (trussEnvelopeIssue === null && trussRoofBounds !== null) {
          const lengthRunsAlongX =
            trussRoofBounds.maxX - trussRoofBounds.minX >=
            trussRoofBounds.maxZ - trussRoofBounds.minZ;
          const shortSpan = lengthRunsAlongX
            ? trussRoofBounds.maxZ - trussRoofBounds.minZ
            : trussRoofBounds.maxX - trussRoofBounds.minX;
          const apexElevation =
            bottomChordElevation + (shortSpan / 2) * nominalSlope;
          const profileAt = (lengthCoordinate: number): Point3[] =>
            lengthRunsAlongX
              ? [
                  {
                    x: lengthCoordinate,
                    y: bottomChordElevation,
                    z: trussRoofBounds.minZ,
                  },
                  {
                    x: lengthCoordinate,
                    y: bottomChordElevation,
                    z: trussRoofBounds.maxZ,
                  },
                  {
                    x: lengthCoordinate,
                    y: apexElevation,
                    z: (trussRoofBounds.minZ + trussRoofBounds.maxZ) / 2,
                  },
                ]
              : [
                  {
                    x: trussRoofBounds.minX,
                    y: bottomChordElevation,
                    z: lengthCoordinate,
                  },
                  {
                    x: trussRoofBounds.maxX,
                    y: bottomChordElevation,
                    z: lengthCoordinate,
                  },
                  {
                    x: (trussRoofBounds.minX + trussRoofBounds.maxX) / 2,
                    y: apexElevation,
                    z: lengthCoordinate,
                  },
                ];
          const startProfile = profileAt(
            lengthRunsAlongX ? trussRoofBounds.minX : trussRoofBounds.minZ,
          );
          const endProfile = profileAt(
            lengthRunsAlongX ? trussRoofBounds.maxX : trussRoofBounds.maxZ,
          );
          const trussEnvelopeFaces = [
            startProfile,
            [...endProfile].reverse(),
            [startProfile[0], endProfile[0], endProfile[1], startProfile[1]],
            [startProfile[0], startProfile[2], endProfile[2], endProfile[0]],
            [startProfile[2], startProfile[1], endProfile[1], endProfile[2]],
          ];
          const selectedRoof = selection?.kind === "roof";
          trussEnvelopeFaces.forEach((points, faceIndex) => {
            formRoofRegions.current.push(points.map(project));
            modelSurfaces.push({
              points,
              pick: { kind: "roof" },
              solidId: "truss-envelope",
              fill: selectedRoof
                ? faceIndex < 2
                  ? "#c96f32"
                  : "#e38a4d"
                : faceIndex < 2
                  ? "#c77a45"
                  : faceIndex === 2
                    ? "#b96b3d"
                    : "#df8347",
              stroke: selectedRoof ? "#171512" : "#8d542f",
              lineWidth: selectedRoof ? 2.2 : 1.15,
            });
          });
        }

        roofEdges.forEach((edge) => {
          const profile = [
            { ...edge.start, y: edgeElevation(edge.index) },
            { ...edge.end, y: edgeElevation(edge.index) },
          ];
          const projectedProfile = profile.map(project);
          formEaveRegions.current.push({
            index: edge.index,
            points: projectedProfile,
          });
          const selectedEdge =
            selection?.kind === "roof-edge" && selection.index === edge.index;
          eaveMarkers.push({
            point: {
              x: (projectedProfile[0].x + projectedProfile[1].x) / 2,
              y: (projectedProfile[0].y + projectedProfile[1].y) / 2,
            },
            selected: selectedEdge,
          });
        });

        renderClippedModel();

        if (selection?.kind === "ceiling" && ceilingOutline.length >= 3) {
          context.save();
          context.setLineDash([7, 5]);
          context.strokeStyle = "#766e63";
          context.lineWidth = 2.5;
          context.beginPath();
          context.moveTo(ceilingOutline[0].x, ceilingOutline[0].y);
          ceilingOutline
            .slice(1)
            .forEach((point) => context.lineTo(point.x, point.y));
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

        if (trussEnvelopeIssue !== null) {
          context.fillStyle = "rgba(255, 247, 237, 0.96)";
          context.fillRect(14, 14, Math.min(470, width - 28), 48);
          context.strokeStyle = "#c66a2b";
          context.strokeRect(14, 14, Math.min(470, width - 28), 48);
          context.fillStyle = "#9b461f";
          context.font = "700 9px monospace";
          context.fillText("EXPERIMENTAL TRUSS ENVELOPE PAUSED", 24, 33);
          context.font = "600 8px sans-serif";
          context.fillText(trussEnvelopeIssue, 24, 50);
        } else if (showDatums) {
          context.fillStyle = "#9b461f";
          context.font = "700 8px monospace";
          context.fillText(
            `TRUSS BOTTOM CHORD · ${feetInches(bottomChordElevation)}`,
            16,
            24,
          );
        }
        return;
      }

      // Roof topology follows the authored boundary: one continuous surface
      // per roof edge. A bearing offset may warp that surface, but it must not
      // create additional architectural faces or visible diagonal creases.
      const roofSurfaces = faces.map(({ index, points }) => ({ index, points }));
      const roofBoundaryPoints = edgeProfiles.flatMap(({ points }) => points);
      const displayedRoofHeightAt = (point: Point2) =>
        roofHeightFromFaces(
          point,
          roofSurfaces.map((surface) => surface.points),
        );
      const structuralTops = offsetRoofFacesWatertight(
        roofSurfaces.map((surface) => surface.points),
        roofAssembly.structuralDepthInches / 12,
        roofBoundaryPoints,
        nominalSlope,
      );
      const roofingTops = offsetRoofFacesWatertight(
        roofSurfaces.map((surface) => surface.points),
        (roofAssembly.structuralDepthInches +
          roofAssembly.buildUpThicknessInches) /
          12,
        roofBoundaryPoints,
        nominalSlope,
      );
      const faceAssemblies = roofSurfaces.map((surface, index) => ({
        face: surface,
        structuralUnderside: surface.points,
        structuralTop: structuralTops[index],
        roofingTop: roofingTops[index],
      }));
      const structuralUndersideHeightAt = (point: Point2) =>
        roofHeightFromFaces(
          point,
          roofSurfaces.map((surface) => surface.points),
        );
      const roofFinishUndersideHeightAt = (point: Point2) =>
        roofHeightFromFaces(point, structuralTops);
      addWallSurfaces(structuralUndersideHeightAt);
      addDerivedRoofSupportSurfaces(structuralUndersideHeightAt);
      addCeilingSurfaces(
        structuralUndersideHeightAt,
        roofFinishUndersideHeightAt,
      );
      const roofPointKey = (point: Point3) =>
        `${point.x.toFixed(4)}:${point.y.toFixed(4)}:${point.z.toFixed(4)}`;
      const roofingTopByPoint = new Map<string, Point3>();
      const structuralUndersideByPoint = new Map<string, Point3>();
      faceAssemblies.forEach(({ face, roofingTop, structuralUnderside }) => {
        face.points.forEach((point, pointIndex) => {
          roofingTopByPoint.set(roofPointKey(point), roofingTop[pointIndex]);
          structuralUndersideByPoint.set(
            roofPointKey(point),
            structuralUnderside[pointIndex],
          );
        });
      });
      faceAssemblies.forEach(({ face, structuralUnderside, roofingTop }) => {
          const selectedEdge =
            selection?.kind === "roof-edge" &&
            selection.index === face.index;
          const projectedFace = face.points.map(project);
          formRoofRegions.current.push(projectedFace);
          // `face.points` is the solved structural underside, fixed by the
          // wall-bearing geometry. Structure and covering both grow upward,
          // normal to the slope, so changing member depth cannot move bearing.
          const roofFill = selectedEdge
            ? "#d97834"
            : selection?.kind === "roof"
              ? face.index % 2
                ? "#e89a65"
                : "#d97f45"
              : face.index % 2
                ? "#ef9e67"
                : "#df8347";
          modelSurfaces.push({
            points: roofingTop,
            pick: { kind: "roof" },
            solidId: "roof-assembly",
            fill: roofFill,
            stroke: selectedEdge ? "#171512" : "#9b572c",
            lineWidth: selectedEdge ? 2.5 : 1,
            outline: false,
          });
          modelSurfaces.push({
            points: [...structuralUnderside].reverse(),
            pick: { kind: "roof" },
            solidId: "roof-assembly",
            fill: selectedEdge ? "#b76d3b" : "#bf7846",
            stroke: selectedEdge ? "#171512" : "#8d542f",
            lineWidth: selectedEdge ? 1.8 : 0.8,
            outline: false,
          });
        });

      const roofSurfaceEdgeStroke = "#171512";
      const roofSurfaceEdgeWidth = 1.35;

      // Draw only boundaries shared by distinct authored roof surfaces.
      const facetEdges = new Map<
        string,
        {
          start: Point3;
          end: Point3;
          normals: Point3[];
          occurrences: number;
        }
      >();
      roofSurfaces.forEach((surface) => {
        surface.points.forEach((start, pointIndex) => {
          const end = surface.points[(pointIndex + 1) % surface.points.length];
          const startKey = roofPointKey(start);
          const endKey = roofPointKey(end);
          const key =
            startKey < endKey
              ? `${startKey}|${endKey}`
              : `${endKey}|${startKey}`;
          const edge = facetEdges.get(key) ?? {
            start,
            end,
            normals: [],
            occurrences: 0,
          };
          edge.normals.push(roofFaceNormal(surface.points));
          edge.occurrences += 1;
          facetEdges.set(key, edge);
        });
      });
      facetEdges.forEach(({ start, end, normals, occurrences }) => {
        if (occurrences < 2 || normals.length < 2) return;
        const referenceNormal = normals[0];
        const hasSurfaceChange = normals.slice(1).some(
          (normal) =>
            referenceNormal.x * normal.x +
              referenceNormal.y * normal.y +
              referenceNormal.z * normal.z <
            0.9995,
        );
        if (!hasSurfaceChange) return;
        const topStart = roofingTopByPoint.get(roofPointKey(start));
        const topEnd = roofingTopByPoint.get(roofPointKey(end));
        const undersideStart = structuralUndersideByPoint.get(
          roofPointKey(start),
        );
        const undersideEnd = structuralUndersideByPoint.get(roofPointKey(end));
        if (!topStart || !topEnd || !undersideStart || !undersideEnd) return;
        modelLines.push({
          points: [topStart, topEnd],
          stroke: roofSurfaceEdgeStroke,
          lineWidth: roofSurfaceEdgeWidth,
        });
        modelLines.push({
          points: [undersideStart, undersideEnd],
          stroke: roofSurfaceEdgeStroke,
          lineWidth: roofSurfaceEdgeWidth,
        });
      });

      edgeProfiles.forEach(({ edge, points }) => {
        const selectedEdge =
          selection?.kind === "roof-edge" && selection.index === edge.index;
        const boundary = points.filter((point, index) => {
          const previous = points[index - 1];
          return (
            !previous ||
            Math.abs(previous.x - point.x) > 0.0001 ||
            Math.abs(previous.y - point.y) > 0.0001 ||
            Math.abs(previous.z - point.z) > 0.0001
          );
        });
        boundary.slice(1).forEach((end, index) => {
          const start = boundary[index];
          const topStart = roofingTopByPoint.get(roofPointKey(start));
          const topEnd = roofingTopByPoint.get(roofPointKey(end));
          const undersideStart = structuralUndersideByPoint.get(
            roofPointKey(start),
          );
          const undersideEnd = structuralUndersideByPoint.get(roofPointKey(end));
          if (!topStart || !topEnd || !undersideStart || !undersideEnd) return;
          modelSurfaces.push({
            points: [topStart, topEnd, undersideEnd, undersideStart],
            pick: { kind: "roof" },
            solidId: "roof-assembly",
            fill: selectedEdge ? "#c77a45" : "#c98451",
            stroke: roofSurfaceEdgeStroke,
            lineWidth: roofSurfaceEdgeWidth,
            outline: false,
          });
          modelLines.push({
            points: [topStart, topEnd],
            stroke: roofSurfaceEdgeStroke,
            lineWidth: roofSurfaceEdgeWidth,
          });
          modelLines.push({
            points: [undersideStart, undersideEnd],
            stroke: roofSurfaceEdgeStroke,
            lineWidth: roofSurfaceEdgeWidth,
          });
        });
      });

      roofPoints.forEach((corner) => {
        const profilePoint = edgeProfiles
          .flatMap(({ points }) => points)
          .find(
            (point) =>
              Math.abs(point.x - corner.x) < 0.0001 &&
              Math.abs(point.z - corner.z) < 0.0001,
          );
        if (!profilePoint) return;
        const top = roofingTopByPoint.get(roofPointKey(profilePoint));
        const underside = structuralUndersideByPoint.get(
          roofPointKey(profilePoint),
        );
        if (!top || !underside) return;
        modelLines.push({
          points: [top, underside],
          stroke: roofSurfaceEdgeStroke,
          lineWidth: roofSurfaceEdgeWidth,
        });
      });

      if (showTopology && roofKind !== "shed") {
        modelLines.push({
          points: [ridgeA, ridgeB],
          stroke: roofSurfaceEdgeStroke,
          lineWidth: roofSurfaceEdgeWidth,
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
          const roofHeight = displayedRoofHeightAt(point);
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
          modelLines.push({
            points: group.map(({ point, roofHeight }) => ({
              x: point.x,
              y: roofHeight,
              z: point.z,
            })),
            stroke: selectedWall ? "#08767e" : "#625b53",
            lineWidth: selectedWall ? 3 : 2,
          });
        });
      });

      renderClippedModel();

      if (selection?.kind === "ceiling" && ceilingOutline.length >= 3) {
        context.save();
        context.setLineDash([7, 5]);
        context.strokeStyle = "#175c4c";
        context.lineWidth = 2.5;
        context.beginPath();
        context.moveTo(ceilingOutline[0].x, ceilingOutline[0].y);
        ceilingOutline.slice(1).forEach((point) => context.lineTo(point.x, point.y));
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
          `FIXED BEARING · ${feetInches(roofBase)}`,
          16,
          24,
        );
      }
    } else {
      addWallSurfaces(() => null);
      addCeilingSurfaces(() => null, () => null);
      renderClippedModel();
      setEaveHandlePosition((current) => (current ? null : current));
      context.fillStyle = "#a95829";
      context.font = "700 10px monospace";
      context.fillText("CLOSE THE ROOF BOUNDARY TO GENERATE VOLUME", 16, 26);
    }
  }, [
    center.x,
    center.z,
    ceiling,
    ceilingDatumElevation,
    clipWalls,
    derivedSupportForWall,
    edgeElevation,
    finishCeilingFootprint,
    formFocusOffset,
    formZoom,
    orbit,
    pitch,
    roofBase,
    roofAssembly,
    roofClosed,
    roofEdges,
    roofKind,
    roofPoints,
    sectionBox,
    selection,
    showDatums,
    showSectionBox,
    showCeiling,
    showTopology,
    showWalls,
    structuralCeilingFootprint,
    isTrussRoof,
    maximumEaveElevationForEdge,
    trussBearingElevation,
    trussEnvelopeIssue,
    trussRoofBounds,
    wallHeights,
    wallThicknesses,
    wallPoints,
    walls,
    wallsClosed,
  ]);

  useEffect(() => {
    const draw = () => {
      drawPlan();
      drawForm();
    };
    draw();
    window.addEventListener("resize", draw);
    return () => window.removeEventListener("resize", draw);
  }, [drawForm, drawPlan, splitPosition, viewMode]);

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
        setWallThicknesses((current) => [...current, 5.5]);
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
      structuralCeilingFootprint.length >= 3 &&
      pointInPlanPolygon(point, structuralCeilingFootprint)
    ) {
      setSelection({ kind: "ceiling", id: ceiling.id });
      setCeilingHeightDraft(ceiling.bottomOfFramingElevationFeet.toFixed(2));
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
  const selectedWallSupport =
    selection?.kind === "wall"
      ? derivedSupportForWall(selection.index)
      : undefined;
  const selectedEdgeMaximumElevation =
    selection?.kind === "roof-edge"
      ? maximumEaveElevationForEdge(selection.index)
      : roofBase;
  const roomBounds = finishCeilingFootprint.reduce(
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
  const structuralCeilingBounds = structuralCeilingFootprint.reduce(
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
    wallHeights.every((height) => Math.abs(height - wallHeights[0]) < 0.001);

  const splitBounds = useCallback(() => {
    const width = Math.max(
      0,
      (drawingAreaRef.current?.getBoundingClientRect().width ?? 0) -
        SPLIT_DIVIDER_WIDTH,
    );
    if (width === 0) return { minimum: 0, maximum: 100 };
    const minimumWidth = Math.min(SPLIT_MIN_PANE_WIDTH, width * 0.35);
    const minimum = (minimumWidth / width) * 100;
    return { minimum, maximum: 100 - minimum };
  }, []);

  const moveSplitTo = useCallback(
    (clientX: number) => {
      const area = drawingAreaRef.current;
      if (!area) return;
      const rect = area.getBoundingClientRect();
      const availableWidth = rect.width - SPLIT_DIVIDER_WIDTH;
      if (availableWidth <= 0) return;
      const desiredLeftWidth =
        clientX - rect.left - SPLIT_DIVIDER_WIDTH / 2;
      const desiredPosition = (desiredLeftWidth / availableWidth) * 100;
      const { minimum, maximum } = splitBounds();
      setSplitPosition(Math.min(maximum, Math.max(minimum, desiredPosition)));
    },
    [splitBounds],
  );

  const handleSplitKeyDown = (
    event: React.KeyboardEvent<HTMLDivElement>,
  ) => {
    const { minimum, maximum } = splitBounds();
    const step = event.shiftKey ? 10 : 2;
    let nextPosition = splitPosition;
    if (event.key === "ArrowLeft") nextPosition -= step;
    else if (event.key === "ArrowRight") nextPosition += step;
    else if (event.key === "Home") nextPosition = minimum;
    else if (event.key === "End") nextPosition = maximum;
    else return;
    event.preventDefault();
    setSplitPosition(Math.min(maximum, Math.max(minimum, nextPosition)));
  };

  const resizeSectionFace = useCallback(
    (face: SectionFace, value: number) => {
      setSectionBox((current) => {
        const minimumSize = 1;
        const limit = face.startsWith("min")
          ? current[`max${face.slice(3)}` as SectionFace] - minimumSize
          : current[`min${face.slice(3)}` as SectionFace] + minimumSize;
        const nextValue = face.startsWith("min")
          ? Math.min(value, limit)
          : Math.max(value, limit);
        return { ...current, [face]: nextValue };
      });
    },
    [],
  );

  const sectionFaceLabel = (face: SectionFace) => {
    const side = face.startsWith("min") ? "minimum" : "maximum";
    return `${side} ${face.slice(-1).toUpperCase()} section face`;
  };

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

          <div className="control-section file-entities-section">
            <ControlHeading number="02" title="File entities" />
            <p className="file-entities-copy">
              Select an entity type to edit its properties in the inspector.
            </p>
            <div className="file-entity-list">
              <button
                className={selection?.kind === "wall" ? "active" : ""}
                disabled={walls.length === 0}
                onClick={() => {
                  setCommand("select");
                  setSelection({ kind: "wall", index: 0 });
                  setWallHeightDraft((wallHeights[0] ?? 9).toFixed(2));
                }}
              >
                <span>Walls</span>
                <strong>{walls.length}</strong>
                <small>Authored segments</small>
              </button>
              <button
                className={selection?.kind === "roof" ? "active" : ""}
                disabled={!roofClosed}
                onClick={() => {
                  setCommand("select");
                  setSelection({ kind: "roof" });
                }}
              >
                <span>Roof</span>
                <strong>{roofClosed ? 1 : 0}</strong>
                <small>{ROOF_FORMS[roofKind].label} volume</small>
              </button>
              <button
                className={selection?.kind === "ceiling" ? "active" : ""}
                disabled={structuralCeilingFootprint.length < 3}
                onClick={() => {
                  setCommand("select");
                  setSelection({ kind: "ceiling", id: ceiling.id });
                  setCeilingHeightDraft(
                    ceiling.bottomOfFramingElevationFeet.toFixed(2),
                  );
                }}
              >
                <span>Ceiling</span>
                <strong>{structuralCeilingFootprint.length >= 3 ? 1 : 0}</strong>
                <small>Room-owned · roof-contained</small>
              </button>
            </div>
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
              details are typed by structural system. An edge may retain one
              assignment for every system; only the assignment matching the
              overall roof system is applied.
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
                    <small>{SYSTEM_LABELS[condition.systemType]}</small>
                  </span>
                  <span className="catalog-chevron">›</span>
                </button>
              ))}
            </div>
          </div>

        </aside>

        <section
          ref={drawingAreaRef}
          className={`drawing-area ${viewMode}-view${isResizingSplit ? " resizing" : ""}`}
          style={
            viewMode === "split"
              ? {
                  gridTemplateColumns: `${splitPosition}fr ${SPLIT_DIVIDER_WIDTH}px ${100 - splitPosition}fr`,
                }
              : undefined
          }
        >
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

          {viewMode === "split" && (
            <div
              className="split-divider"
              role="separator"
              aria-label="Resize 2D and 3D workspaces"
              aria-orientation="vertical"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={Math.round(splitPosition)}
              aria-valuetext={`${Math.round(splitPosition)}% 2D, ${Math.round(100 - splitPosition)}% 3D`}
              tabIndex={0}
              onKeyDown={handleSplitKeyDown}
              onDoubleClick={() => setSplitPosition(50)}
              onPointerDown={(event) => {
                if (event.button !== 0) return;
                event.preventDefault();
                event.currentTarget.focus();
                event.currentTarget.setPointerCapture(event.pointerId);
                splitDrag.current = { pointerId: event.pointerId };
                setIsResizingSplit(true);
                moveSplitTo(event.clientX);
              }}
              onPointerMove={(event) => {
                if (splitDrag.current?.pointerId !== event.pointerId) return;
                moveSplitTo(event.clientX);
              }}
              onPointerUp={(event) => {
                if (splitDrag.current?.pointerId !== event.pointerId) return;
                splitDrag.current = null;
                setIsResizingSplit(false);
                if (event.currentTarget.hasPointerCapture(event.pointerId)) {
                  event.currentTarget.releasePointerCapture(event.pointerId);
                }
              }}
              onPointerCancel={(event) => {
                if (splitDrag.current?.pointerId !== event.pointerId) return;
                splitDrag.current = null;
                setIsResizingSplit(false);
              }}
            >
              <span className="split-divider-handle" aria-hidden="true" />
            </div>
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
                          ) <= 6,
                      ),
                  );
                  if (eave) {
                    setSelection({ kind: "roof-edge", index: eave.index });
                    return;
                  }
                  let frontmost: { target: ModelPick; depth: number } | null = null;
                  formPickRegions.current.forEach((region) => {
                    const depth = depthAtScreenPoint(pointer, region.points);
                    if (
                      depth !== null &&
                      (frontmost === null || depth >= frontmost.depth - 0.025)
                    ) {
                      frontmost = { target: region.target, depth };
                    }
                  });
                  if (frontmost) {
                    setSelection(frontmost.target);
                    if (frontmost.target.kind === "wall") {
                      setWallHeightDraft(
                        (wallHeights[frontmost.target.index] ?? 9).toFixed(2),
                      );
                    } else if (frontmost.target.kind === "ceiling") {
                      setCeilingHeightDraft(
                        ceiling.bottomOfFramingElevationFeet.toFixed(2),
                      );
                    }
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
              {showSectionBox &&
                (Object.keys(sectionHandles) as SectionFace[]).map((face) => {
                  const position = sectionHandles[face];
                  if (!position) return null;
                  return (
                    <button
                      key={face}
                      className={`section-face-handle${selectedSectionFace === face ? " active" : ""}`}
                      style={{ left: position.x, top: position.y }}
                      aria-label={`${sectionFaceLabel(face)}, ${feetInches(sectionBox[face])}`}
                      onClick={(event) => event.stopPropagation()}
                      onKeyDown={(event) => {
                        if (!["ArrowUp", "ArrowRight", "ArrowDown", "ArrowLeft"].includes(event.key)) return;
                        event.preventDefault();
                        const outward = event.key === "ArrowUp" || event.key === "ArrowRight" ? 1 : -1;
                        const faceDirection = face.startsWith("min") ? -1 : 1;
                        resizeSectionFace(
                          face,
                          sectionBox[face] + outward * faceDirection * (event.shiftKey ? 2 : 0.5),
                        );
                      }}
                      onPointerDown={(event) => {
                        if (event.button !== 0) return;
                        event.preventDefault();
                        event.stopPropagation();
                        event.currentTarget.setPointerCapture(event.pointerId);
                        setSelectedSectionFace(face);
                        sectionDrag.current = {
                          pointerId: event.pointerId,
                          face,
                          startX: event.clientX,
                          startY: event.clientY,
                          startValue: sectionBox[face],
                          screenAxis: position.axis,
                        };
                      }}
                      onPointerMove={(event) => {
                        const drag = sectionDrag.current;
                        if (!drag || drag.pointerId !== event.pointerId) return;
                        const lengthSquared =
                          drag.screenAxis.x * drag.screenAxis.x +
                          drag.screenAxis.y * drag.screenAxis.y;
                        if (lengthSquared < 0.01) return;
                        const delta =
                          ((event.clientX - drag.startX) * drag.screenAxis.x +
                            (event.clientY - drag.startY) * drag.screenAxis.y) /
                          lengthSquared;
                        resizeSectionFace(face, drag.startValue + delta);
                      }}
                      onPointerUp={(event) => {
                        if (sectionDrag.current?.pointerId !== event.pointerId) return;
                        sectionDrag.current = null;
                        if (event.currentTarget.hasPointerCapture(event.pointerId)) {
                          event.currentTarget.releasePointerCapture(event.pointerId);
                        }
                      }}
                      onPointerCancel={() => {
                        sectionDrag.current = null;
                      }}
                    >
                      <span aria-hidden="true">
                        {face.endsWith("Y") ? "↕" : "↔"}
                      </span>
                    </button>
                  );
                })}
              <div className="form-view-controls" aria-label="Model visibility">
                <button
                  className={showWalls ? "active" : ""}
                  aria-pressed={showWalls}
                  onClick={() => setShowWalls((current) => !current)}
                >
                  Walls
                </button>
                <button
                  className={showCeiling ? "active" : ""}
                  aria-pressed={showCeiling}
                  onClick={() => setShowCeiling((current) => !current)}
                >
                  Ceiling
                </button>
                <button
                  className={showDatums ? "active" : ""}
                  aria-pressed={showDatums}
                  onClick={() => setShowDatums((current) => !current)}
                >
                  Datums
                </button>
                <button
                  className={showTopology ? "active" : ""}
                  aria-pressed={showTopology}
                  onClick={() => setShowTopology((current) => !current)}
                >
                  Topology
                </button>
              </div>
              <button
                className={`section-box-toggle${showSectionBox ? " active" : ""}`}
                aria-pressed={showSectionBox}
                onClick={() => {
                  setShowSectionBox((current) => !current);
                  setSelectedSectionFace(null);
                }}
              >
                <span aria-hidden="true" />
                Section box
              </button>
              {selection?.kind === "ceiling" &&
                !isTrussRoof &&
                ceilingHandlePosition && (
                <button
                  className="wall-height-handle ceiling-height-handle"
                  style={{
                    left: ceilingHandlePosition.x,
                    top: ceilingHandlePosition.y,
                  }}
                  aria-label="Drag to change ceiling bottom-of-framing height"
                  onClick={(event) => event.stopPropagation()}
                  onPointerDown={(event) => {
                    if (event.button !== 0) return;
                    event.preventDefault();
                    event.stopPropagation();
                    event.currentTarget.setPointerCapture(event.pointerId);
                    ceilingHeightDrag.current = {
                      pointerId: event.pointerId,
                      startY: event.clientY,
                      startHeight: ceiling.bottomOfFramingElevationFeet,
                    };
                  }}
                  onPointerMove={(event) => {
                    const drag = ceilingHeightDrag.current;
                    if (!drag || drag.pointerId !== event.pointerId) return;
                    const nextHeight =
                      Math.round(
                        Math.max(
                          4,
                          Math.min(
                            30,
                            drag.startHeight + (drag.startY - event.clientY) / 9,
                          ),
                        ) * 4,
                      ) / 4;
                    setCeiling((current) => ({
                      ...current,
                      bottomOfFramingElevationFeet: nextHeight,
                    }));
                    setCeilingHeightDraft(nextHeight.toFixed(2));
                  }}
                  onPointerUp={(event) => {
                    if (ceilingHeightDrag.current?.pointerId !== event.pointerId) return;
                    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
                      event.currentTarget.releasePointerCapture(event.pointerId);
                    }
                    ceilingHeightDrag.current = null;
                  }}
                  onPointerCancel={() => {
                    ceilingHeightDrag.current = null;
                  }}
                >
                  <span className="ceiling-height-stem" aria-hidden="true" />
                  <span className="wall-height-arrows" aria-hidden="true">
                    ↑<i />↓
                  </span>
                  <output>{feetInches(ceiling.bottomOfFramingElevationFeet)}</output>
                </button>
              )}
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
                            maximumEaveElevationForEdge(selection.index),
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
                <span>
                  {isTrussRoof ? "One roof-driven solid" : "Two closed solids"} ·{" "}
                  {PRIMARY_ROOM.name}
                </span>
                <strong>
                  {isTrussRoof
                    ? "Finish beneath bottom chord"
                    : "Outside framing + inside finish"}
                </strong>
              </div>
              {!isTrussRoof && (
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
                          if (
                            Number.isFinite(value) &&
                            value >= 4 &&
                            value <= 30
                          ) {
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
              )}
              <div className="detail-inspector-note">
                {isTrussRoof
                  ? "This truss system owns the structural bottom chord. The room ceiling is finish only, attached immediately beneath that roof-driven plane. Its stored rafter ceiling height and framing depth remain untouched and return when Rafter is selected."
                  : "Ceiling framing remains full-depth and horizontal through the wall to its outside face wherever that face remains inside the roof footprint, overlapping roof structure where they meet. Only an upper outside corner that reaches the roof finish layer is cut back along that layer. The ceiling finish remains bounded by both the inward wall faces and the roof footprint."}
              </div>
              <dl className="inspector-data">
                <div>
                  <dt>Structural framing</dt>
                  <dd>
                    {isTrussRoof
                      ? "Integrated truss bottom chord · separate layer disabled"
                      : `${ceiling.framingThicknessInches.toFixed(1)}″ upward · ${feetInches(structuralCeilingBounds.maxX - structuralCeilingBounds.minX)} × ${feetInches(structuralCeilingBounds.maxZ - structuralCeilingBounds.minZ)}`}
                  </dd>
                </div>
                <div>
                  <dt>Separate finish</dt>
                  <dd>
                    {ceiling.finishThicknessInches.toFixed(1)}″ below ·{" "}
                    {feetInches(roomBounds.maxX - roomBounds.minX)} ×{" "}
                    {feetInches(roomBounds.maxZ - roomBounds.minZ)}
                  </dd>
                </div>
                <div>
                  <dt>Roof clipping limit</dt>
                  <dd>
                    {isTrussRoof
                      ? "Interior wall faces · roof-contained plan"
                      : "Plan clipped to roof · corner cuts at roof finish only"}
                  </dd>
                </div>
                <div>
                  <dt>{isTrussRoof ? "Driven datum" : "Default datum"}</dt>
                  <dd>
                    {isTrussRoof
                      ? `Truss bottom chord · ${feetInches(trussBearingElevation)}`
                      : wallsSharePlateHeight
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
                <fieldset className="stud-size-field">
                  <legend>Nominal stud thickness</legend>
                  <div>
                    {([3.5, 5.5, 11.25] as StudSize[]).map((size) => (
                      <button
                        type="button"
                        key={size}
                        aria-pressed={
                          (wallThicknesses[selection.index] ?? 5.5) === size
                        }
                        onClick={() =>
                          setWallThicknesses((current) =>
                            current.map((thickness, index) =>
                              index === selection.index ? size : thickness,
                            ),
                          )
                        }
                      >
                        <strong>{STUD_SIZE_LABELS[size]}</strong>
                        <small>{size}″</small>
                      </button>
                    ))}
                  </div>
                </fieldset>
              </div>
              <div className="detail-inspector-note">
                The authored main wall keeps its own plate height and outside
                face. When roof bearing is higher, a separate roof-support
                derived segment continues upward and is trimmed to the sloped
                roof underside; it does not rewrite this wall.
              </div>
              {isTrussRoof && trussEnvelopeIssue !== null && (
                <div className="detail-inspector-note experimental-warning">
                  <strong>Experimental limitation</strong>
                  <span>{trussEnvelopeIssue}</span>
                </div>
              )}
              <dl className="inspector-data">
                <div>
                  <dt>Authored top</dt>
                  <dd>{feetInches(wallHeights[selection.index] ?? 9)}</dd>
                </div>
                <div>
                  <dt>Derived roof support</dt>
                  <dd>
                    {selectedWallSupport
                      ? `${feetInches(selectedWallSupport.authoredTop)} → ${feetInches(selectedWallSupport.bearingElevation)} · roof edge ${selectedWallSupport.edgeIndex + 1}`
                      : "None required"}
                  </dd>
                </div>
                <div>
                  <dt>Roof clipping</dt>
                  <dd>{clipWalls ? "Displayed wall clips at roof" : "Off"}</dd>
                </div>
                <div>
                  <dt>Outside alignment</dt>
                  <dd>Fixed to authored path</dd>
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
                <strong>
                  {ROOF_FORMS[roofKind].label} · {SYSTEM_LABELS[roofSystemType]}
                </strong>
              </div>
              <div className="detail-form inspector-properties">
                <label>
                  <span>Roof form</span>
                  <select
                    value={roofKind}
                    onChange={(event) =>
                      setRoofKind(event.target.value as RoofKind)
                    }
                  >
                    {(Object.keys(ROOF_FORMS) as RoofKind[]).map((kind) => (
                      <option key={kind} value={kind}>
                        {ROOF_FORMS[kind].label}
                      </option>
                    ))}
                  </select>
                </label>
                <fieldset className="roof-system-field inspector-roof-system">
                  <legend>Overall roof structural system</legend>
                  <div className="roof-system-options">
                    {(Object.keys(SYSTEM_LABELS) as RoofSystemType[]).map(
                      (systemType) => (
                        <button
                          key={systemType}
                          type="button"
                          className={
                            roofSystemType === systemType ? "active" : ""
                          }
                          aria-pressed={roofSystemType === systemType}
                          onClick={() => changeRoofSystem(systemType)}
                        >
                          {SYSTEM_LABELS[systemType]}
                        </button>
                      ),
                    )}
                  </div>
                  <p>
                    This system governs the whole selected roof. Edge detail
                    assignments remain stored; only matching details are active.
                    Choosing a truss system automatically uses the supported
                    Gable roof form.
                  </p>
                </fieldset>
                <label>
                  <span>Shared bearing elevation</span>
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
                <Range
                  label="Roof pitch"
                  value={pitch}
                  min={1}
                  max={16}
                  step={0.5}
                  output={`${pitch.toFixed(1)}:12`}
                  onChange={setPitch}
                />
                {!isTrussRoof && (
                  <>
                    <label>
                      <span>Shared structural depth</span>
                      <div className="height-input">
                        <input
                          type="number"
                          min={3.5}
                          max={15.25}
                          step={0.125}
                          value={roofAssembly.structuralDepthInches}
                          onChange={(event) => {
                            const value = Number(event.target.value);
                            if (Number.isFinite(value)) {
                              updateRoofAssembly({
                                structuralDepthInches: Math.max(
                                  3.5,
                                  Math.min(15.25, value),
                                ),
                              });
                            }
                          }}
                        />
                        <span>in</span>
                      </div>
                    </label>
                    <label>
                      <span>Shared roof build-up</span>
                      <div className="height-input">
                        <input
                          type="number"
                          min={0.125}
                          max={4}
                          step={0.125}
                          value={roofAssembly.buildUpThicknessInches}
                          onChange={(event) => {
                            const value = Number(event.target.value);
                            if (Number.isFinite(value)) {
                              updateRoofAssembly({
                                buildUpThicknessInches: Math.max(
                                  0.125,
                                  Math.min(4, value),
                                ),
                              });
                            }
                          }}
                        />
                        <span>in</span>
                      </div>
                    </label>
                  </>
                )}
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
                {isTrussRoof
                  ? "Experimental truss mode replaces the thin rafter-layer representation with one closed envelope solid. Its flat bottom chord follows the shared bearing plane and its sloped top follows the gable profile. Individual webs and repeated trusses are intentionally not modeled yet."
                  : "Set bearing to the wall top-plate elevation. The structural underside stays fixed at the wall line; increasing member depth grows the roof upward. Wall changes do not move this explicit datum automatically."}
              </div>
              {isTrussRoof && trussEnvelopeIssue !== null && (
                <div className="detail-inspector-note experimental-warning">
                  <strong>Experimental limitation</strong>
                  <span>{trussEnvelopeIssue}</span>
                </div>
              )}
              <dl className="inspector-data">
                <div>
                  <dt>Overall structural system</dt>
                  <dd>{SYSTEM_LABELS[roofSystemType]}</dd>
                </div>
                <div>
                  <dt>Boundary</dt>
                  <dd>{roofEdges.length} closed edges</dd>
                </div>
                <div>
                  <dt>Derived roof supports</dt>
                  <dd>{derivedRoofSupports.length} above authored walls</dd>
                </div>
                <div>
                  <dt>Pitch</dt>
                  <dd>{pitch.toFixed(1)}:12</dd>
                </div>
                <div>
                  <dt>{isTrussRoof ? "Geometry" : "Thickness"}</dt>
                  <dd>
                    {isTrussRoof
                      ? trussEnvelopeIssue === null
                        ? `Closed triangular prism · bottom chord ${feetInches(trussBearingElevation)}`
                        : "Envelope paused"
                      : `${roofAssembly.structuralDepthInches.toFixed(3)}″ structure + ${roofAssembly.buildUpThicknessInches.toFixed(3)}″ build-up`}
                  </dd>
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
                  <span>Eave bearing elevation</span>
                  <div className="height-input">
                    <input
                      type="number"
                      min={0}
                      max={selectedEdgeMaximumElevation}
                      step={0.25}
                      value={edgeElevation(selection.index)}
                      onChange={(event) => {
                        const value = Number(event.target.value);
                        if (!Number.isFinite(value)) return;
                        updateRelationship(selection.index, {
                          elevationOffset:
                            Math.max(
                              0,
                              Math.min(selectedEdgeMaximumElevation, value),
                            ) - roofBase,
                        });
                      }}
                    />
                    <span>ft</span>
                  </div>
                </label>
                <Range
                  label="Raise / lower from shared bearing"
                  value={relationships[selection.index]?.elevationOffset ?? 0}
                  min={-8}
                  max={selectedEdgeMaximumElevation - roofBase}
                  step={0.25}
                  output={
                    Math.abs(
                      edgeElevation(selection.index) -
                        selectedEdgeMaximumElevation,
                    ) < 0.001
                      ? "At maximum · gable limit"
                      : (relationships[selection.index]?.elevationOffset ?? 0) === 0
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
                <fieldset className="edge-detail-assignments">
                  <legend>Assigned eave details</legend>
                  <p>
                    One assignment per system is retained on this edge. The
                    overall roof system decides which one is applied.
                  </p>
                  <div>
                    {eaveCatalog.map((condition) => {
                      const assigned = relationships[
                        selection.index
                      ]?.conditionIds.includes(condition.id) ?? false;
                      const active =
                        assigned && condition.systemType === roofSystemType;
                      return (
                        <label
                          key={condition.id}
                          className={active ? "active" : assigned ? "assigned" : ""}
                        >
                          <input
                            type="radio"
                            name={`edge-${selection.index}-${condition.systemType}`}
                            checked={assigned}
                            onChange={() =>
                              assignConditionToEdge(selection.index, condition.id)
                            }
                          />
                          <span>
                            <strong>{condition.name}</strong>
                            <small>{SYSTEM_LABELS[condition.systemType]}</small>
                          </span>
                          <em>
                            {active
                              ? "Active · applied"
                              : assigned
                                ? "Assigned · inactive"
                                : "Available"}
                          </em>
                        </label>
                      );
                    })}
                  </div>
                </fieldset>
                <div className="active-detail-summary">
                  <span>Applied for {SYSTEM_LABELS[roofSystemType]} roof</span>
                  <strong>
                    {conditionForEdge(selection.index)?.name ??
                      "No compatible assignment"}
                  </strong>
                </div>
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
                This eave bearing is independently offset from the shared roof
                bearing. Its full authored length stays horizontal. Lowering it
                moves both shared corners and the neighboring side eaves jog
                down to meet them. Raising it keeps the neighboring roof
                surfaces continuous without creating extra roof faces.
                The maximum is set by the adjacent roof slopes; at that limit,
                a Hip end resolves into a vertical gable end.
              </div>
              {isTrussRoof && trussEnvelopeIssue !== null && (
                <div className="detail-inspector-note experimental-warning">
                  <strong>Experimental limitation</strong>
                  <span>{trussEnvelopeIssue}</span>
                </div>
              )}
              <dl className="inspector-data">
                <div>
                  <dt>Shared bearing elevation</dt>
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
                <div>
                  <dt>Maximum allowed elevation</dt>
                  <dd>{feetInches(selectedEdgeMaximumElevation)}</dd>
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
                {isTrussRoof
                  ? "The roof owns the truss bottom chord and drives a finish-only ceiling bounded by the interior wall faces. Select the ceiling, roof, a wall, or an edge to inspect the experiment."
                  : "The room owns outside-to-outside ceiling framing and a separate finish bounded by the interior wall faces. Select the ceiling, roof, a wall, or an edge to edit its properties."}
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
                  <dd>{structuralCeilingFootprint.length >= 3 ? 1 : 0}</dd>
                </div>
                <div>
                  <dt>Derived roof supports</dt>
                  <dd>{derivedRoofSupports.length}</dd>
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
          {structuralCeilingFootprint.length >= 3 ? 1 : 0} ceiling
        </span>
        <span>
          {SYSTEM_LABELS[roofSystemType]} roof ·{" "}
          {isTrussRoof
            ? trussEnvelopeIssue === null
              ? `closed truss envelope · bottom chord ${feetInches(trussBearingElevation)} · finish-only ceiling`
              : "experimental envelope paused · see roof warning"
            : `${roofAssembly.structuralDepthInches.toFixed(3)}″ structure + ${roofAssembly.buildUpThicknessInches.toFixed(3)}″ build-up · ceiling framing bottom ${feetInches(ceiling.bottomOfFramingElevationFeet)}`}
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
