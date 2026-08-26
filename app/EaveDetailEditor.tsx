"use client";

import { useCallback, useEffect, useRef } from "react";

export type RoofSystemType =
  | "rafter"
  | "raisedHeelTruss"
  | "cantileveredRaisedHeelTruss"
  | "commonTruss";

export type EaveParameters = {
  seatCut: number;
  rafterDepth: number;
  heelHeight: number;
  topChordDepth: number;
  bottomChordDepth: number;
  fasciaHeight: number;
  pitch: number;
  overhang: number;
};

export type EaveDetailDraft = {
  name: string;
  systemType: RoofSystemType;
  parameters: EaveParameters;
};

type EaveDetailEditorProps = {
  draft: EaveDetailDraft;
  onChange: (draft: EaveDetailDraft) => void;
  onCancel: () => void;
  onSave: () => void;
  saveLabel: string;
};

type SliderProps = {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  unit: string;
  onChange: (value: number) => void;
};

export const SYSTEM_LABELS: Record<RoofSystemType, string> = {
  rafter: "Rafter",
  raisedHeelTruss: "Raised heel truss",
  cantileveredRaisedHeelTruss: "Cantilevered raised-heel truss",
  commonTruss: "Common truss",
};

export const DEFAULT_EAVE_PARAMETERS: EaveParameters = {
  seatCut: 5.25,
  rafterDepth: 5.5,
  heelHeight: 13.75,
  topChordDepth: 5.5,
  bottomChordDepth: 3.5,
  fasciaHeight: 8,
  pitch: 6,
  overhang: 18,
};

const RED = "#e22b2b";
const INK = "#24211d";
const WOOD = "#e7d4b5";
const WOOD_LIGHT = "#f1e4ce";
const SHEATHING_THICKNESS = 0.6;
const FASCIA_STEP = 0.125;

function formatInches(value: number): string {
  return `${value.toFixed(2)}″`;
}

function minimumFasciaHeight(memberDepth: number, pitch: number): number {
  const slopeLength = Math.sqrt(1 + (pitch / 12) ** 2);
  return Math.ceil(((memberDepth + SHEATHING_THICKNESS) * slopeLength) / FASCIA_STEP) * FASCIA_STEP;
}

function Slider({ label, value, min, max, step, unit, onChange }: SliderProps) {
  return (
    <label className="eave-editor-control">
      <span className="eave-editor-control-heading">
        <strong>{label}</strong>
        <span className="eave-editor-value">
          <input
            aria-label={`${label} value`}
            type="number"
            min={min}
            max={max}
            step={step}
            value={Number(value.toFixed(3))}
            onChange={(event) => {
              const next = Number(event.target.value);
              if (Number.isFinite(next)) {
                onChange(Math.max(min, Math.min(max, next)));
              }
            }}
          />
          <span>{unit}</span>
        </span>
      </span>
      <input
        className="eave-editor-slider"
        aria-label={label}
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(event) => onChange(Number(event.target.value))}
      />
      <span className="eave-editor-range"><span>{min}</span><span>{max}</span></span>
    </label>
  );
}

function polygon(
  context: CanvasRenderingContext2D,
  points: Array<[number, number]>,
  fill: string,
): void {
  context.beginPath();
  points.forEach(([x, y], index) => {
    if (index === 0) {
      context.moveTo(x, y);
    } else {
      context.lineTo(x, y);
    }
  });
  context.closePath();
  context.fillStyle = fill;
  context.fill();
  context.strokeStyle = INK;
  context.lineWidth = 1.5;
  context.stroke();
}

function line(
  context: CanvasRenderingContext2D,
  startX: number,
  startY: number,
  endX: number,
  endY: number,
): void {
  context.beginPath();
  context.moveTo(startX, startY);
  context.lineTo(endX, endY);
  context.stroke();
}

