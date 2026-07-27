"use client";

import { useCallback, useEffect, useRef, useState } from "react";

type RoofKind = "gable" | "hip" | "shed";
type EdgeRole = "bearing" | "gable" | "high" | "low";
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
    roles: ["high", "bearing", "low", "bearing"],
  },
};

const EDGE_LABELS = ["North", "East", "South", "West"];

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

function makeRoofFaces(
  kind: RoofKind,
  buildingWidth: number,
  buildingDepth: number,
  plateHeight: number,
  heelHeight: number,
  pitch: number,
) {
  const w = buildingWidth / 2;
  const d = buildingDepth / 2;
  const base = plateHeight + heelHeight;
  const ridge = base + w * (pitch / 12);
  const faces: RoofFace[] = [];

  if (kind === "gable") {
    faces.push(
      {
        id: "west-plane",
        label: "West roof plane",
        color: "#d97834",
        points: [
          { x: -w, y: base, z: -d },
          { x: -w, y: base, z: d },
          { x: 0, y: ridge, z: d },
          { x: 0, y: ridge, z: -d },
        ],
      },
      {
        id: "east-plane",
        label: "East roof plane",
        color: "#ef9e67",
        points: [
          { x: 0, y: ridge, z: -d },
          { x: 0, y: ridge, z: d },
          { x: w, y: base, z: d },
          { x: w, y: base, z: -d },
        ],
      },
    );
  }

  if (kind === "hip") {
    const ridgeEnd = Math.max(0, d - w);
    faces.push(
      {
        id: "west-plane",
        label: "West roof plane",
        color: "#d97834",
        points: [
          { x: -w, y: base, z: -d },
          { x: -w, y: base, z: d },
          { x: 0, y: ridge, z: ridgeEnd },
          { x: 0, y: ridge, z: -ridgeEnd },
        ],
      },
      {
        id: "east-plane",
        label: "East roof plane",
        color: "#ef9e67",
        points: [
          { x: w, y: base, z: -d },
          { x: 0, y: ridge, z: -ridgeEnd },
          { x: 0, y: ridge, z: ridgeEnd },
          { x: w, y: base, z: d },
        ],
      },
      {
        id: "north-hip",
        label: "North hip plane",
        color: "#e78a4e",
        points: [
          { x: -w, y: base, z: -d },
          { x: 0, y: ridge, z: -ridgeEnd },
          { x: w, y: base, z: -d },
        ],
      },
      {
        id: "south-hip",
        label: "South hip plane",
        color: "#f2ae7e",
        points: [
          { x: -w, y: base, z: d },
          { x: w, y: base, z: d },
          { x: 0, y: ridge, z: ridgeEnd },
        ],
      },
    );
  }

  if (kind === "shed") {
    const high = base + buildingWidth * (pitch / 12);
    faces.push({
      id: "shed-plane",
      label: "Shed roof plane",
      color: "#dd8247",
      points: [
        { x: -w, y: base, z: -d },
        { x: -w, y: base, z: d },
        { x: w, y: high, z: d },
        { x: w, y: high, z: -d },
      ],
    });
  }
  return faces;
}

