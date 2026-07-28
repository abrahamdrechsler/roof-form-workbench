"use client";

import { useCallback, useEffect, useRef, useState } from "react";

type RoofKind = "gable" | "hip" | "shed";
type EdgeRole = "bearing" | "gable" | "high" | "low";
type ViewMode = "split" | "plan" | "form";
type EaveDriver = "heel" | "seat";
type EaveCondition = {
  id: string;
  name: string;
  driver: EaveDriver;
  height: number;
  inset: number;
};
type Point3 = { x: number; y: number; z: number };
type RoofFace = {
  id: string;
  label: string;
  color: string;
  points: Point3[];
};

const PRESETS: Record<
  RoofKind,
  { label: string; description: string; roles: EdgeRole[] }
> = {
  gable: {
    label: "Gable",
    description: "Two planes meet at a centered ridge.",
    roles: ["gable", "bearing", "gable", "bearing"],
  },
  hip: {
    label: "Hip",
    description: "Every perimeter edge generates a roof plane.",
    roles: ["bearing", "bearing", "bearing", "bearing"],
  },
  shed: {
    label: "Shed",
    description: "One plane rises from a low to high plate rail.",
    roles: ["gable", "high", "gable", "low"],
  },
};

const EDGE_LABELS = ["North", "East", "South", "West"];

const INITIAL_EAVE_CONDITIONS: EaveCondition[] = [
  {
    id: "rafter-seat",
    name: "Rafter · compact",
    driver: "seat",
    height: 0.75,
    inset: 0.25,
  },
  {
    id: "raised-heel",
    name: "Raised heel · standard",
    driver: "heel",
    height: 1.5,
    inset: 0.5,
  },
];

function feetInches(value: number) {
  const feet = Math.floor(value);
  const inches = Math.round((value - feet) * 12);
  return `${feet}′ ${inches || 0}″`;
}

