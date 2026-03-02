import { useState } from "react";
import { patients, cancerColors, type PatientDot } from "../realData";

const FONT = "'Space Mono', monospace";

interface Props {
  selectedId: string;
  onSelectPatient: (id: string) => void;
}

export function ScatterPlot({ selectedId, onSelectPatient }: Props) {
  const [hoverId, setHoverId] = useState<string | null>(null);
  // Cohort filter
  const [activeFilters, setActiveFilters] = useState<Set<string>>(
    new Set(["breast", "colon", "lung"])
  );

  const pad = { top: 40, right: 24, bottom: 44, left: 44 };
  const W = 520, H = 480;
  const plotW = W - pad.left - pad.right;
  const plotH = H - pad.top - pad.bottom;

  // Normalize maxTeam for opacity
  const maxTeam = Math.max(...patients.map((p) => p.maxTeam), 1);

  const selected = patients.find((p) => p.id === selectedId) ?? patients[0];

  const toggleFilter = (c: string) => {
    setActiveFilters((prev) => {
      const next = new Set(prev);
      if (next.has(c)) { if (next.size > 1) next.delete(c); }
      else next.add(c);
      return next;
    });
  };

  const visible = patients.filter((p) => activeFilters.has(p.cancer));

  return (
    <div style={{
      background: "#151820", border: "1px solid #252A35", borderRadius: 8,
      padding: 16, height: "100%", display: "flex", flexDirection: "column",
      fontFamily: FONT, position: "relative",
    }}>
      <div style={{ color: "#64748B", fontSize: 10, letterSpacing: 1.5, marginBottom: 6 }}>
        PATIENT COHORT OVERVIEW
      </div>

      {/* Cohort toggle buttons */}
      <div style={{ display: "flex", gap: 6, marginBottom: 8 }}>
        {(["breast", "colon", "lung"] as const).map((c) => {
          const active = activeFilters.has(c);
          const color = cancerColors[c];
          return (
            <button
              key={c}
              onClick={() => toggleFilter(c)}
              style={{
                background: active ? color + "22" : "transparent",
                border: `1px solid ${active ? color : "#252A35"}`,
                borderRadius: 4, padding: "2px 8px",
                color: active ? color : "#475569",
                fontSize: 8, fontFamily: FONT, cursor: "pointer",
                textTransform: "uppercase", letterSpacing: 1,
              }}
            >
              {c}
            </button>
          );
        })}
      </div>

      <svg viewBox={`0 0 ${W} ${H}`} style={{ flex: 1, width: "100%", cursor: "crosshair" }}>
        {/* Grid */}
        {[0.2, 0.4, 0.6, 0.8].map((f) => (
          <g key={f}>
            <line x1={pad.left} y1={pad.top + plotH*(1-f)} x2={pad.left+plotW} y2={pad.top+plotH*(1-f)} stroke="#1A2030" strokeWidth={1}/>
            <line x1={pad.left+plotW*f} y1={pad.top} x2={pad.left+plotW*f} y2={pad.top+plotH} stroke="#1A2030" strokeWidth={1}/>
          </g>
        ))}

        {/* Cohort background bands (subtle) */}
        {(["breast","colon","lung"] as const).filter(c => activeFilters.has(c)).map((c, ci) => {
          const color = cancerColors[c];
          // group dots by cohort for label
          const cohortPts = visible.filter(p => p.cancer === c);
          if (!cohortPts.length) return null;
          const minX = Math.min(...cohortPts.map(p => pad.left + p.x * plotW));
          const maxX = Math.max(...cohortPts.map(p => pad.left + p.x * plotW));
          const midY = cohortPts.reduce((s,p) => s + pad.top + (1-p.y)*plotH, 0) / cohortPts.length;
          return (
            <text key={c} x={Math.max(pad.left+2, minX)} y={midY - 14}
              fill={color} fillOpacity={0.3} fontSize={7} fontFamily={FONT} letterSpacing={1}>
              {c.toUpperCase()}
            </text>
          );
        })}

        {/* Dots — render non-selected first, selected on top */}
        {[...visible.filter(p => p.id !== selectedId), ...visible.filter(p => p.id === selectedId)].map((p) => {
          const cx = pad.left + p.x * plotW;
          const cy = pad.top + (1 - p.y) * plotH;
          const color = cancerColors[p.cancer];
          const isSelected = p.id === selectedId;
          const isHovered = p.id === hoverId;
          // Opacity encodes maxTeam size
          const teamOpacity = 0.3 + (p.maxTeam / maxTeam) * 0.65;

          return (
            <g key={p.id} style={{ cursor: "pointer" }}
              onClick={() => onSelectPatient(p.id)}
              onMouseEnter={() => setHoverId(p.id)}
              onMouseLeave={() => setHoverId(null)}>

              {/* Outer survival ring: white = survived, red-dashed = not */}
              {isSelected && (
                <>
                  <circle cx={cx} cy={cy} r={13} fill="none"
                    stroke={p.survived ? "#fff" : "#FF4757"}
                    strokeWidth={2} opacity={0.9}
                    strokeDasharray={p.survived ? "none" : "3,2"}
                  />
                  <circle cx={cx} cy={cy} r={18} fill="none"
                    stroke={color} strokeWidth={1} opacity={0.3}
                  />
                </>
              )}
              {isHovered && !isSelected && (
                <circle cx={cx} cy={cy} r={10} fill="none"
                  stroke={color} strokeWidth={1} opacity={0.4}/>
              )}

              {/* Core dot: filled = survived, outline = not */}
              {p.survived ? (
                <circle cx={cx} cy={cy} r={isSelected ? 6 : 4.5}
                  fill={color} opacity={isSelected ? 1 : isHovered ? 0.95 : teamOpacity}/>
              ) : (
                <circle cx={cx} cy={cy} r={isSelected ? 5.5 : 4}
                  fill="none" stroke={color} strokeWidth={1.5}
                  opacity={isSelected ? 1 : isHovered ? 0.9 : teamOpacity * 0.8}/>
              )}
            </g>
          );
        })}

        {/* Axes */}
        <text x={pad.left+plotW/2} y={H-6} textAnchor="middle" fill="#334155" fontSize={8} fontFamily={FONT}>Network Density →</text>
        <text x={12} y={pad.top+plotH/2} textAnchor="middle" fill="#334155" fontSize={8} fontFamily={FONT} transform={`rotate(-90,12,${pad.top+plotH/2})`}>Avg Risk Score ↑</text>
      </svg>

      {selected && <InfoCard patient={selected} />}

      {/* Legend */}
      <div style={{ display: "flex", gap: 14, marginTop: 8, flexWrap: "wrap", alignItems: "center" }}>
        {(["breast","colon","lung"] as const).map((c) => (
          <div key={c} style={{ display: "flex", alignItems: "center", gap: 4 }}>
            <svg width={8} height={8}><circle cx={4} cy={4} r={3.5} fill={cancerColors[c]}/></svg>
            <span style={{ color: "#64748B", fontSize: 7, fontFamily: FONT, textTransform: "uppercase" }}>{c}</span>
          </div>
        ))}
        <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
          <svg width={8} height={8}><circle cx={4} cy={4} r={3} fill="none" stroke="#94A3B8" strokeWidth={1.2}/></svg>
          <span style={{ color: "#64748B", fontSize: 7, fontFamily: FONT }}>NOT SURVIVED</span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
          <svg width={14} height={8}>
            <line x1={0} y1={4} x2={14} y2={4} stroke="#fff" strokeWidth={1.5}/>
          </svg>
          <span style={{ color: "#64748B", fontSize: 7, fontFamily: FONT }}>SURVIVED (selected)</span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
          <svg width={14} height={8}>
            <line x1={0} y1={4} x2={14} y2={4} stroke="#FF4757" strokeWidth={1.5} strokeDasharray="3,2"/>
          </svg>
          <span style={{ color: "#64748B", fontSize: 7, fontFamily: FONT }}>DECEASED (selected)</span>
        </div>
        <span style={{ color: "#334155", fontSize: 7, fontFamily: FONT }}>opacity = team size</span>
      </div>
    </div>
  );
}

function InfoCard({ patient }: { patient: PatientDot }) {
  const color = cancerColors[patient.cancer];
  return (
    <div style={{
      background: "#0D0F14", border: "1px solid #252A35", borderRadius: 8,
      padding: "8px 14px", marginTop: 6, fontFamily: FONT,
    }}>
      <div style={{ color, fontSize: 11, fontWeight: 700, marginBottom: 3 }}>{patient.id}</div>
      <div style={{ color: "#64748B", fontSize: 10, lineHeight: 1.7 }}>
        SURVIVED: {patient.survived ? "YES" : "NO"} | WEEKS: {patient.weeks}<br/>
        AVG RISK: {patient.avgRisk}% | MAX TEAM: {patient.maxTeam}<br/>
        DENSITY: {patient.density}%
      </div>
    </div>
  );
}