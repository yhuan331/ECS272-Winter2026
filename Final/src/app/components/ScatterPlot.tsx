/**
 * ScatterPlot.tsx  — real data version
 *
 * Props added:
 *   selectedId       — currently focused patient id
 *   onSelectPatient  — callback when user clicks a dot
 *
 * Data mapping:
 *   x     = edge_counter / max (network density)
 *   y     = avg weekly prob (risk score)
 *   color = cohort (breast/colon/lung)
 *   fill  = survived (solid) vs not (outline)
 *   info  = avgRisk, maxTeam, density, weeks
 */

import { useState } from "react";
import { patients, cancerColors, type PatientDot } from "../realData";

const FONT = "'Space Mono', monospace";

interface ScatterPlotProps {
  selectedId: string;
  onSelectPatient: (id: string) => void;
}

export function ScatterPlot({ selectedId, onSelectPatient }: ScatterPlotProps) {
  const [hoverId, setHoverId] = useState<string | null>(null);

  const pad = { top: 40, right: 20, bottom: 40, left: 40 };
  const w = 500;
  const h = 500;
  const plotW = w - pad.left - pad.right;
  const plotH = h - pad.top - pad.bottom;

  const selected = patients.find((p) => p.id === selectedId) ?? patients[0];

  return (
    <div
      style={{
        background: "#151820",
        border: "1px solid #252A35",
        borderRadius: 8,
        padding: 16,
        height: "100%",
        display: "flex",
        flexDirection: "column",
        fontFamily: FONT,
        position: "relative",
      }}
    >
      <div
        style={{
          color: "#64748B",
          fontSize: 10,
          letterSpacing: 1.5,
          marginBottom: 8,
        }}
      >
        PATIENT COHORT OVERVIEW
      </div>

      <svg
        viewBox={`0 0 ${w} ${h}`}
        style={{ flex: 1, width: "100%", cursor: "crosshair" }}
      >
        {/* Grid lines */}
        {[0.2, 0.4, 0.6, 0.8].map((f) => (
          <g key={f}>
            <line
              x1={pad.left}
              y1={pad.top + plotH * (1 - f)}
              x2={pad.left + plotW}
              y2={pad.top + plotH * (1 - f)}
              stroke="#1A2030"
              strokeWidth={1}
            />
            <line
              x1={pad.left + plotW * f}
              y1={pad.top}
              x2={pad.left + plotW * f}
              y2={pad.top + plotH}
              stroke="#1A2030"
              strokeWidth={1}
            />
          </g>
        ))}

        {/* Dots */}
        {patients.map((p) => {
          const cx = pad.left + p.x * plotW;
          const cy = pad.top + (1 - p.y) * plotH;
          const color = cancerColors[p.cancer];
          const isSelected = p.id === selectedId;
          const isHovered = p.id === hoverId;

          return (
            <g
              key={p.id}
              style={{ cursor: "pointer" }}
              onClick={() => onSelectPatient(p.id)}
              onMouseEnter={() => setHoverId(p.id)}
              onMouseLeave={() => setHoverId(null)}
            >
              {/* Selection ring */}
              {isSelected && (
                <circle
                  cx={cx}
                  cy={cy}
                  r={12}
                  fill="none"
                  stroke={color}
                  strokeWidth={2}
                  opacity={0.7}
                />
              )}
              {/* Hover ring */}
              {isHovered && !isSelected && (
                <circle
                  cx={cx}
                  cy={cy}
                  r={9}
                  fill="none"
                  stroke={color}
                  strokeWidth={1}
                  opacity={0.4}
                />
              )}
              {/* Dot: filled = survived, outline = not survived */}
              {p.survived ? (
                <circle
                  cx={cx}
                  cy={cy}
                  r={isSelected ? 6 : 5}
                  fill={color}
                  opacity={isSelected || isHovered ? 1 : 0.8}
                />
              ) : (
                <circle
                  cx={cx}
                  cy={cy}
                  r={isSelected ? 5.5 : 4.5}
                  fill="none"
                  stroke={color}
                  strokeWidth={1.5}
                  opacity={isSelected || isHovered ? 0.9 : 0.65}
                />
              )}
            </g>
          );
        })}

        {/* Axes labels */}
        <text
          x={pad.left + plotW / 2}
          y={h - 4}
          textAnchor="middle"
          fill="#334155"
          fontSize={8}
          fontFamily={FONT}
        >
          {"Network Density →"}
        </text>
        <text
          x={10}
          y={pad.top + plotH / 2}
          textAnchor="middle"
          fill="#334155"
          fontSize={8}
          fontFamily={FONT}
          transform={`rotate(-90, 10, ${pad.top + plotH / 2})`}
        >
          {"Avg Risk Score ↑"}
        </text>
      </svg>

      {/* Info card for selected patient */}
      {selected && <InfoCard patient={selected} />}

      {/* Legend */}
      <div
        style={{ display: "flex", gap: 16, marginTop: 10, flexWrap: "wrap" }}
      >
        {(["breast", "colon", "lung"] as const).map((c) => (
          <div
            key={c}
            style={{ display: "flex", alignItems: "center", gap: 5 }}
          >
            <svg width={10} height={10}>
              <circle cx={5} cy={5} r={4} fill={cancerColors[c]} />
            </svg>
            <span
              style={{
                color: "#64748B",
                fontSize: 8,
                fontFamily: FONT,
                textTransform: "uppercase",
              }}
            >
              {c}
            </span>
          </div>
        ))}
        <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
          <svg width={10} height={10}>
            <circle
              cx={5}
              cy={5}
              r={3.5}
              fill="none"
              stroke="#94A3B8"
              strokeWidth={1.2}
            />
          </svg>
          <span style={{ color: "#64748B", fontSize: 8, fontFamily: FONT }}>
            NOT SURVIVED
          </span>
        </div>
      </div>
    </div>
  );
}

function InfoCard({ patient }: { patient: PatientDot }) {
  const color = cancerColors[patient.cancer];
  return (
    <div
      style={{
        background: "#0D0F14",
        border: "1px solid #252A35",
        borderRadius: 8,
        padding: "10px 14px",
        marginTop: 8,
        fontFamily: FONT,
      }}
    >
      <div
        style={{ color, fontSize: 12, fontWeight: 700, marginBottom: 4 }}
      >
        {patient.id}
      </div>
      <div style={{ color: "#64748B", fontSize: 11, lineHeight: 1.7 }}>
        SURVIVED: {patient.survived ? "YES" : "NO"}&nbsp;|&nbsp;WEEKS:{" "}
        {patient.weeks}
        <br />
        AVG RISK: {patient.avgRisk}%&nbsp;|&nbsp;MAX TEAM: {patient.maxTeam}
        <br />
        DENSITY: {patient.density}%
      </div>
    </div>
  );
}