export default function Home() {
  const [roofKind, setRoofKind] = useState<RoofKind>("gable");
  const [buildingWidth, setBuildingWidth] = useState(28);
  const [buildingDepth, setBuildingDepth] = useState(40);
  const [plateHeight, setPlateHeight] = useState(9);
  const [heelHeight, setHeelHeight] = useState(0.75);
  const [pitch, setPitch] = useState(6);
  const [selectedEdge, setSelectedEdge] = useState(1);
  const [selectedPlane, setSelectedPlane] = useState("east-plane");
  const [showWalls, setShowWalls] = useState(true);
  const [showDatums, setShowDatums] = useState(true);
  const [showTopology, setShowTopology] = useState(true);

  const planRef = useRef<HTMLCanvasElement>(null);
  const formRef = useRef<HTMLCanvasElement>(null);
  const sectionRef = useRef<HTMLCanvasElement>(null);

  const roles = PRESETS[roofKind].roles;
  const structuralBase = plateHeight + heelHeight;
  const ridgeElevation =
    structuralBase +
    (roofKind === "shed" ? buildingWidth : buildingWidth / 2) * (pitch / 12);

  const reset = () => {
    setRoofKind("gable");
    setBuildingWidth(28);
    setBuildingDepth(40);
    setPlateHeight(9);
    setHeelHeight(0.75);
    setPitch(6);
    setSelectedEdge(1);
    setSelectedPlane("east-plane");
    setShowWalls(true);
    setShowDatums(true);
    setShowTopology(true);
  };

  const drawPlan = useCallback(() => {
    const canvas = planRef.current;
    if (!canvas) return;
    const ready = prepareCanvas(canvas);
    if (!ready) return;
    const { context, width, height } = ready;
    drawGrid(context, width, height);

    const margin = 64;
    const scale = Math.min(
      (width - margin * 2) / buildingDepth,
      (height - margin * 2) / buildingWidth,
    );
    const rectWidth = buildingDepth * scale;
    const rectHeight = buildingWidth * scale;
    const left = (width - rectWidth) / 2;
    const top = (height - rectHeight) / 2;
    const right = left + rectWidth;
    const bottom = top + rectHeight;
    const middle = (top + bottom) / 2;

    context.fillStyle = "#f8f5ee";
    context.fillRect(left, top, rectWidth, rectHeight);

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
    });

    context.strokeStyle = "#d97834";
    context.lineWidth = 2;
    context.beginPath();
    if (roofKind === "gable") {
      context.moveTo(left, middle);
      context.lineTo(right, middle);
    } else if (roofKind === "hip") {
      const inset = Math.min(rectWidth / 2, rectHeight / 2);
      context.moveTo(left, top);
      context.lineTo(left + inset, middle);
      context.lineTo(right - inset, middle);
      context.lineTo(right, top);
      context.moveTo(left, bottom);
      context.lineTo(left + inset, middle);
      context.moveTo(right, bottom);
      context.lineTo(right - inset, middle);
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
    context.fillText(feetInches(buildingDepth), width / 2, bottom + 34);
    context.save();
    context.translate(left - 34, height / 2);
    context.rotate(-Math.PI / 2);
    context.fillText(feetInches(buildingWidth), 0, 0);
    context.restore();
    context.textAlign = "left";
  }, [buildingDepth, buildingWidth, roofKind, selectedEdge]);

  const drawForm = useCallback(() => {
    const canvas = formRef.current;
    if (!canvas) return;
    const ready = prepareCanvas(canvas);
    if (!ready) return;
    const { context, width, height } = ready;
    const origin = { x: width * 0.52, y: height * 0.74 };
    const scale = Math.min(width / 76, height / 47);
    const project = (point: Point3) => ({
      x: origin.x + (point.x - point.z) * scale * 0.82,
      y:
        origin.y +
        (point.x + point.z) * scale * 0.36 -
        point.y * scale * 1.27,
    });

    context.fillStyle = "#fbfaf7";
    context.fillRect(0, 0, width, height);
    const w = buildingWidth / 2;
    const d = buildingDepth / 2;

    if (showWalls) {
      [
        [
          { x: -w, y: 0, z: d },
          { x: w, y: 0, z: d },
          { x: w, y: plateHeight, z: d },
          { x: -w, y: plateHeight, z: d },
        ],
        [
          { x: w, y: 0, z: -d },
          { x: w, y: 0, z: d },
          { x: w, y: plateHeight, z: d },
          { x: w, y: plateHeight, z: -d },
        ],
      ].forEach((face) =>
        drawPolygon(context, face.map(project), "#ded9cf", "#aaa399"),
      );
    }

    const faces = makeRoofFaces(
      roofKind,
      buildingWidth,
      buildingDepth,
      plateHeight,
      heelHeight,
      pitch,
    ).sort(
      (a, b) =>
        a.points.reduce((sum, p) => sum + p.z, 0) / a.points.length -
        b.points.reduce((sum, p) => sum + p.z, 0) / b.points.length,
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

    if (showDatums) {
      const start = project({ x: -w - 4, y: plateHeight, z: d + 2 });
      const end = project({ x: w + 7, y: plateHeight, z: d + 2 });
      context.setLineDash([5, 5]);
      context.strokeStyle = "#16838a";
      context.lineWidth = 1.5;
      context.beginPath();
      context.moveTo(start.x, start.y);
      context.lineTo(end.x, end.y);
      context.stroke();
      context.setLineDash([]);
      context.fillStyle = "#126a70";
      context.font = "600 10px monospace";
      context.fillText("T.O. PLATE", end.x - 66, end.y - 8);
    }

    context.fillStyle = "#25211d";
    context.font = "600 10px monospace";
    context.fillText("STRUCTURAL ROOF FORM", 18, 25);
  }, [
    buildingDepth,
    buildingWidth,
    heelHeight,
    pitch,
    plateHeight,
    roofKind,
    selectedPlane,
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
    const sy = (height - 50) / (ridgeElevation + 1.5);
    const sx = (width - 58) / (buildingWidth + 10);
    const x = (value: number) => width / 2 + value * sx;
    const y = (value: number) => floor - value * sy;

    context.fillStyle = "#fbfaf7";
    context.fillRect(0, 0, width, height);
    context.fillStyle = "#d8d2c8";
    context.fillRect(x(-buildingWidth / 2), y(plateHeight), 10, floor - y(plateHeight));
    context.fillRect(x(buildingWidth / 2) - 10, y(plateHeight), 10, floor - y(plateHeight));

    context.strokeStyle = "#16838a";
    context.lineWidth = 1.5;
    context.setLineDash([5, 4]);
    context.beginPath();
    context.moveTo(22, y(plateHeight));
    context.lineTo(width - 22, y(plateHeight));
    context.stroke();
    context.setLineDash([]);

    context.strokeStyle = "#d97834";
    context.lineWidth = 8;
    context.lineCap = "round";
    context.beginPath();
    context.moveTo(x(-buildingWidth / 2), y(structuralBase));
    if (roofKind === "shed") {
      context.lineTo(x(buildingWidth / 2), y(ridgeElevation));
    } else {
      context.lineTo(width / 2, y(ridgeElevation));
      context.lineTo(x(buildingWidth / 2), y(structuralBase));
    }
    context.stroke();

    context.fillStyle = "#126a70";
    context.font = "600 9px monospace";
    context.fillText("T.O. PLATE", 22, y(plateHeight) - 7);
    context.fillStyle = "#5c554c";
    context.fillText(`${pitch}:12`, width - 55, 20);
  }, [
    buildingWidth,
    pitch,
    plateHeight,
    ridgeElevation,
    roofKind,
    structuralBase,
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
  }, [drawForm, drawPlan, drawSection]);

  const chooseKind = (kind: RoofKind) => {
    setRoofKind(kind);
    setSelectedEdge(kind === "shed" ? 2 : 1);
    setSelectedPlane(kind === "shed" ? "shed-plane" : "east-plane");
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
              label="Top of plate"
              value={plateHeight}
              min={7}
              max={14}
              step={0.25}
              output={feetInches(plateHeight)}
              onChange={setPlateHeight}
            />
          </div>

          <div className="control-section">
            <ControlHeading number="03" title="Structural rules" />
            <Range
              label="Pitch"
              value={pitch}
              min={1}
              max={14}
              step={1}
              output={`${pitch}:12`}
              onChange={setPitch}
            />
            <Range
              label="Plane above plate"
              value={heelHeight}
              min={0.25}
              max={3}
              step={0.25}
              output={feetInches(heelHeight)}
              onChange={setHeelHeight}
            />
          </div>

          <div className="control-section layer-section">
            <ControlHeading number="04" title="View" />
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

        <section className="drawing-area">
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
                const rx = (event.clientX - rect.left) / rect.width;
                const ry = (event.clientY - rect.top) / rect.height;
                const distances = [ry, 1 - rx, 1 - ry, rx];
                setSelectedEdge(distances.indexOf(Math.min(...distances)));
              }}
            />
            <div className="canvas-note">Select an edge to inspect its intent</div>
          </ViewPanel>

          <ViewPanel
            className="form-panel"
            eyebrow="FORM / STRUCTURE"
            title="Coherent roof volume"
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
              onClick={() =>
                setSelectedPlane(
                  roofKind === "shed"
                    ? "shed-plane"
                    : selectedPlane === "east-plane"
                      ? "west-plane"
                      : "east-plane",
                )
              }
            />
            <div className="orientation">NE</div>
          </ViewPanel>

          <ViewPanel
            className="section-panel"
            eyebrow="SECTION / DATUM CHECK"
            title="Bearing relationship"
          >
            <canvas
              ref={sectionRef}
              aria-label="Section showing roof and top of plate"
            />
          </ViewPanel>

          <ViewPanel
            className="inspector-panel"
            eyebrow="SELECTION"
            title={`${EDGE_LABELS[selectedEdge]} edge`}
            extra={<span className="selection-index">E{selectedEdge + 1}</span>}
          >
            <dl className="property-list">
              <div><dt>Intent</dt><dd>{roleLabel(roles[selectedEdge])}</dd></div>
              <div><dt>Support datum</dt><dd>T.O. Plate · {feetInches(plateHeight)}</dd></div>
              <div><dt>Roof plane</dt><dd>{pitch}:12 structural plane</dd></div>
              <div><dt>Relationship</dt><dd className="healthy">Resolved</dd></div>
            </dl>
            <div className="derived-block">
              <span>DERIVED, NOT AUTHORED</span>
              <p>Ridge elevation <strong>{feetInches(ridgeElevation)}</strong></p>
            </div>
          </ViewPanel>
        </section>
      </div>

      <footer className="statusbar">
        <span><i className="healthy-dot" /> All roof planes resolved</span>
        <span>
          {makeRoofFaces(
            roofKind,
            buildingWidth,
            buildingDepth,
            plateHeight,
            heelHeight,
            pitch,
          ).length} planes · 1 structural form
        </span>
        <span>Eaves and finish assemblies deferred</span>
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