export function EaveDetailPreview({
  draft,
  className = "",
}: {
  draft: EaveDetailDraft;
  className?: string;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (canvas === null) {
      return;
    }
    const bounds = canvas.getBoundingClientRect();
    const ratio = window.devicePixelRatio || 1;
    canvas.width = Math.round(bounds.width * ratio);
    canvas.height = Math.round(bounds.height * ratio);
    const context = canvas.getContext("2d");
    if (context === null) {
      return;
    }
    context.setTransform(ratio, 0, 0, ratio, 0, 0);
    context.clearRect(0, 0, bounds.width, bounds.height);
    context.lineCap = "round";
    context.lineJoin = "round";

    const inputs = draft.parameters;
    const isRafter = draft.systemType === "rafter";
    const isRaisedHeel = draft.systemType === "raisedHeelTruss";
    const isCantilevered = draft.systemType === "cantileveredRaisedHeelTruss";
    const isCommon = draft.systemType === "commonTruss";
    const fixedPitch = DEFAULT_EAVE_PARAMETERS.pitch;
    const pitchRatio = fixedPitch / 12;
    const slopeLength = Math.sqrt(1 + pitchRatio * pitchRatio);
    const memberDepth = isRafter ? inputs.rafterDepth : inputs.topChordDepth;
    const verticalDepth = memberDepth * slopeLength;
    const fasciaHeight = Math.max(inputs.fasciaHeight, minimumFasciaHeight(memberDepth, fixedPitch));
    const memberLeft = -inputs.overhang;
    const memberRight = 48;
    const lowerAt = (x: number): number => {
      if (isRaisedHeel) {
        return inputs.heelHeight - verticalDepth + pitchRatio * x;
      }
      if (isCantilevered) {
        return pitchRatio * (x + inputs.overhang);
      }
      if (isCommon) {
        return pitchRatio * x;
      }
      return pitchRatio * (x - inputs.seatCut);
    };
    const upperAt = (x: number): number => lowerAt(x) + verticalDepth;
    const fasciaTop = upperAt(memberLeft) + SHEATHING_THICKNESS * slopeLength;
    const fasciaBottom = fasciaTop - fasciaHeight;
    const soffitY = isCantilevered ? 0 : fasciaBottom;
    const springX = isCantilevered ? memberLeft : isRafter ? inputs.seatCut : 0;
    const springY = isRaisedHeel ? upperAt(0) : 0;

    const scale = Math.min((bounds.width - 80) / 92, (bounds.height - 70) / 68);
    const originX = bounds.width * 0.39;
    const originY = bounds.height * 0.6;
    const point = (x: number, y: number): [number, number] => [originX + x * scale, originY - y * scale];
    const worldPolygon = (points: Array<[number, number]>, fill: string): void => {
      polygon(context, points.map(([x, y]) => point(x, y)), fill);
    };

    const wallWidth = 3.5;
    worldPolygon([[0, -38], [wallWidth, -38], [wallWidth, -3], [0, -3]], "#f7f2e9");
    worldPolygon([[0, -3], [wallWidth, -3], [wallWidth, -1.5], [0, -1.5]], WOOD_LIGHT);
    worldPolygon([[0, -1.5], [wallWidth, -1.5], [wallWidth, 0], [0, 0]], WOOD);

    if (!isRafter) {
      const chordLeft = isCantilevered ? memberLeft : 0;
      worldPolygon([[chordLeft, 0], [memberRight, 0], [memberRight, inputs.bottomChordDepth], [chordLeft, inputs.bottomChordDepth]], WOOD_LIGHT);
      if (!isCommon) {
        const webRight = 6;
        const webStart = Math.max(0, Math.min(webRight, (inputs.bottomChordDepth - lowerAt(0)) / Math.max(0.01, pitchRatio)));
        if (lowerAt(webRight) > inputs.bottomChordDepth) {
          worldPolygon([[webStart, inputs.bottomChordDepth], [webRight, inputs.bottomChordDepth], [webRight, lowerAt(webRight)], [webStart, lowerAt(webStart)]], WOOD_LIGHT);
        }
      }
      worldPolygon([[memberLeft, lowerAt(memberLeft)], [memberRight, lowerAt(memberRight)], [memberRight, upperAt(memberRight)], [memberLeft, upperAt(memberLeft)]], WOOD);
    } else {
      worldPolygon([[memberLeft, lowerAt(memberLeft)], [0, lowerAt(0)], [0, 0], [inputs.seatCut, 0], [memberRight, lowerAt(memberRight)], [memberRight, upperAt(memberRight)], [memberLeft, upperAt(memberLeft)]], WOOD);
    }

    worldPolygon([[memberLeft - 0.35, upperAt(memberLeft)], [memberRight, upperAt(memberRight)], [memberRight, upperAt(memberRight) + 0.6], [memberLeft - 0.35, upperAt(memberLeft) + 0.6]], "#d7b98e");
    worldPolygon([[memberLeft - 1.5, fasciaBottom], [memberLeft, fasciaBottom], [memberLeft, fasciaTop], [memberLeft - 1.5, fasciaTop]], "#dbc39d");
    worldPolygon([[memberLeft, soffitY], [0, soffitY], [0, soffitY + 0.35], [memberLeft, soffitY + 0.35]], "#eee7db");

    const [plateX, plateY] = point(0, 0);
    const [springCanvasX, springCanvasY] = point(springX, springY);
    context.strokeStyle = "rgba(226,43,43,.45)";
    context.setLineDash([7, 7]);
    line(context, 18, plateY, bounds.width - 18, plateY);
    context.setLineDash([]);
    context.fillStyle = RED;
    context.beginPath();
    context.arc(springCanvasX, springCanvasY, 5, 0, Math.PI * 2);
    context.fill();
    context.strokeStyle = "rgba(226,43,43,.45)";
    context.beginPath();
    context.arc(springCanvasX, springCanvasY, 58, 0, Math.PI * 2);
    context.stroke();
    context.fillStyle = INK;
    context.beginPath();
    context.arc(plateX, plateY, 3.5, 0, Math.PI * 2);
    context.fill();

    context.fillStyle = RED;
    context.font = "500 11px monospace";
    context.textAlign = "right";
    context.fillText("T.O. PLATE", bounds.width - 24, plateY - 8);
    context.textAlign = "left";
    context.fillStyle = "#6f6252";
    context.fillText(`${SYSTEM_LABELS[draft.systemType].toUpperCase()}`, 24, 26);
    context.fillText(`${formatInches(inputs.overhang)} OVERHANG · ${fixedPitch}:12`, 24, 44);
    context.fillStyle = RED;
    context.fillText(isRafter ? `${formatInches(inputs.seatCut)} SEAT CUT` : `${formatInches(isRaisedHeel ? inputs.heelHeight : upperAt(0))} HEEL`, springCanvasX + 12, springCanvasY + 22);
  }, [draft]);

  useEffect(() => {
    draw();
    const observer = new ResizeObserver(draw);
    if (canvasRef.current !== null) {
      observer.observe(canvasRef.current);
    }
    return () => observer.disconnect();
  }, [draw]);

  return <canvas className={`eave-editor-canvas ${className}`} ref={canvasRef} role="img" aria-label={`${SYSTEM_LABELS[draft.systemType]} eave section`} />;
}