function roleLabel(role: EdgeRole) {
  if (role === "bearing") return "Bearing / slope";
  if (role === "gable") return "Gable";
  if (role === "high") return "High plate";
  return "Low plate";
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

function drawGrid(
  context: CanvasRenderingContext2D,
  width: number,
  height: number,
) {
  context.strokeStyle = "#e9e6df";
  context.lineWidth = 1;
  for (let x = 0; x <= width; x += 24) {
    context.beginPath();
    context.moveTo(x, 0);
    context.lineTo(x, height);
    context.stroke();
  }
  for (let y = 0; y <= height; y += 24) {
    context.beginPath();
    context.moveTo(0, y);
    context.lineTo(width, y);
    context.stroke();
  }
}

function drawPolygon(
  context: CanvasRenderingContext2D,
  points: { x: number; y: number }[],
  fill: string,
  stroke: string,
  lineWidth = 1,
) {
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

function pointInPolygon(
  point: { x: number; y: number },
  polygon: { x: number; y: number }[],
) {
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

function pointToSegmentDistance(
  point: { x: number; y: number },
  start: { x: number; y: number },
  end: { x: number; y: number },
) {
  const deltaX = end.x - start.x;
  const deltaY = end.y - start.y;
  const lengthSquared = deltaX * deltaX + deltaY * deltaY;
  if (lengthSquared === 0) return Math.hypot(point.x - start.x, point.y - start.y);
  const t = Math.max(
    0,
    Math.min(
      1,
      ((point.x - start.x) * deltaX + (point.y - start.y) * deltaY) /
        lengthSquared,
    ),
  );
  return Math.hypot(
    point.x - (start.x + t * deltaX),
    point.y - (start.y + t * deltaY),
  );
}

function solveGable(
  buildingWidth: number,
  westBase: number,
  eastBase: number,
  pitch: number,
) {
  const halfWidth = buildingWidth / 2;
  const slope = Math.max(pitch / 12, 0.001);
  const rawRidgeX = (eastBase - westBase) / (2 * slope);
  const ridgeX = Math.max(-halfWidth, Math.min(halfWidth, rawRidgeX));
  const ridgeElevation = westBase + slope * (ridgeX + halfWidth);
  return {
    westBase,
    eastBase,
    ridgeX,
    ridgeElevation,
    resolved: rawRidgeX >= -halfWidth && rawRidgeX <= halfWidth,
  };
}

type PlanPoint = { x: number; z: number };
type RoofPlaneDefinition = {
  id: string;
  label: string;
  color: string;
  a: number;
  b: number;
  c: number;
};

function makeHipPlaneDefinitions(
  halfWidth: number,
  halfDepth: number,
  bearingElevations: number[],
  pitch: number,
): RoofPlaneDefinition[] {
  const slope = Math.max(pitch / 12, 0.001);
  return [
    {
      id: "north-hip",
      label: "North hip plane",
      color: "#e78a4e",
      a: 0,
      b: slope,
      c: bearingElevations[0] + slope * halfDepth,
    },
    {
      id: "east-plane",
      label: "East roof plane",
      color: "#ef9e67",
      a: -slope,
      b: 0,
      c: bearingElevations[1] + slope * halfWidth,
    },
    {
      id: "south-hip",
      label: "South hip plane",
      color: "#f2ae7e",
      a: 0,
      b: -slope,
      c: bearingElevations[2] + slope * halfDepth,
    },
    {
      id: "west-plane",
      label: "West roof plane",
      color: "#d97834",
      a: slope,
      b: 0,
      c: bearingElevations[3] + slope * halfWidth,
    },
  ];
}

function evaluatePlane(plane: RoofPlaneDefinition, point: PlanPoint) {
  return plane.a * point.x + plane.b * point.z + plane.c;
}

function clipPlanPolygon(
  polygon: PlanPoint[],
  a: number,
  b: number,
  c: number,
) {
  const result: PlanPoint[] = [];
  if (polygon.length === 0) return result;
  polygon.forEach((current, index) => {
    const previous = polygon[(index + polygon.length - 1) % polygon.length];
    const previousValue = a * previous.x + b * previous.z + c;
    const currentValue = a * current.x + b * current.z + c;
    const previousInside = previousValue <= 0.0001;
    const currentInside = currentValue <= 0.0001;

    if (previousInside !== currentInside) {
      const t = previousValue / (previousValue - currentValue);
      result.push({
        x: previous.x + (current.x - previous.x) * t,
        z: previous.z + (current.z - previous.z) * t,
      });
    }
    if (currentInside) result.push(current);
  });
  return result;
}

function hipRoofHeight(
  x: number,
  z: number,
  halfWidth: number,
  halfDepth: number,
  bearingElevations: number[],
  pitch: number,
) {
  const point = { x, z };
  return Math.min(
    ...makeHipPlaneDefinitions(
      halfWidth,
      halfDepth,
      bearingElevations,
      pitch,
    ).map((plane) => evaluatePlane(plane, point)),
  );
}

function makeRoofFaces(
  kind: RoofKind,
  buildingWidth: number,
  buildingDepth: number,
  bearingElevations: number[],
  overhangs: number[],
  pitch: number,
  roofResolved: boolean,
) {
  if (!roofResolved) return [];
  const w = buildingWidth / 2;
  const d = buildingDepth / 2;
  const westExtent = -w - overhangs[3];
  const eastExtent = w + overhangs[1];
  const northExtent = -d - overhangs[0];
  const southExtent = d + overhangs[2];
  const slope = Math.max(pitch / 12, 0.001);
  const eastBase = bearingElevations[1];
  const westBase = bearingElevations[3];
  const gable = solveGable(
    buildingWidth,
    westBase,
    eastBase,
    pitch,
  );
  const faces: RoofFace[] = [];

  if (kind === "gable") {
    faces.push(
      {
        id: "west-plane",
        label: "West roof plane",
        color: "#d97834",
        points: [
          {
            x: westExtent,
            y: gable.westBase - overhangs[3] * slope,
            z: northExtent,
          },
          {
            x: westExtent,
            y: gable.westBase - overhangs[3] * slope,
            z: southExtent,
          },
          { x: gable.ridgeX, y: gable.ridgeElevation, z: southExtent },
          { x: gable.ridgeX, y: gable.ridgeElevation, z: northExtent },
        ],
      },
      {
        id: "east-plane",
        label: "East roof plane",
        color: "#ef9e67",
        points: [
          { x: gable.ridgeX, y: gable.ridgeElevation, z: northExtent },
          { x: gable.ridgeX, y: gable.ridgeElevation, z: southExtent },
          {
            x: eastExtent,
            y: gable.eastBase - overhangs[1] * slope,
            z: southExtent,
          },
          {
            x: eastExtent,
            y: gable.eastBase - overhangs[1] * slope,
            z: northExtent,
          },
        ],
      },
    );
  }

  if (kind === "hip") {
    const rectangle: PlanPoint[] = [
      { x: westExtent, z: northExtent },
      { x: eastExtent, z: northExtent },
      { x: eastExtent, z: southExtent },
      { x: westExtent, z: southExtent },
    ];
    const planes = makeHipPlaneDefinitions(
      w,
      d,
      bearingElevations,
      pitch,
    );
    planes.forEach((plane, planeIndex) => {
      let region = rectangle;
      planes.forEach((other, otherIndex) => {
        if (planeIndex === otherIndex) return;
        region = clipPlanPolygon(
          region,
          plane.a - other.a,
          plane.b - other.b,
          plane.c - other.c,
        );
      });
      if (region.length < 3) return;
      faces.push({
        id: plane.id,
        label: plane.label,
        color: plane.color,
        points: region.map((point) => ({
          x: point.x,
          y: evaluatePlane(plane, point),
          z: point.z,
        })),
      });
    });
  }

  if (kind === "shed") {
    faces.push({
      id: "shed-plane",
      label: "Shed roof plane",
      color: "#dd8247",
      points: [
        {
          x: westExtent,
          y: westBase - overhangs[3] * slope,
          z: northExtent,
        },
        {
          x: westExtent,
          y: westBase - overhangs[3] * slope,
          z: southExtent,
        },
        {
          x: eastExtent,
          y: eastBase + overhangs[1] * slope,
          z: southExtent,
        },
        {
          x: eastExtent,
          y: eastBase + overhangs[1] * slope,
          z: northExtent,
        },
      ],
    });
  }
  return faces;
}

export default function Home() {
  const [roofKind, setRoofKind] = useState<RoofKind>("gable");
  const [buildingWidth, setBuildingWidth] = useState(28);
  const [buildingDepth, setBuildingDepth] = useState(40);
  const [plateHeights, setPlateHeights] = useState([9, 9, 9, 9]);
  const [bearingOffsets, setBearingOffsets] = useState([
    0.75, 0.75, 0.75, 0.75,
  ]);
  const [bearingInsets, setBearingInsets] = useState([0.25, 0.25, 0.25, 0.25]);
  const [edgeOverhangs, setEdgeOverhangs] = useState([1.5, 1.5, 1.5, 1.5]);
  const [pitch, setPitch] = useState(6);
  const [selectedEdge, setSelectedEdge] = useState(1);
  const [selectedPlane, setSelectedPlane] = useState("east-plane");
  const [showWalls, setShowWalls] = useState(true);
  const [showDatums, setShowDatums] = useState(true);
  const [showTopology, setShowTopology] = useState(true);
  const [orbit, setOrbit] = useState({ yaw: -42, pitch: 24 });
  const [viewMode, setViewMode] = useState<ViewMode>("split");
  const [selected3DWall, setSelected3DWall] = useState<number | null>(null);
  const [wallHeightDraft, setWallHeightDraft] = useState("9.00");
  const [wallHandlePosition, setWallHandlePosition] = useState<{
    x: number;
    y: number;
  } | null>(null);
  const [eaveCatalog, setEaveCatalog] = useState<EaveCondition[]>(
    INITIAL_EAVE_CONDITIONS,
  );
  const [edgeEaveIds, setEdgeEaveIds] = useState([
    "rafter-seat",
    "rafter-seat",
    "rafter-seat",
    "rafter-seat",
  ]);
  const [selected3DEave, setSelected3DEave] = useState<number | null>(null);
  const [showEaveCreator, setShowEaveCreator] = useState(false);
  const [eaveDraft, setEaveDraft] = useState({
    name: "New eave condition",
    driver: "heel" as EaveDriver,
    height: 1.5,
    inset: 0.5,
  });

  const planRef = useRef<HTMLCanvasElement>(null);
  const formRef = useRef<HTMLCanvasElement>(null);
  const sectionRef = useRef<HTMLCanvasElement>(null);
  const formWallRegions = useRef<
    { edge: number; points: { x: number; y: number }[] }[]
  >([]);
  const formEaveRegions = useRef<
    { edge: number; points: { x: number; y: number }[] }[]
  >([]);
  const orbitDrag = useRef<{
    pointerId: number;
    x: number;
    y: number;
    yaw: number;
    pitch: number;
  } | null>(null);
  const wallHeightDrag = useRef<{
    pointerId: number;
    startY: number;
    startHeight: number;
  } | null>(null);
  const didOrbit = useRef(false);

  const roles = PRESETS[roofKind].roles;
  const bearingElevations = plateHeights.map(
    (height, index) =>
      height +
      bearingOffsets[index] -
      bearingInsets[index] * (Math.max(pitch, 0.001) / 12),
  );
  const overhangs = edgeOverhangs;
  const effectivePitch =
    roofKind === "shed"
      ? (Math.abs(bearingElevations[1] - bearingElevations[3]) /
          buildingWidth) *
        12
      : pitch;
  const gableSolution = solveGable(
    buildingWidth,
    bearingElevations[3],
    bearingElevations[1],
    effectivePitch,
  );
  const hipBearingSpread =
    Math.max(...bearingElevations) - Math.min(...bearingElevations);
  const hipVariableTransition =
    roofKind === "hip" && hipBearingSpread > 0.01;
  const roofResolved =
    roofKind === "hip" ? true : gableSolution.resolved;
  const ridgeElevation =
    roofKind === "shed"
      ? Math.max(bearingElevations[1], bearingElevations[3])
      : roofKind === "gable"
        ? gableSolution.ridgeElevation
        : Math.max(...bearingElevations) +
          (buildingWidth / 2) * (pitch / 12);
  const selectedRole = roles[selectedEdge];
  const selectedDrivesRoof =
    selectedRole === "bearing" ||
    selectedRole === "high" ||
    selectedRole === "low";

  const reset = () => {
    setRoofKind("gable");
    setBuildingWidth(28);
    setBuildingDepth(40);
    setPlateHeights([9, 9, 9, 9]);
    setBearingOffsets([0.75, 0.75, 0.75, 0.75]);
    setBearingInsets([0.25, 0.25, 0.25, 0.25]);
    setEdgeOverhangs([1.5, 1.5, 1.5, 1.5]);
    setPitch(6);
    setSelectedEdge(1);
    setSelectedPlane("east-plane");
    setShowWalls(true);
    setShowDatums(true);
    setShowTopology(true);
    setOrbit({ yaw: -42, pitch: 24 });
    setSelected3DWall(null);
    setWallHeightDraft("9.00");
    setWallHandlePosition(null);
    setEaveCatalog(INITIAL_EAVE_CONDITIONS);
    setEdgeEaveIds([
      "rafter-seat",
      "rafter-seat",
      "rafter-seat",
      "rafter-seat",
    ]);
    setSelected3DEave(null);
    setShowEaveCreator(false);
  };

  const setSelectedPlateHeight = (value: number) => {
    setPlateHeights((current) =>
      current.map((height, index) => (index === selectedEdge ? value : height)),
    );
  };

  const commitWallHeight = () => {
    if (selected3DWall === null) return;
    const parsedHeight = Number(wallHeightDraft);
    if (!wallHeightDraft.trim() || !Number.isFinite(parsedHeight)) {
      setWallHeightDraft(plateHeights[selected3DWall].toFixed(2));
      return;
    }
    const nextHeight = Math.max(6, Math.min(30, parsedHeight));
    setPlateHeights((current) =>
      current.map((height, index) =>
        index === selected3DWall ? nextHeight : height,
      ),
    );
    setWallHeightDraft(nextHeight.toFixed(2));
  };

  const setAllPlateHeights = (value: number) => {
    setPlateHeights([value, value, value, value]);
  };

  const assignEaveCondition = (edge: number, conditionId: string) => {
    const condition = eaveCatalog.find((item) => item.id === conditionId);
    if (!condition) return;
    setEdgeEaveIds((current) =>
      current.map((id, index) => (index === edge ? conditionId : id)),
    );
    setBearingOffsets((current) =>
      current.map((offset, index) =>
        index === edge ? condition.height : offset,
      ),
    );
    setBearingInsets((current) =>
      current.map((inset, index) =>
        index === edge ? condition.inset : inset,
      ),
    );
  };

  const saveEaveCondition = () => {
    const safeHeight = Number.isFinite(eaveDraft.height)
      ? eaveDraft.height
      : 0;
    const safeInset = Number.isFinite(eaveDraft.inset) ? eaveDraft.inset : 0;
    const condition: EaveCondition = {
      id: `eave-${Date.now()}`,
      name: eaveDraft.name.trim() || "Untitled eave",
      driver: eaveDraft.driver,
      height: Math.max(0, Math.min(6, safeHeight)),
      inset: Math.max(-2, Math.min(4, safeInset)),
    };
    setEaveCatalog((current) => [...current, condition]);
    setShowEaveCreator(false);
  };

  const setAuthoredPitch = (value: number) => {
    setPitch(value);
    if (roofKind === "shed") {
      setPlateHeights((current) =>
        current.map((height, index) =>
          index === 1
            ? current[3] +
              bearingOffsets[3] +
              (bearingInsets[1] - bearingInsets[3]) * (value / 12) +
              buildingWidth * (value / 12) -
              bearingOffsets[1]
            : height,
        ),
      );
    }
  };

  const drawPlan = useCallback(() => {
    const canvas = planRef.current;
    if (!canvas) return;
    const ready = prepareCanvas(canvas);
    if (!ready) return;
    const { context, width, height } = ready;
    drawGrid(context, width, height);

    const margin = 64;
    const roofWidth = buildingWidth + overhangs[3] + overhangs[1];
    const roofDepth = buildingDepth + overhangs[0] + overhangs[2];
    const scale = Math.min(
      (width - margin * 2) / roofWidth,
      (height - margin * 2) / roofDepth,
    );
    const rectWidth = buildingWidth * scale;
    const rectHeight = buildingDepth * scale;
    const roofLeft = (width - roofWidth * scale) / 2;
    const roofTop = (height - roofDepth * scale) / 2;
    const left = roofLeft + overhangs[3] * scale;
    const top = roofTop + overhangs[0] * scale;
    const right = left + rectWidth;
    const bottom = top + rectHeight;
    const middle = (top + bottom) / 2;
    const roofRight = right + overhangs[1] * scale;
    const roofBottom = bottom + overhangs[2] * scale;

    context.fillStyle = "#f8f5ee";
    context.fillRect(left, top, rectWidth, rectHeight);

    const roofEdges = [
      [{ x: roofLeft, y: roofTop }, { x: roofRight, y: roofTop }],
      [{ x: roofRight, y: roofTop }, { x: roofRight, y: roofBottom }],
      [{ x: roofRight, y: roofBottom }, { x: roofLeft, y: roofBottom }],
      [{ x: roofLeft, y: roofBottom }, { x: roofLeft, y: roofTop }],
    ];
    roofEdges.forEach((edge, index) => {
      context.strokeStyle = index === selectedEdge ? "#16838a" : "#d97834";
      context.lineWidth = index === selectedEdge ? 3.5 : 2;
      context.beginPath();
      context.moveTo(edge[0].x, edge[0].y);
      context.lineTo(edge[1].x, edge[1].y);
      context.stroke();
    });

    const edges = [
      [{ x: left, y: top }, { x: right, y: top }],
      [{ x: right, y: top }, { x: right, y: bottom }],
      [{ x: right, y: bottom }, { x: left, y: bottom }],
      [{ x: left, y: bottom }, { x: left, y: top }],
    ];
    edges.forEach((edge, index) => {
      context.strokeStyle = index === selectedEdge ? "#171512" : "#8a837a";
      context.lineWidth = index === selectedEdge ? 8 : 5;
      context.lineCap = "round";
      context.beginPath();
      context.moveTo(edge[0].x, edge[0].y);
      context.lineTo(edge[1].x, edge[1].y);
      context.stroke();
      context.beginPath();
      context.arc(
        (edge[0].x + edge[1].x) / 2,
        (edge[0].y + edge[1].y) / 2,
        9,
        0,
        Math.PI * 2,
      );
      context.fillStyle = index === selectedEdge ? "#171512" : "#fff";
      context.fill();
      context.strokeStyle = "#171512";
      context.lineWidth = 1;
      context.stroke();

      const midpointX = (edge[0].x + edge[1].x) / 2;
      const midpointY = (edge[0].y + edge[1].y) / 2;
      const offsets = [
        { x: 0, y: -21 },
        { x: 25, y: 3 },
        { x: 0, y: 27 },
        { x: -25, y: 3 },
      ];
      context.fillStyle = index === selectedEdge ? "#171512" : "#716a61";
      context.font = "600 9px monospace";
      context.textAlign = "center";
      context.fillText(
        feetInches(plateHeights[index]),
        midpointX + offsets[index].x,
        midpointY + offsets[index].y,
      );
    });

    context.strokeStyle = "#d97834";
    context.lineWidth = 2;
    context.beginPath();
    if (!roofResolved) {
      context.setLineDash([7, 5]);
      context.strokeRect(left + 9, top + 9, rectWidth - 18, rectHeight - 18);
      context.setLineDash([]);
      context.fillStyle = "#b45427";
      context.font = "700 9px monospace";
      context.textAlign = "center";
      context.fillText("UNRESOLVED SUPPORTS", width / 2, middle);
    } else if (roofKind === "gable") {
      const ridgePlanX =
        left + ((gableSolution.ridgeX + buildingWidth / 2) / buildingWidth) * rectWidth;
      context.moveTo(ridgePlanX, roofTop);
      context.lineTo(ridgePlanX, roofBottom);
    } else if (roofKind === "hip") {
      makeRoofFaces(
        roofKind,
        buildingWidth,
        buildingDepth,
        bearingElevations,
        overhangs,
        effectivePitch,
        true,
      ).forEach((face) => {
        const points = face.points.map((point) => ({
          x: left + ((point.x + buildingWidth / 2) / buildingWidth) * rectWidth,
          y: top + ((point.z + buildingDepth / 2) / buildingDepth) * rectHeight,
        }));
        context.beginPath();
        context.moveTo(points[0].x, points[0].y);
        points.slice(1).forEach((point) => context.lineTo(point.x, point.y));
        context.closePath();
        context.stroke();
      });
    } else {
      context.moveTo(left + rectWidth * 0.25, middle);
      context.lineTo(right - rectWidth * 0.2, middle);
      context.lineTo(right - rectWidth * 0.28, middle - 6);
      context.moveTo(right - rectWidth * 0.2, middle);
      context.lineTo(right - rectWidth * 0.28, middle + 6);
    }
    context.stroke();

    context.fillStyle = "#615b52";
    context.font = "500 10px monospace";
    context.textAlign = "center";
    context.fillText(feetInches(buildingWidth), width / 2, bottom + 45);
    context.save();
    context.translate(left - 34, height / 2);
    context.rotate(-Math.PI / 2);
    context.fillText(feetInches(buildingDepth), 0, 0);
    context.restore();
    context.textAlign = "left";
  }, [
    buildingDepth,
    buildingWidth,
    bearingElevations,
    bearingInsets,
    bearingOffsets,
    effectivePitch,
    gableSolution.ridgeX,
    plateHeights,
    overhangs,
    roofKind,
    roofResolved,
    selectedEdge,
  ]);

  const drawForm = useCallback(() => {
    const canvas = formRef.current;
    if (!canvas) return;
    const ready = prepareCanvas(canvas);
    if (!ready) return;
    const { context, width, height } = ready;
    const origin = { x: width * 0.5, y: height * 0.53 };
    const scale = Math.min(width / 70, height / 46);
    const yaw = (orbit.yaw * Math.PI) / 180;
    const cameraPitch = (orbit.pitch * Math.PI) / 180;
    const pivotY = ridgeElevation / 2;
    const project = (point: Point3) => {
      const horizontal = point.x * Math.cos(yaw) - point.z * Math.sin(yaw);
      const depth = point.x * Math.sin(yaw) + point.z * Math.cos(yaw);
      const vertical = point.y - pivotY;
      return {
        x: origin.x + horizontal * scale,
        y:
          origin.y +
          depth * scale * Math.sin(cameraPitch) -
          vertical * scale * Math.cos(cameraPitch),
      };
    };

    context.fillStyle = "#fbfaf7";
    context.fillRect(0, 0, width, height);
    const w = buildingWidth / 2;
    const d = buildingDepth / 2;
    const groundHalfExtent =
      Math.ceil((Math.max(buildingWidth, buildingDepth) * 0.75) / 4) * 4;
    const groundElevation = -0.04;
    const groundCorners: Point3[] = [
      { x: -groundHalfExtent, y: groundElevation, z: -groundHalfExtent },
      { x: groundHalfExtent, y: groundElevation, z: -groundHalfExtent },
      { x: groundHalfExtent, y: groundElevation, z: groundHalfExtent },
      { x: -groundHalfExtent, y: groundElevation, z: groundHalfExtent },
    ];

    drawPolygon(
      context,
      groundCorners.map(project),
      "rgba(22, 131, 138, 0.045)",
      "rgba(22, 131, 138, 0.18)",
      1,
    );

    for (
      let coordinate = -groundHalfExtent;
      coordinate <= groundHalfExtent;
      coordinate += 4
    ) {
      const isCenterAxis = coordinate === 0;
      context.strokeStyle = isCenterAxis
        ? "rgba(22, 131, 138, 0.34)"
        : "rgba(113, 106, 97, 0.17)";
      context.lineWidth = isCenterAxis ? 1.35 : 0.75;

      const xStart = project({
        x: coordinate,
        y: groundElevation,
        z: -groundHalfExtent,
      });
      const xEnd = project({
        x: coordinate,
        y: groundElevation,
        z: groundHalfExtent,
      });
      context.beginPath();
      context.moveTo(xStart.x, xStart.y);
      context.lineTo(xEnd.x, xEnd.y);
      context.stroke();

      const zStart = project({
        x: -groundHalfExtent,
        y: groundElevation,
        z: coordinate,
      });
      const zEnd = project({
        x: groundHalfExtent,
        y: groundElevation,
        z: coordinate,
      });
      context.beginPath();
      context.moveTo(zStart.x, zStart.y);
      context.lineTo(zEnd.x, zEnd.y);
      context.stroke();
    }

    const roofHeightAtX = (x: number) => {
      if (roofKind === "shed") {
        const t = (x + w) / buildingWidth;
        return (
          bearingElevations[3] +
          (bearingElevations[1] - bearingElevations[3]) * t
        );
      }
      if (x <= gableSolution.ridgeX) {
        return (
          bearingElevations[3] +
          (x + w) * (Math.max(effectivePitch, 0.001) / 12)
        );
      }
      return (
        bearingElevations[1] +
        (w - x) * (Math.max(effectivePitch, 0.001) / 12)
      );
    };
    const endWall = (edge: 0 | 2) => {
      const z = edge === 0 ? -d : d;
      const wallHeight = plateHeights[edge];
      const top: Point3[] = [];
      for (let index = 0; index <= 16; index += 1) {
        const x = w - (index / 16) * buildingWidth;
        const clippedHeight =
          roofResolved && roofKind !== "hip"
            ? Math.min(wallHeight, roofHeightAtX(x))
            : wallHeight;
        top.push({ x, y: clippedHeight, z });
      }
      return [
        { x: -w, y: 0, z },
        { x: w, y: 0, z },
        ...top,
      ];
    };

    formWallRegions.current = [];
    if (showWalls) {
      const wallFaces = [
        {
          edge: 0,
          points: endWall(0),
        },
        {
          edge: 1,
          points: [
            { x: w, y: 0, z: -d },
            { x: w, y: plateHeights[1], z: -d },
            { x: w, y: plateHeights[1], z: d },
            { x: w, y: 0, z: d },
          ],
        },
        {
          edge: 2,
          points: endWall(2),
        },
        {
          edge: 3,
          points: [
            { x: -w, y: 0, z: d },
            { x: -w, y: plateHeights[3], z: d },
            { x: -w, y: plateHeights[3], z: -d },
            { x: -w, y: 0, z: -d },
          ],
        },
      ];
      const orderedWallFaces = wallFaces.sort((a, b) => {
          const centerA = a.points.reduce(
            (sum, point) =>
              sum + point.x * Math.sin(yaw) + point.z * Math.cos(yaw),
            0,
          );
          const centerB = b.points.reduce(
            (sum, point) =>
              sum + point.x * Math.sin(yaw) + point.z * Math.cos(yaw),
            0,
          );
          return centerA - centerB;
        });
      formWallRegions.current = orderedWallFaces.map((face) => ({
        edge: face.edge,
        points: face.points.map(project),
      }));
      orderedWallFaces.forEach((face) => {
        const selected = face.edge === selected3DWall;
        drawPolygon(
          context,
          face.points.map(project),
          selected ? "#d7e7e5" : "#ded9cf",
          selected ? "#16838a" : "#aaa399",
          selected ? 2.5 : 1,
        );
      });
    }

    if (showWalls && selected3DWall !== null) {
      const selectedHeight =
        (selected3DWall === 0 || selected3DWall === 2) &&
        roofResolved &&
        roofKind !== "hip"
          ? Math.min(plateHeights[selected3DWall], roofHeightAtX(0))
          : plateHeights[selected3DWall];
      const handlePoint: Point3 =
        selected3DWall === 0
          ? { x: 0, y: selectedHeight, z: -d }
          : selected3DWall === 1
            ? { x: w, y: selectedHeight, z: 0 }
            : selected3DWall === 2
              ? { x: 0, y: selectedHeight, z: d }
              : { x: -w, y: selectedHeight, z: 0 };
      const projectedHandle = project(handlePoint);
      setWallHandlePosition((current) =>
        current &&
        Math.abs(current.x - projectedHandle.x) < 0.25 &&
        Math.abs(current.y - projectedHandle.y) < 0.25
          ? current
          : projectedHandle,
      );
    } else {
      setWallHandlePosition((current) => (current ? null : current));
    }

    const faces = makeRoofFaces(
      roofKind,
      buildingWidth,
      buildingDepth,
      bearingElevations,
      overhangs,
      effectivePitch,
      roofResolved,
    ).sort(
      (a, b) =>
        a.points.reduce(
          (sum, point) =>
            sum + point.x * Math.sin(yaw) + point.z * Math.cos(yaw),
          0,
        ) /
          a.points.length -
        b.points.reduce(
          (sum, point) =>
            sum + point.x * Math.sin(yaw) + point.z * Math.cos(yaw),
          0,
        ) /
          b.points.length,
    );

    faces.forEach((face) => {
      const selected = face.id === selectedPlane;
      drawPolygon(
        context,
        face.points.map(project),
        selected ? "#d97834" : face.color,
        selected ? "#171512" : "#9b572c",
        selected ? 2.5 : 1,
      );
    });

    if (showTopology) {
      faces.forEach((face) =>
        drawPolygon(
          context,
          face.points.map(project),
          "rgba(255,255,255,0)",
          "#63371f",
          1.2,
        ),
      );
    }

    const westExtent = -w - overhangs[3];
    const eastExtent = w + overhangs[1];
    const northExtent = -d - overhangs[0];
    const southExtent = d + overhangs[2];
    const roofSurfaceHeight = (x: number, z: number) =>
      roofKind === "hip"
        ? hipRoofHeight(
            x,
            z,
            w,
            d,
            bearingElevations,
            effectivePitch,
          )
        : roofHeightAtX(x);
    const northSouthBreaks =
      roofKind === "gable"
        ? [westExtent, gableSolution.ridgeX, eastExtent]
        : [westExtent, eastExtent];
    const eaveEdges: { edge: number; points: Point3[] }[] = [
      {
        edge: 0,
        points: northSouthBreaks.map((x) => ({
          x,
          y: roofSurfaceHeight(x, northExtent),
          z: northExtent,
        })),
      },
      {
        edge: 1,
        points: [
          {
            x: eastExtent,
            y: roofSurfaceHeight(eastExtent, northExtent),
            z: northExtent,
          },
          {
            x: eastExtent,
            y: roofSurfaceHeight(eastExtent, southExtent),
            z: southExtent,
          },
        ],
      },
      {
        edge: 2,
        points: [...northSouthBreaks].reverse().map((x) => ({
          x,
          y: roofSurfaceHeight(x, southExtent),
          z: southExtent,
        })),
      },
      {
        edge: 3,
        points: [
          {
            x: westExtent,
            y: roofSurfaceHeight(westExtent, southExtent),
            z: southExtent,
          },
          {
            x: westExtent,
            y: roofSurfaceHeight(westExtent, northExtent),
            z: northExtent,
          },
        ],
      },
    ];
    formEaveRegions.current = eaveEdges.map((edge) => ({
      edge: edge.edge,
      points: edge.points.map(project),
    }));
    formEaveRegions.current.forEach((edge) => {
      context.strokeStyle =
        edge.edge === selected3DEave ? "#16838a" : "#a95829";
      context.lineWidth = edge.edge === selected3DEave ? 4 : 2;
      context.lineCap = "round";
      context.beginPath();
      context.moveTo(edge.points[0].x, edge.points[0].y);
      edge.points
        .slice(1)
        .forEach((point) => context.lineTo(point.x, point.y));
      context.stroke();
    });

    if (!roofResolved) {
      context.fillStyle = "#b45427";
      context.font = "700 10px monospace";
      context.fillText("ROOF FORM UNRESOLVED", 18, 44);
      context.fillStyle = "#716a61";
      context.font = "500 9px monospace";
      context.fillText("Bearing rails do not define one continuous solid.", 18, 60);
    }

    if (showDatums) {
      const edgePoints = (
        edge: number,
        elevation: number,
        inset = 0,
      ): Point3[] => {
        if (edge === 0)
          return [
            { x: -w, y: elevation, z: -d + inset },
            { x: w, y: elevation, z: -d + inset },
          ];
        if (edge === 1)
          return [
            { x: w - inset, y: elevation, z: -d },
            { x: w - inset, y: elevation, z: d },
          ];
        if (edge === 2)
          return [
            { x: w, y: elevation, z: d - inset },
            { x: -w, y: elevation, z: d - inset },
          ];
        return [
          { x: -w + inset, y: elevation, z: d },
          { x: -w + inset, y: elevation, z: -d },
        ];
      };
      const plateRail = edgePoints(selectedEdge, plateHeights[selectedEdge]).map(project);
      context.strokeStyle = "#16838a";
      context.lineWidth = 2.5;
      context.beginPath();
      context.moveTo(plateRail[0].x, plateRail[0].y);
      context.lineTo(plateRail[1].x, plateRail[1].y);
      context.stroke();
      context.fillStyle = "#126a70";
      context.font = "600 10px monospace";
      context.fillText("WALL TOP / PLATE", plateRail[1].x - 84, plateRail[1].y - 8);

      if (selectedDrivesRoof) {
        const bearingRail = edgePoints(
          selectedEdge,
          plateHeights[selectedEdge] + bearingOffsets[selectedEdge],
          bearingInsets[selectedEdge],
        ).map(project);
        context.setLineDash([5, 4]);
        context.strokeStyle = "#d97834";
        context.lineWidth = 2;
        context.beginPath();
        context.moveTo(bearingRail[0].x, bearingRail[0].y);
        context.lineTo(bearingRail[1].x, bearingRail[1].y);
        context.stroke();
        context.setLineDash([]);
        context.fillStyle = "#a95829";
        context.fillText(
          "WALL / ROOF LOCATOR",
          bearingRail[1].x - 99,
          bearingRail[1].y - 8,
        );
      }
    }

    context.fillStyle = "#25211d";
    context.font = "600 10px monospace";
    context.fillText("STRUCTURAL ROOF FORM", 18, 25);
  }, [
    buildingDepth,
    buildingWidth,
    bearingElevations,
    bearingInsets,
    bearingOffsets,
    effectivePitch,
    gableSolution.ridgeX,
    orbit,
    overhangs,
    plateHeights,
    ridgeElevation,
    roofResolved,
    roofKind,
    selectedEdge,
    selectedDrivesRoof,
    selectedPlane,
    selected3DWall,
    selected3DEave,
    showDatums,
    showTopology,
    showWalls,
  ]);

  const drawSection = useCallback(() => {
    const canvas = sectionRef.current;
    if (!canvas) return;
    const ready = prepareCanvas(canvas);
    if (!ready) return;
    const { context, width, height } = ready;
    const floor = height - 25;
    const maxElevation = Math.max(
      ridgeElevation,
      ...plateHeights,
      ...bearingElevations,
    );
    const sy = (height - 50) / (maxElevation + 1.5);
    const sx = (width - 58) / (buildingWidth + 10);
    const x = (value: number) => width / 2 + value * sx;
    const y = (value: number) => floor - value * sy;
    const westPlate = plateHeights[3];
    const eastPlate = plateHeights[1];
    const westBase = bearingElevations[3];
    const eastBase = bearingElevations[1];

    context.fillStyle = "#fbfaf7";
    context.fillRect(0, 0, width, height);
    context.fillStyle = "#d8d2c8";
    context.fillRect(
      x(-buildingWidth / 2),
      y(westPlate),
      10,
      floor - y(westPlate),
    );
    context.fillRect(
      x(buildingWidth / 2) - 10,
      y(eastPlate),
      10,
      floor - y(eastPlate),
    );

    context.strokeStyle = "#16838a";
    context.lineWidth = 1.5;
    context.setLineDash([5, 4]);
    context.beginPath();
    context.moveTo(22, y(westPlate));
    context.lineTo(width / 2 - 5, y(westPlate));
    context.moveTo(width / 2 + 5, y(eastPlate));
    context.lineTo(width - 22, y(eastPlate));
    context.stroke();
    context.setLineDash([]);

    if (roofResolved) {
      context.strokeStyle = "#d97834";
      context.lineWidth = 8;
      context.lineCap = "round";
      context.beginPath();
      context.moveTo(x(-buildingWidth / 2), y(westBase));
      if (roofKind === "shed") {
        context.lineTo(x(buildingWidth / 2), y(eastBase));
      } else if (roofKind === "gable") {
        context.lineTo(
          x(gableSolution.ridgeX),
          y(gableSolution.ridgeElevation),
        );
        context.lineTo(x(buildingWidth / 2), y(eastBase));
      } else {
        context.beginPath();
        for (let index = 0; index <= 80; index += 1) {
          const sectionX =
            -buildingWidth / 2 + (index / 80) * buildingWidth;
          const sectionY = hipRoofHeight(
            sectionX,
            0,
            buildingWidth / 2,
            buildingDepth / 2,
            bearingElevations,
            effectivePitch,
          );
          if (index === 0) context.moveTo(x(sectionX), y(sectionY));
          else context.lineTo(x(sectionX), y(sectionY));
        }
      }
      context.stroke();
    } else {
      context.fillStyle = "#b45427";
      context.font = "700 10px monospace";
      context.fillText("NO CONTINUOUS ROOF SECTION", width / 2 - 83, 28);
      context.fillStyle = "#716a61";
      context.font = "500 9px monospace";
      context.fillText(
        "Resolve bearing-base elevations before generating the solid.",
        width / 2 - 151,
        44,
      );
    }

    context.fillStyle = "#126a70";
    context.font = "600 9px monospace";
    context.fillText("WEST PLATE", 22, y(westPlate) - 7);
    context.fillText("EAST PLATE", width - 83, y(eastPlate) - 7);
    context.fillStyle = "#5c554c";
    context.fillText(`${effectivePitch.toFixed(1)}:12`, width - 68, 20);
  }, [
    bearingElevations,
    buildingDepth,
    buildingWidth,
    effectivePitch,
    gableSolution.ridgeElevation,
    gableSolution.ridgeX,
    plateHeights,
    ridgeElevation,
    roofResolved,
    roofKind,
  ]);

  useEffect(() => {
    const drawAll = () => {
      drawPlan();
      drawForm();
      drawSection();
    };
    drawAll();
    window.addEventListener("resize", drawAll);
    return () => window.removeEventListener("resize", drawAll);
  }, [drawForm, drawPlan, drawSection, viewMode]);

  const chooseKind = (kind: RoofKind) => {
    setRoofKind(kind);
    setSelectedEdge(kind === "shed" ? 1 : 1);
    setSelectedPlane(kind === "shed" ? "shed-plane" : "east-plane");
    if (kind === "shed") {
      setPlateHeights((current) =>
        current.map((height, index) =>
          index === 1
            ? current[3] +
              bearingOffsets[3] +
              (bearingInsets[1] - bearingInsets[3]) * (pitch / 12) +
              buildingWidth * (pitch / 12) -
              bearingOffsets[1]
            : height,
        ),
      );
    }
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
          <span className="status-chip">MVP 01</span>
          <button className="ghost-button" onClick={reset}>Reset</button>
          <button className="primary-button">Save study</button>
        </div>
      </header>

      <div className="workspace">
        <aside className="control-panel">
          <ControlHeading number="01" title="Broad form" />
          <p className="section-copy">
            Choose the structural form. Finish eaves and trim come later.
          </p>
          <div className="form-options">
            {(Object.keys(PRESETS) as RoofKind[]).map((kind) => (
              <button
                key={kind}
                className={`form-option ${roofKind === kind ? "active" : ""}`}
                onClick={() => chooseKind(kind)}
              >
                <span className={`roof-glyph ${kind}`} />
                <span>
                  <strong>{PRESETS[kind].label}</strong>
                  <small>{PRESETS[kind].description}</small>
                </span>
              </button>
            ))}
          </div>

          <div className="control-section">
            <ControlHeading number="02" title="Bearing footprint" />
            <Range
              label="Width"
              value={buildingWidth}
              min={16}
              max={52}
              step={1}
              output={feetInches(buildingWidth)}
              onChange={setBuildingWidth}
            />
            <Range
              label="Depth"
              value={buildingDepth}
              min={20}
              max={64}
              step={1}
              output={feetInches(buildingDepth)}
              onChange={setBuildingDepth}
            />
            <Range
              label="Level all plates"
              value={
                plateHeights.reduce((sum, height) => sum + height, 0) /
                plateHeights.length
              }
              min={7}
              max={14}
              step={0.25}
              output="Reset datum"
              onChange={setAllPlateHeights}
            />
          </div>

          <div className="control-section">
            <ControlHeading number="03" title="Structural rules" />
            <Range
              label={roofKind === "shed" ? "Target pitch" : "Pitch"}
              value={roofKind === "shed" ? effectivePitch : pitch}
              min={1}
              max={14}
              step={0.5}
              output={`${effectivePitch.toFixed(1)}:12`}
              onChange={setAuthoredPitch}
            />
          </div>

          <div className="control-section eave-catalog-section">
            <ControlHeading number="04" title="Eave condition catalog" />
            <p className="catalog-copy">
              Saved wall-section locators. Assign one after selecting a roof
              edge.
            </p>
            <div className="eave-catalog-list">
              {eaveCatalog.map((condition) => (
                <div className="eave-catalog-item" key={condition.id}>
                  <span className="condition-diagram">
                    <i className="condition-wall" />
                    <i className="condition-roof" />
                    <i className="condition-point" />
                  </span>
                  <span>
                    <strong>{condition.name}</strong>
                    <small>
                      {condition.driver === "heel" ? "Heel" : "Seat"} · X{" "}
                      {feetInches(condition.inset)} · Y +
                      {feetInches(condition.height)}
                    </small>
                  </span>
                </div>
              ))}
            </div>
            {showEaveCreator ? (
              <div className="eave-creator">
                <input
                  aria-label="Eave condition name"
                  value={eaveDraft.name}
                  onChange={(event) =>
                    setEaveDraft((current) => ({
                      ...current,
                      name: event.target.value,
                    }))
                  }
                />
                <div className="eave-creator-row">
                  <select
                    aria-label="Structural locator type"
                    value={eaveDraft.driver}
                    onChange={(event) =>
                      setEaveDraft((current) => ({
                        ...current,
                        driver: event.target.value as EaveDriver,
                      }))
                    }
                  >
                    <option value="heel">Heel height</option>
                    <option value="seat">Seat cut</option>
                  </select>
                  <label>
                    X
                    <input
                      type="number"
                      step={0.25}
                      value={eaveDraft.inset}
                      onChange={(event) =>
                        setEaveDraft((current) => ({
                          ...current,
                          inset: Number(event.target.value),
                        }))
                      }
                    />
                  </label>
                  <label>
                    Y
                    <input
                      type="number"
                      min={0}
                      step={0.25}
                      value={eaveDraft.height}
                      onChange={(event) =>
                        setEaveDraft((current) => ({
                          ...current,
                          height: Number(event.target.value),
                        }))
                      }
                    />
                  </label>
                </div>
                <div className="eave-creator-actions">
                  <button onClick={() => setShowEaveCreator(false)}>
                    Cancel
                  </button>
                  <button className="save-condition" onClick={saveEaveCondition}>
                    Save type
                  </button>
                </div>
              </div>
            ) : (
              <button
                className="add-condition-button"
                onClick={() => setShowEaveCreator(true)}
              >
                + New condition
              </button>
            )}
          </div>

          <div className="control-section layer-section">
            <ControlHeading number="05" title="View" />
            <Check label="Wall volume" value={showWalls} onChange={setShowWalls} />
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
              eyebrow="PLAN / BEARING INTENT"
              title="Top-of-plate footprint"
              extra={
                <div className="legend">
                  <span><i className="legend-line bearing" /> Plate rail</span>
                  <span><i className="legend-line roof" /> Derived topology</span>
                </div>
              }
            >
            <canvas
              ref={planRef}
              aria-label="Plan view of roof bearing footprint"
              onClick={(event) => {
                const canvas = planRef.current;
                if (!canvas) return;
                const rect = canvas.getBoundingClientRect();
                const margin = 64;
                const roofWidth =
                  buildingWidth + overhangs[3] + overhangs[1];
                const roofDepth =
                  buildingDepth + overhangs[0] + overhangs[2];
                const scale = Math.min(
                  (rect.width - margin * 2) / roofWidth,
                  (rect.height - margin * 2) / roofDepth,
                );
                const roofLeft = (rect.width - roofWidth * scale) / 2;
                const roofTop = (rect.height - roofDepth * scale) / 2;
                const roofRight = roofLeft + roofWidth * scale;
                const roofBottom = roofTop + roofDepth * scale;
                const x = event.clientX - rect.left;
                const y = event.clientY - rect.top;
                const distances = [
                  Math.abs(y - roofTop),
                  Math.abs(x - roofRight),
                  Math.abs(y - roofBottom),
                  Math.abs(x - roofLeft),
                ];
                setSelectedEdge(distances.indexOf(Math.min(...distances)));
              }}
            />
            <div className="canvas-note">Select an edge to inspect its intent</div>
            <aside className="edge-inspector">
              <div className="edge-inspector-heading">
                <div>
                  <span className="view-label">SELECTED WALL / ROOF EDGE</span>
                  <h3>{EDGE_LABELS[selectedEdge]} edge</h3>
                </div>
                <span className="selection-index">E{selectedEdge + 1}</span>
              </div>
              <div className="edge-summary">
                <span>{roleLabel(roles[selectedEdge])}</span>
                <strong
                  className={
                    !roofResolved || hipVariableTransition
                      ? "warning"
                      : "healthy"
                  }
                >
                  {!roofResolved
                    ? "Conflict"
                    : hipVariableTransition
                      ? "Corners adjust"
                      : selectedDrivesRoof
                        ? "Driving roof"
                        : "Clipped by roof"}
                </strong>
              </div>
              <Range
                label="Wall top / plate"
                value={plateHeights[selectedEdge]}
                min={6}
                max={30}
                step={0.25}
                output={feetInches(plateHeights[selectedEdge])}
                onChange={setSelectedPlateHeight}
              />
              <label className="condition-select">
                <span>Wall / roof condition</span>
                <select
                  value={edgeEaveIds[selectedEdge]}
                  onChange={(event) =>
                    assignEaveCondition(selectedEdge, event.target.value)
                  }
                >
                  {eaveCatalog.map((condition) => (
                    <option key={condition.id} value={condition.id}>
                      {condition.name}
                    </option>
                  ))}
                </select>
              </label>
              <div className="condition-coordinate compact">
                <span>X {feetInches(bearingInsets[selectedEdge])} inboard</span>
                <span>Y +{feetInches(bearingOffsets[selectedEdge])}</span>
              </div>
              <Range
                label="Independent overhang"
                value={edgeOverhangs[selectedEdge]}
                min={0}
                max={8}
                step={0.25}
                output={feetInches(edgeOverhangs[selectedEdge])}
                onChange={(value) =>
                  setEdgeOverhangs((current) =>
                    current.map((overhang, index) =>
                      index === selectedEdge ? value : overhang,
                    ),
                  )
                }
              />
            </aside>
            </ViewPanel>
          )}

          {viewMode !== "plan" && (
            <ViewPanel
              className="form-panel"
              eyebrow="FORM / STRUCTURE"
              title={
                roofResolved
                  ? "Coherent roof volume"
                  : "No coherent roof volume"
              }
              extra={
                <div className="view-tabs">
                  <button className="active">Solid</button>
                  <button onClick={() => setShowTopology(!showTopology)}>Planes</button>
                </div>
              }
            >
            <canvas
              ref={formRef}
              aria-label="Three dimensional structural roof form"
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
                const eave = formEaveRegions.current.find((region) =>
                  region.points
                    .slice(1)
                    .some(
                      (point, index) =>
                        pointToSegmentDistance(
                          pointer,
                          region.points[index],
                          point,
                        ) <= 9,
                    ),
                );
                if (eave) {
                  setSelectedEdge(eave.edge);
                  setSelected3DEave(eave.edge);
                  setSelected3DWall(null);
                  return;
                }
                const wall = [...formWallRegions.current]
                  .reverse()
                  .find((region) => pointInPolygon(pointer, region.points));
                if (wall) {
                  setSelectedEdge(wall.edge);
                  setSelected3DWall(wall.edge);
                  setSelected3DEave(null);
                  setWallHeightDraft(plateHeights[wall.edge].toFixed(2));
                  return;
                }
                setSelected3DWall(null);
                setSelected3DEave(null);
                setSelectedPlane(
                  roofKind === "shed"
                    ? "shed-plane"
                    : selectedPlane === "east-plane"
                      ? "west-plane"
                      : "east-plane",
                );
              }}
              onPointerDown={(event) => {
                if (event.button !== 0) return;
                event.preventDefault();
                event.currentTarget.setPointerCapture(event.pointerId);
                event.currentTarget.style.cursor = "grabbing";
                didOrbit.current = false;
                orbitDrag.current = {
                  pointerId: event.pointerId,
                  x: event.clientX,
                  y: event.clientY,
                  yaw: orbit.yaw,
                  pitch: orbit.pitch,
                };
              }}
              onPointerMove={(event) => {
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
                    Math.min(85, drag.pitch + (event.clientY - drag.y) * 0.35),
                  ),
                });
              }}
              onPointerUp={(event) => {
                if (orbitDrag.current?.pointerId !== event.pointerId) return;
                event.currentTarget.releasePointerCapture(event.pointerId);
                event.currentTarget.style.cursor = "grab";
                orbitDrag.current = null;
              }}
              onPointerCancel={(event) => {
                event.currentTarget.style.cursor = "grab";
                orbitDrag.current = null;
              }}
            />
            <div className="canvas-note orbit-note">
              Left-click + drag to orbit
            </div>
            <div className="orientation">
              {Math.round(((orbit.yaw % 360) + 360) % 360)}°
            </div>
            {showWalls &&
              selected3DWall !== null &&
              wallHandlePosition && (
                <button
                  className="wall-height-handle"
                  style={{
                    left: wallHandlePosition.x,
                    top: wallHandlePosition.y,
                  }}
                  aria-label={`Drag to change ${EDGE_LABELS[selected3DWall]} wall height`}
                  onPointerDown={(event) => {
                    if (event.button !== 0 || selected3DWall === null) return;
                    event.preventDefault();
                    event.stopPropagation();
                    event.currentTarget.setPointerCapture(event.pointerId);
                    wallHeightDrag.current = {
                      pointerId: event.pointerId,
                      startY: event.clientY,
                      startHeight: plateHeights[selected3DWall],
                    };
                  }}
                  onPointerMove={(event) => {
                    const drag = wallHeightDrag.current;
                    if (
                      !drag ||
                      drag.pointerId !== event.pointerId ||
                      selected3DWall === null
                    ) {
                      return;
                    }
                    const canvas = formRef.current;
                    if (!canvas) return;
                    const rect = canvas.getBoundingClientRect();
                    const canvasScale = Math.min(
                      rect.width / 70,
                      rect.height / 46,
                    );
                    const cameraPitch = (orbit.pitch * Math.PI) / 180;
                    const pixelsPerFoot =
                      canvasScale *
                      Math.max(0.25, Math.abs(Math.cos(cameraPitch)));
                    const rawHeight =
                      drag.startHeight +
                      (drag.startY - event.clientY) / pixelsPerFoot;
                    const nextHeight = Math.max(
                      6,
                      Math.min(30, Math.round(rawHeight * 4) / 4),
                    );
                    setPlateHeights((current) =>
                      current.map((height, index) =>
                        index === selected3DWall ? nextHeight : height,
                      ),
                    );
                    setWallHeightDraft(nextHeight.toFixed(2));
                  }}
                  onPointerUp={(event) => {
                    if (wallHeightDrag.current?.pointerId !== event.pointerId) {
                      return;
                    }
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
                  <output>{feetInches(plateHeights[selected3DWall])}</output>
                </button>
              )}
            {selected3DEave !== null && (
              <div className="wall-height-popover eave-assignment-popover">
                <div className="wall-height-popover-heading">
                  <div>
                    <span className="view-label">SELECTED ROOF EDGE</span>
                    <strong>{EDGE_LABELS[selected3DEave]} eave</strong>
                  </div>
                  <button
                    aria-label="Close eave condition editor"
                    onClick={() => setSelected3DEave(null)}
                  >
                    ×
                  </button>
                </div>
                <label>
                  <span>Wall / roof condition</span>
                  <select
                    value={edgeEaveIds[selected3DEave]}
                    onChange={(event) =>
                      assignEaveCondition(selected3DEave, event.target.value)
                    }
                  >
                    {eaveCatalog.map((condition) => (
                      <option key={condition.id} value={condition.id}>
                        {condition.name}
                      </option>
                    ))}
                  </select>
                </label>
                <div className="condition-coordinate">
                  <span>
                    X {feetInches(bearingInsets[selected3DEave])} inboard
                  </span>
                  <span>
                    Y +{feetInches(bearingOffsets[selected3DEave])} above plate
                  </span>
                </div>
                <label>
                  <span>Independent overhang</span>
                  <div className="height-input">
                    <input
                      type="number"
                      min={0}
                      max={8}
                      step={0.25}
                      value={edgeOverhangs[selected3DEave]}
                      onChange={(event) => {
                        const nextValue = Number(event.target.value);
                        if (!Number.isFinite(nextValue)) return;
                        setEdgeOverhangs((current) =>
                          current.map((overhang, index) =>
                            index === selected3DEave
                              ? Math.max(0, Math.min(8, nextValue))
                              : overhang,
                          ),
                        );
                      }}
                    />
                    <span>ft</span>
                  </div>
                </label>
              </div>
            )}
            {showWalls && selected3DWall !== null && (
              <div className="wall-height-popover">
                <div className="wall-height-popover-heading">
                  <div>
                    <span className="view-label">SELECTED WALL</span>
                    <strong>{EDGE_LABELS[selected3DWall]} wall</strong>
                  </div>
                  <button
                    aria-label="Close wall height editor"
                    onClick={() => setSelected3DWall(null)}
                  >
                    ×
                  </button>
                </div>
                <label>
                  <span>Top / plate height</span>
                  <div className="height-input">
                    <input
                      autoFocus
                      type="number"
                      min={6}
                      max={30}
                      step={0.25}
                      value={wallHeightDraft}
                      onChange={(event) => setWallHeightDraft(event.target.value)}
                      onKeyDown={(event) => {
                        if (event.key === "Enter") {
                          commitWallHeight();
                          event.currentTarget.blur();
                        }
                        if (event.key === "Escape") {
                          setWallHeightDraft(
                            plateHeights[selected3DWall].toFixed(2),
                          );
                          setSelected3DWall(null);
                        }
                      }}
                    />
                    <span>ft</span>
                  </div>
                </label>
                <small>
                  Current {feetInches(plateHeights[selected3DWall])} · Enter to
                  apply
                </small>
              </div>
            )}
            </ViewPanel>
          )}
        </section>
      </div>

      <footer className="statusbar">
        <span>
          <i
            className={
              !roofResolved || hipVariableTransition
                ? "warning-dot"
                : "healthy-dot"
            }
          />
          {!roofResolved
            ? "No roof solid: bearing-base elevations are contradictory"
            : hipVariableTransition
              ? "Roof planes regenerated; corner transitions are provisional"
            : "Wall tops, bearing rails, section, and 3D form agree"}
        </span>
        <span>
          {makeRoofFaces(
            roofKind,
            buildingWidth,
            buildingDepth,
            bearingElevations,
            overhangs,
            effectivePitch,
            roofResolved,
          ).length}{" "}
          planes · {roofResolved ? 1 : 0} structural form
        </span>
        <span>Eave conditions assigned per roof edge</span>
      </footer>
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
      <span>{label}<output>{output}</output></span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(event) => onChange(+event.target.value)}
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
    <div className={`view-panel ${className}`}>
      <div className="panel-heading">
        <div>
          <span className="view-label">{eyebrow}</span>
          <h2>{title}</h2>
        </div>
        {extra}
      </div>
      <div className="canvas-wrap">{children}</div>
    </div>
  );
}