export function EaveDetailEditor({ draft, onChange, onCancel, onSave, saveLabel }: EaveDetailEditorProps) {
  const isRafter = draft.systemType === "rafter";
  const isRaisedHeel = draft.systemType === "raisedHeelTruss";
  const isCantilevered = draft.systemType === "cantileveredRaisedHeelTruss";
  const memberDepth = isRafter ? draft.parameters.rafterDepth : draft.parameters.topChordDepth;
  const fixedPitch = DEFAULT_EAVE_PARAMETERS.pitch;
  const fasciaMinimum = minimumFasciaHeight(memberDepth, fixedPitch);
  const parameters = {
    ...draft.parameters,
    pitch: fixedPitch,
    fasciaHeight: Math.max(draft.parameters.fasciaHeight, fasciaMinimum),
  };
  const update = (key: keyof EaveParameters, value: number): void => {
    onChange({ ...draft, parameters: { ...parameters, [key]: value } });
  };
  const changeSystem = (systemType: RoofSystemType): void => {
    onChange({ ...draft, systemType, parameters: { ...DEFAULT_EAVE_PARAMETERS } });
  };

  return (
    <div className="eave-editor-overlay" role="dialog" aria-modal="true" aria-label="2D eave detail editor">
      <div className="eave-editor-shell">
        <header className="eave-editor-header">
          <div>
            <span>CATALOG DETAIL EDITOR</span>
            <input aria-label="Detail name" value={draft.name} onChange={(event) => onChange({ ...draft, name: event.target.value })} />
          </div>
          <div className="eave-editor-actions">
            <button onClick={onCancel}>Cancel</button>
            <button className="primary" onClick={onSave}>{saveLabel}</button>
          </div>
        </header>
        <div className="eave-editor-workspace">
          <section className="eave-editor-drawing">
            <div className="eave-editor-title">
              <div><span>STRUCTURAL TYPE</span><h2>{SYSTEM_LABELS[draft.systemType]}</h2></div>
              <p>Define a reusable 2D bearing and fascia condition. Saved details become available only to roofs with this structural system.</p>
            </div>
            <EaveDetailPreview draft={{ ...draft, parameters }} />
            <div className="eave-editor-results">
              <div><span>Roof system</span><strong>{SYSTEM_LABELS[draft.systemType]}</strong></div>
              <div><span>Fascia minimum</span><strong>{formatInches(fasciaMinimum)}</strong></div>
              <div><span>Spring point</span><strong>{isRafter ? "Seat endpoint" : isCantilevered ? "Outside bottom chord" : "Plate bearing"}</strong></div>
            </div>
          </section>
          <aside className="eave-editor-controls">
            <span className="eave-editor-kicker">MUTUALLY EXCLUSIVE SYSTEM</span>
            <div className="eave-editor-system-switch">
              {(Object.keys(SYSTEM_LABELS) as RoofSystemType[]).map((systemType) => (
                <button key={systemType} className={draft.systemType === systemType ? "active" : ""} onClick={() => changeSystem(systemType)}>{SYSTEM_LABELS[systemType]}</button>
              ))}
            </div>
            <div className="eave-editor-section">
              <div className="eave-editor-section-label"><span>Constraints</span><small>Drive geometry</small></div>
              {isRafter ? <>
                <Slider label="Seat cut" min={0} max={9} step={0.125} unit="in" value={parameters.seatCut} onChange={(value) => update("seatCut", value)} />
                <Slider label="Rafter depth" min={3.5} max={11.875} step={0.125} unit="in" value={parameters.rafterDepth} onChange={(value) => update("rafterDepth", value)} />
              </> : null}
              {isRaisedHeel ? <Slider label="Heel height" min={6} max={30} step={0.25} unit="in" value={parameters.heelHeight} onChange={(value) => update("heelHeight", value)} /> : null}
              {!isRafter && !isRaisedHeel ? <Slider label="Top chord depth" min={3.5} max={11.875} step={0.125} unit="in" value={parameters.topChordDepth} onChange={(value) => update("topChordDepth", value)} /> : null}
            </div>
            <div className="eave-editor-section independent">
              <div className="eave-editor-section-label"><span>Independent</span><small>Does not move spring point</small></div>
              {!isCantilevered ? <Slider label="Overhang" min={6} max={36} step={0.5} unit="in" value={parameters.overhang} onChange={(value) => update("overhang", value)} /> : null}
              {!isRafter ? <Slider label="Bottom chord depth" min={1.5} max={7.25} step={0.125} unit="in" value={parameters.bottomChordDepth} onChange={(value) => update("bottomChordDepth", value)} /> : null}
              {isRaisedHeel ? <Slider label="Top chord depth" min={3.5} max={11.875} step={0.125} unit="in" value={parameters.topChordDepth} onChange={(value) => update("topChordDepth", value)} /> : null}
              {isCantilevered ? <Slider label="Overhang" min={6} max={36} step={0.5} unit="in" value={parameters.overhang} onChange={(value) => update("overhang", value)} /> : null}
            </div>
            <div className="eave-editor-section">
              <div className="eave-editor-section-label"><span>Fascia</span><small>Minimum {formatInches(fasciaMinimum)}</small></div>
              <Slider label="Fascia board height" min={fasciaMinimum} max={24} step={FASCIA_STEP} unit="in" value={parameters.fasciaHeight} onChange={(value) => update("fasciaHeight", value)} />
            </div>
          </aside>
        </div>
      </div>
    </div>
  );
}
