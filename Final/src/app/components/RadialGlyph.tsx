/**
 * RadialGlyph.tsx
 *
 * Week-cap arc: each patient's glyph only fills
 *   (patientWeeks / globalMaxWeeks) × 360°
 * so patients with fewer weeks visually take up less of the circle,
 * enabling direct duration comparison between patients.
 *
 * Two display modes:
 *  "prob"   — GNN Survival Prediction (height = raw prob, color = death risk gradient)
 *  "delta"  — Δ Prob (height = |probDelta|, color = direction)
 */

import { useState, useRef, useCallback, useEffect } from "react";
import { weeklyData, surgeonEvents, totalPatientHCP, globalMaxWeeks } from "../realData";
import type { WeekData } from "../realData";
import { T } from "../theme";

const FONT = T.font;
const CX = 350;
const CY = 280;
const BASE_R   = 130;
const CENTER_R = 110;
const SIZE     = 700;

export type ViewMode = "prob" | "delta";

// ── Color helpers ────────────────────────────────────────────────────────────

function lerpColor(a: string, b: string, t: number): string {
  const parse = (h: string, o: number) => parseInt(h.slice(o, o + 2), 16);
  const r  = Math.round(parse(a,1) + (parse(b,1) - parse(a,1)) * t);
  const g  = Math.round(parse(a,3) + (parse(b,3) - parse(a,3)) * t);
  const bl = Math.round(parse(a,5) + (parse(b,5) - parse(a,5)) * t);
  return `#${r.toString(16).padStart(2,"0")}${g.toString(16).padStart(2,"0")}${bl.toString(16).padStart(2,"0")}`;
}

function survivalColor(prob: number): string {
  const stops = [
    { t: 0.0,  color: "#276749" },
    { t: 0.25, color: "#68D391" },
    { t: 0.45, color: "#DD6B20" },
    { t: 0.55, color: "#D69E2E" },
    { t: 0.75, color: "#E53E3E" },
    { t: 1.0,  color: "#9B2335" },
  ];
  const p = Math.min(1, Math.max(0, prob));
  if (p <= stops[0].t) return stops[0].color;
  if (p >= stops[stops.length - 1].t) return stops[stops.length - 1].color;
  for (let i = 0; i < stops.length - 1; i++) {
    if (p >= stops[i].t && p <= stops[i + 1].t) {
      const ratio = (p - stops[i].t) / (stops[i + 1].t - stops[i].t);
      return lerpColor(stops[i].color, stops[i + 1].color, ratio);
    }
  }
  return stops[0].color;
}

function polarToCart(cx: number, cy: number, r: number, angleDeg: number) {
  const rad = ((angleDeg - 90) * Math.PI) / 180;
  return { x: cx + r * Math.cos(rad), y: cy + r * Math.sin(rad) };
}

// Draw an arc path segment (for the unused-arc ghost ring)
function arcPath(cx: number, cy: number, r: number, startDeg: number, endDeg: number): string {
  const s = polarToCart(cx, cy, r, startDeg);
  const e = polarToCart(cx, cy, r, endDeg);
  const span = endDeg - startDeg;
  const largeArc = span > 180 ? 1 : 0;
  return `M${s.x},${s.y} A${r},${r} 0 ${largeArc} 1 ${e.x},${e.y}`;
}

interface RadialProps {
  selectedWeek: number | null;
  onSelectWeek: (week: number | null) => void;
  mode?: ViewMode;
  onModeChange?: (mode: ViewMode) => void;
  compact?: boolean;
  accentColor?: string;
}

export function RadialGlyph({
  selectedWeek,
  onSelectWeek,
  mode: modeProp,
  onModeChange,
  compact = false,
  accentColor,
}: RadialProps) {
  const [hoveredIdx, setHoveredIdx] = useState<number | null>(null);
  const [localMode, setLocalMode]   = useState<ViewMode>(modeProp ?? "delta");

  useEffect(() => {
    if (modeProp) setLocalMode(modeProp);
  }, [modeProp]);

  const mode: ViewMode = modeProp ?? localMode;
  const svgRef = useRef<SVGSVGElement>(null);

  const handleSetMode = (m: ViewMode) => {
    setLocalMode(m);
    onModeChange?.(m);
  };

  if (!weeklyData.length) return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "center",
      height: "100%", color: T.textFaint, fontFamily: FONT, fontSize: 12, letterSpacing: 2 }}>
      SELECT A PATIENT
    </div>
  );

  // ── Stats ────────────────────────────────────────────────────────────────
  const totalNotes = weeklyData.reduce((s, d) => s + d.noteFrequency, 0);
  const avgNotes   = weeklyData.length ? (totalNotes / weeklyData.length).toFixed(1) : "0";
  const avgRiskAll = weeklyData.length
    ? ((weeklyData.reduce((s, d) => s + d.riskScore, 0) / weeklyData.length) * 100).toFixed(1)
    : "0";
  const avgAbsDeltaTeam =
    weeklyData.length > 1
      ? (weeklyData.slice(1).reduce((s, d, i) => {
          const prev = weeklyData[i]?.teamSize ?? 0;
          return s + Math.abs((d?.teamSize ?? 0) - prev);
        }, 0) / (weeklyData.length - 1)).toFixed(1)
      : "0.0";

  const numWeeks = weeklyData.length;

  // ── WEEK CAP ARC ────────────────────────────────────────────────────────
  // Each patient uses only (numWeeks / globalMaxWeeks) × 360° of the circle.
  // globalMaxWeeks is the max across ALL patients in the dataset.
  const safeGlobalMax = Math.max(globalMaxWeeks, numWeeks, 1);
  const arcFraction   = numWeeks / safeGlobalMax;        // 0 → 1
  const usedArcDeg    = arcFraction * 360;               // degrees used
  const anglePerWeek  = usedArcDeg / Math.max(numWeeks, 1);

  // ── Normalisation bounds ─────────────────────────────────────────────────
  const maxProb   = Math.max(...weeklyData.map(d => d.riskScore), 0.001);
  const minProb   = Math.min(...weeklyData.map(d => d.riskScore), 0);
  const probRange = maxProb - minProb || 0.001;
  const maxDelta  = Math.max(...weeklyData.map(d => Math.abs(d.probDelta)), 0.001);
  const maxTeam   = Math.max(...weeklyData.map(d => d.teamSize), 1);
  const minTeam   = Math.min(...weeklyData.map(d => d.teamSize), 0);
  const teamRange = maxTeam - minTeam || 1;

  // ── Spike geometry ───────────────────────────────────────────────────────
  const spikePaths = weeklyData.map((d, i) => {
    const centerAngle = i * anglePerWeek;  // stays within usedArcDeg

    let h: number;
    let color: string;

    if (mode === "prob") {
      const norm = (d.riskScore - minProb) / probRange;
      h     = 10 + norm * 95;
      color = survivalColor(d.riskScore);
    } else {
      const norm = Math.abs(d.probDelta) / maxDelta;
      h     = 10 + norm * 95;
      color = d.spikeColor;
    }

    const outerR = BASE_R + h;
    const wNorm  = (d.teamSize - minTeam) / teamRange;
    const sw     = anglePerWeek * (0.35 + wNorm * 0.55);
    const a1 = centerAngle - sw / 2;
    const a2 = centerAngle + sw / 2;
    const p1 = polarToCart(CX, CY, BASE_R, a1);
    const p2 = polarToCart(CX, CY, BASE_R, a2);
    const p3 = polarToCart(CX, CY, outerR, a2);
    const p4 = polarToCart(CX, CY, outerR, a1);
    const hitA1 = centerAngle - anglePerWeek / 2;
    const hitA2 = centerAngle + anglePerWeek / 2;
    const h1 = polarToCart(CX, CY, BASE_R - 4, hitA1);
    const h2 = polarToCart(CX, CY, BASE_R - 4, hitA2);
    const h3 = polarToCart(CX, CY, outerR + 6, hitA2);
    const h4 = polarToCart(CX, CY, outerR + 6, hitA1);

    return {
      d, i, color, outerR, centerAngle,
      path:    `M${p1.x},${p1.y} L${p4.x},${p4.y} L${p3.x},${p3.y} L${p2.x},${p2.y} Z`,
      hitPath: `M${h1.x},${h1.y} L${h4.x},${h4.y} L${h3.x},${h3.y} L${h2.x},${h2.y} Z`,
    };
  });

  const orbitPoints = spikePaths.map(s => {
    const pt = polarToCart(CX, CY, s.outerR, s.centerAngle);
    return { ...pt, color: s.color };
  });
  const orbitPath = orbitPoints.map((p, i) => i === 0 ? `M${p.x},${p.y}` : `L${p.x},${p.y}`).join(" ");

  // ── Center disc ──────────────────────────────────────────────────────────
  const segments = [
    { fill: "#EEF2FF", startAngle: -90, endAngle: 30 },
    { fill: "#F0FFF4", startAngle: 30,  endAngle: 150 },
    { fill: "#FFFBEB", startAngle: 150, endAngle: 270 },
  ];

  // ── Week annotations ─────────────────────────────────────────────────────
  const w0S = polarToCart(CX, CY, BASE_R, 0);
  const w0E = polarToCart(CX, CY, BASE_R + 130, 0);
  const w0L = polarToCart(CX, CY, BASE_R + 142, 0);
  const wLA = (numWeeks - 1) * anglePerWeek;
  const wLS = polarToCart(CX, CY, BASE_R, wLA);
  const wLE = polarToCart(CX, CY, BASE_R + 130, wLA);
  const wLL = polarToCart(CX, CY, BASE_R + 144, wLA);

  // ── Hover (visual feedback only — no data reveal on hover) ──────────────
  const handleSpikeHover = useCallback((i: number) => {
    setHoveredIdx(i);
  }, []);

  const handleSpikeLeave = useCallback(() => {
    setHoveredIdx(null);
  }, []);

  // ── Mode config ──────────────────────────────────────────────────────────
  const modeConfig = {
    prob:  { label: "GNN Death Probability", short: "GNN PROB (DEATH)", accent: accentColor ?? "#38A169",
             legend: [{ color: "#276749", label: "low death risk" }, { color: "#D69E2E", label: "mid" }, { color: "#9B2335", label: "high death risk" }],
             encoding: "height = prob · width = team size" },
    delta: { label: "Δ Week-over-Week Change", short: "Δ PROB", accent: accentColor ?? "#E53E3E",
             legend: [{ color: "#E53E3E", label: "rising" }, { color: "#D69E2E", label: "stable" }, { color: "#38A169", label: "falling" }],
             encoding: "height = |Δ| · width = team size" },
  } as const;
  const active = modeConfig[mode];

  // Percentage of the circle used (for label)
  const arcPct = Math.round(arcFraction * 100);

  return (
    <div style={{
      height: "100%", position: "relative",
      background: T.bgCard, border: `1px solid ${T.border}`,
      borderRadius: 10, boxShadow: "0 1px 4px rgba(0,0,0,0.06)",
      display: "flex", flexDirection: "column",
    }}>

      {/* ── Tab switcher ── */}
      <div style={{ display: "flex", flexShrink: 0, borderBottom: `1px solid ${T.border}` }}>
        {(["prob", "delta"] as ViewMode[]).map((m, mi) => {
          const cfg      = modeConfig[m];
          const isActive = mode === m;
          return (
            <button key={m} onClick={() => handleSetMode(m)} style={{
              flex: 1, padding: "9px 0 7px",
              fontFamily: FONT, fontSize: 10, fontWeight: 700, letterSpacing: 1,
              cursor: "pointer", border: "none",
              borderBottom: isActive ? `2px solid ${cfg.accent}` : "2px solid transparent",
              borderRight: mi === 0 ? `1px solid ${T.border}` : "none",
              background: isActive ? `${cfg.accent}10` : "transparent",
              color: isActive ? cfg.accent : T.textMuted,
              transition: "all 0.15s",
            }}>
              {cfg.short}
            </button>
          );
        })}
      </div>

      {/* ── Legend + arc indicator strip ── */}
      <div style={{
        display: "flex", alignItems: "center", gap: 10,
        padding: "5px 14px", borderBottom: `1px solid ${T.border}`,
        flexShrink: 0, flexWrap: "wrap",
      }}>
        <span style={{ color: T.textMuted, fontSize: 9, fontFamily: FONT, marginRight: 4 }}>
          {active.label}
        </span>
        {active.legend.map(l => <LegendDot key={l.label} color={l.color} label={l.label} />)}
        {/* Arc fill indicator */}
        <span style={{
          marginLeft: "auto", display: "flex", alignItems: "center", gap: 5,
          color: T.textFaint, fontSize: 9, fontFamily: FONT,
        }}>
          <span style={{
            display: "inline-block", width: 32, height: 5, borderRadius: 3,
            background: T.bgInset, overflow: "hidden", position: "relative",
          }}>
            <span style={{
              position: "absolute", left: 0, top: 0, height: "100%",
              width: `${arcPct}%`,
              background: active.accent, borderRadius: 3, opacity: 0.7,
            }} />
          </span>
          <span>{numWeeks}wk / {safeGlobalMax}wk max ({arcPct}%)</span>
        </span>
      </div>

      {/* ── SVG ── */}
      <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", overflow: "hidden", minHeight: 0 }}>
        <svg ref={svgRef} viewBox={`0 0 ${SIZE} 560`}
          preserveAspectRatio="xMidYMid meet"
          style={{ width: "100%", height: "100%", maxWidth: "100%", maxHeight: "100%", display: "block" }}>
          <defs>
            {spikePaths.map((s, i) => (
              <radialGradient key={`sg${i}`} id={`spikeGrad${i}`} cx="50%" cy="50%" r="50%">
                <stop offset="0%"   stopColor={s.color} stopOpacity={0.38} />
                <stop offset="100%" stopColor={s.color} stopOpacity={1} />
              </radialGradient>
            ))}
            <filter id="orbitGlow" x="-20%" y="-20%" width="140%" height="140%">
              <feGaussianBlur in="SourceGraphic" stdDeviation="3" />
            </filter>
            <filter id="hoverGlow" x="-50%" y="-50%" width="200%" height="200%">
              <feGaussianBlur in="SourceGraphic" stdDeviation="4" />
            </filter>
          </defs>

          {/* Ghost arc showing unused portion of circle */}
          {arcFraction < 0.99 && (
            <path
              d={arcPath(CX, CY, BASE_R, usedArcDeg, 360)}
              fill="none"
              stroke={T.border}
              strokeWidth={1.5}
              strokeDasharray="4,4"
              opacity={0.5}
            />
          )}

          {/* Center disc */}
          {segments.map((seg, si) => {
            const sweep = seg.endAngle - seg.startAngle;
            const p1 = polarToCart(CX, CY, CENTER_R, seg.startAngle);
            const p2 = polarToCart(CX, CY, CENTER_R, seg.endAngle);
            return (
              <path key={si}
                d={`M${CX},${CY} L${p1.x},${p1.y} A${CENTER_R},${CENTER_R} 0 ${sweep > 180 ? 1 : 0} 1 ${p2.x},${p2.y} Z`}
                fill={seg.fill} />
            );
          })}

          {/* Dividers */}
          {[-90, 30, 150, 270].map(a => {
            const p = polarToCart(CX, CY, CENTER_R, a);
            return <line key={a} x1={CX} y1={CY} x2={p.x} y2={p.y} stroke={T.border} strokeWidth={1} />;
          })}

          {/* TOTAL HCP */}
          {(() => {
            const lp = polarToCart(CX, CY, CENTER_R * 0.45, -30);
            const vp = polarToCart(CX, CY, CENTER_R * 0.62, -30);
            return (
              <g>
                <text x={lp.x} y={lp.y - 3} textAnchor="middle" dominantBaseline="central"
                  fill={T.textMuted} fontSize={9} fontFamily={FONT}>TOTAL UNIQUE HCP</text>
                <text x={vp.x} y={vp.y + 3} textAnchor="middle" dominantBaseline="central"
                  fill="#2B6CB0" fontSize={16} fontFamily={FONT} fontWeight={700}>{totalPatientHCP}</text>
              </g>
            );
          })()}

          {/* TEAM VOLATILITY */}
          {(() => {
            const lp = polarToCart(CX, CY, CENTER_R * 0.45, 90);
            const vp = polarToCart(CX, CY, CENTER_R * 0.62, 90);
            return (
              <g>
                <text x={lp.x} y={lp.y - 3} textAnchor="middle" dominantBaseline="central"
                  fill={T.textMuted} fontSize={9} fontFamily={FONT}>TEAM VOLATILITY</text>
                <text x={vp.x} y={vp.y + 3} textAnchor="middle" dominantBaseline="central"
                  fill="#38A169" fontSize={13} fontFamily={FONT} fontWeight={700}>{avgAbsDeltaTeam}/wk</text>
              </g>
            );
          })()}

          {/* AVG RISK */}
          {(() => {
            const lp = polarToCart(CX, CY, CENTER_R * 0.32, 210);
            return (
              <g>
                <text x={lp.x} y={lp.y + 1} textAnchor="middle" dominantBaseline="central"
                  fill="#D69E2E" fontSize={11} fontFamily={FONT}>(Avg Risk) {avgRiskAll}%</text>
              </g>
            );
          })()}

          {/* Base ring */}
          <circle cx={CX} cy={CY} r={BASE_R} fill="none" stroke={T.borderMid} strokeWidth={1.5} />

          {/* Spikes */}
          {spikePaths.map((s, i) => {
            const isHovered      = hoveredIdx === i;
            const isWeekSelected = selectedWeek !== null && weeklyData[i]?.week === selectedWeek;
            return (
              <g key={i}>
                {(isHovered || isWeekSelected) && (
                  <path d={s.path} fill={s.color} opacity={isWeekSelected ? 0.5 : 0.35} filter="url(#hoverGlow)" />
                )}
                <path
                  d={s.path}
                  fill={`url(#spikeGrad${i})`}
                  stroke={s.color}
                  strokeWidth={isHovered || isWeekSelected ? 1.5 : 0.4}
                  strokeOpacity={isHovered || isWeekSelected ? 1 : 0.4}
                  opacity={selectedWeek !== null && !isWeekSelected ? 0.35 : 1}
                />
              </g>
            );
          })}

          {/* Hit areas */}
          {spikePaths.map((s, i) => (
            <path key={`hit${i}`} d={s.hitPath} fill="transparent" stroke="none"
              style={{ cursor: "pointer" }}
              onMouseEnter={() => handleSpikeHover(i)}
              onMouseMove={() => handleSpikeHover(i)}
              onMouseLeave={handleSpikeLeave}
              onClick={() => {
                const w = weeklyData[i];
                if (!w) return;
                onSelectWeek(selectedWeek === w.week ? null : w.week);
              }}
            />
          ))}

          {/* Orbit glow */}
          <path d={orbitPath} fill="none" stroke={active.accent} strokeWidth={6} opacity={0.12} filter="url(#orbitGlow)" />

          {/* Orbit colored segments */}
          {orbitPoints.map((p, i) => {
            if (i === 0) return null;
            const prev = orbitPoints[i - 1];
            return <line key={i} x1={prev.x} y1={prev.y} x2={p.x} y2={p.y} stroke={p.color} strokeWidth={2} strokeLinecap="round" />;
          })}
          <path d={orbitPath} fill="none" stroke="rgba(0,0,0,0.06)" strokeWidth={0.8} />

          {/* Hover orbit highlight */}
          {hoveredIdx !== null && hoveredIdx > 0 && (
            <line
              x1={orbitPoints[hoveredIdx - 1].x} y1={orbitPoints[hoveredIdx - 1].y}
              x2={orbitPoints[hoveredIdx].x}     y2={orbitPoints[hoveredIdx].y}
              stroke={T.textPrimary} strokeWidth={2} strokeLinecap="round" opacity={0.5}
            />
          )}

          {/* Hover radial line + week label */}
          {hoveredIdx !== null && (() => {
            const sp    = spikePaths[hoveredIdx];
            const angle = sp.centerAngle;
            const inner = polarToCart(CX, CY, BASE_R - 5, angle);
            const outer = polarToCart(CX, CY, sp.outerR + 14, angle);
            const lblPt = polarToCart(CX, CY, sp.outerR + 26, angle);
            const wk    = weeklyData[hoveredIdx];
            const isSelected = selectedWeek !== null && wk?.week === selectedWeek;
            return (
              <g>
                <line x1={inner.x} y1={inner.y} x2={outer.x} y2={outer.y}
                  stroke="rgba(0,0,0,0.25)" strokeWidth={0.8} strokeDasharray="3,3" />
                <text x={lblPt.x} y={lblPt.y} textAnchor="middle" dominantBaseline="central"
                  fontSize={9} fill={isSelected ? active.accent : T.textSecondary}
                  fontFamily={FONT} fontWeight={700}>
                  {isSelected ? `w${wk?.week} ✓` : `w${wk?.week}`}
                </text>
              </g>
            );
          })()}

          {/* Week annotations */}
          <line x1={w0S.x} y1={w0S.y} x2={w0E.x} y2={w0E.y} stroke={T.textMuted} strokeWidth={1} strokeDasharray="4,4" />
          <text x={w0L.x} y={w0L.y} textAnchor="middle" fill={T.textSecondary} fontSize={10} fontFamily={FONT}>week 0</text>
          {numWeeks > 1 && <>
            <line x1={wLS.x} y1={wLS.y} x2={wLE.x} y2={wLE.y} stroke={T.textFaint} strokeWidth={1} strokeDasharray="4,4" />
            <text x={wLL.x} y={wLL.y} textAnchor="middle" fill={T.textMuted} fontSize={10} fontFamily={FONT} dominantBaseline="central">
              last w{numWeeks - 1}
            </text>
          </>}

          {/* Surgeon event dots */}
          {surgeonEvents.map(weekNum => {
            const idx = weeklyData.findIndex(w => w.week === weekNum);
            if (idx < 0) return null;
            const d    = weeklyData[idx];
            const h    = mode === "prob"
              ? 10 + ((d.riskScore - minProb) / probRange) * 95
              : 10 + (Math.abs(d.probDelta) / maxDelta) * 95;
            const angle = idx * anglePerWeek;
            const outer = polarToCart(CX, CY, BASE_R + h + 10, angle);
            return <circle key={weekNum} cx={outer.x} cy={outer.y} r={3} fill="#FFD166" opacity={0.85} />;
          })}
        </svg>
      </div>
    </div>
  );
}

// ── Small legend dot ─────────────────────────────────────────────────────────
function LegendDot({ color, label }: { color: string; label: string }) {
  return (
    <span style={{ display: "flex", alignItems: "center", gap: 4 }}>
      <span style={{ width: 7, height: 7, borderRadius: "50%", background: color, flexShrink: 0 }} />
      <span style={{ color: T.textMuted, fontSize: 9, fontFamily: T.font }}>{label}</span>
    </span>
  );
}

// ── Panel components ─────────────────────────────────────────────────────────

export function Stat({ label, value, color, small }: { label: string; value: string; color: string; small?: boolean }) {
  return (
    <div>
      <div style={{ color: T.textMuted, fontSize: 11, letterSpacing: 1, marginBottom: 3 }}>{label}</div>
      <div style={{ color, fontSize: small ? 13 : 18, fontWeight: 700, fontFamily: T.font }}>{value}</div>
    </div>
  );
}

export function EmptyPanel({ avgRiskAll, peakWeek, totalPatientHCP, avgNotes, mode, peakDeltaWeek }: {
  avgRiskAll: string;
  peakWeek: WeekData | null;
  totalPatientHCP: number;
  avgNotes: string;
  mode: ViewMode;
  peakDeltaWeek?: WeekData | null;
}) {
  const isProb = mode === "prob";
  return (
    <div style={{ fontFamily: T.font }}>
      <div style={{ color: T.textFaint, fontSize: 11, letterSpacing: 1.5, marginBottom: 8 }}>
        CLICK A SPIKE TO INSPECT
      </div>
      <div style={{ color: T.textMuted, fontSize: 9, marginBottom: 8 }}>
        {isProb
          ? "GNN PROB: green=low death risk · red=high death risk"
          : "Δ PROB: red=rising · green=falling · height = |Δ| · width = team size"
        }
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "6px 16px" }}>
        {isProb ? (
          <>
            <Stat label="AVG RISK"   value={`${avgRiskAll}%`}        color="#D69E2E" />
            <Stat label="TOTAL HCP"  value={String(totalPatientHCP)} color="#2B6CB0" />
            <Stat label="NOTES / WK" value={avgNotes}                color="#38A169" />
            {peakWeek && (
              <Stat label="PEAK WEEK" value={`W${peakWeek.week} · ${(peakWeek.riskScore * 100).toFixed(0)}%`} color="#E53E3E" />
            )}
          </>
        ) : (
          <>
            <Stat label="TOTAL HCP"  value={String(totalPatientHCP)} color="#2B6CB0" />
            <Stat label="NOTES / WK" value={avgNotes}                color="#38A169" />
            {peakDeltaWeek && (
              <>
                <Stat label="LARGEST Δ WEEK" value={`W${peakDeltaWeek.week}`} color="#E53E3E" />
                <Stat label="PEAK Δ VALUE"
                  value={`${peakDeltaWeek.probDelta >= 0 ? "+" : ""}${(peakDeltaWeek.probDelta * 100).toFixed(1)}%`}
                  color={peakDeltaWeek.spikeColor} />
              </>
            )}
          </>
        )}
      </div>
    </div>
  );
}

export function WeekPanel({ data, pinned, mode = "delta" }: { data: WeekData; pinned?: boolean; mode?: ViewMode }) {
  const isSurgeonWeek = surgeonEvents.includes(data.week);
  return (
    <div style={{ fontFamily: T.font }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 8 }}>
        <span style={{ color: T.textPrimary, fontSize: 20, fontWeight: 700 }}>WEEK {data.week}</span>
        {isSurgeonWeek && (
          <span style={{ color: "#D69E2E", fontSize: 9, background: "#FFFBEB", padding: "2px 8px", borderRadius: 4, border: "1px solid #D69E2E44" }}>
            ✦ SURGEON EVENT
          </span>
        )}
        <span style={{ color: T.textFaint, fontSize: 9, marginLeft: "auto" }}>
          {pinned
            ? <span style={{ color: "#2B6CB0", background: "#EEF2FF", padding: "2px 8px", borderRadius: 4, border: "1px solid #2B6CB044", fontSize: 9 }}>
                📌 SELECTED — click same spike to deselect
              </span>
            : "click a spike to inspect"
          }
        </span>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "8px 16px", marginBottom: 14 }}>
        {mode === "prob" ? (
          <Stat label="GNN DEATH RISK (CUMULATIVE)" value={`${(data.riskScore * 100).toFixed(1)}%`} color={data.spikeColor} />
        ) : (
          <Stat label="Δ PROB THIS WEEK"
            value={`${data.probDelta >= 0 ? "+" : ""}${(data.probDelta * 100).toFixed(2)}%`}
            color={data.spikeColor} />
        )}
        <Stat label="TEAM SIZE" value={String(data.teamSize ?? "—")} color="#6B9FFF" />
        <Stat label="CARE DIVERSITY"
          value={data.entropy == null ? "—" : `${data.entropy.toFixed(2)} · ${data.entropy < 1.5 ? "LOW" : data.entropy < 2.5 ? "MED" : "HIGH"}`}
          color="#A78BFA" />
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
        <div>
          <div style={{ color: T.textSecondary, fontSize: 12, fontWeight: 700, marginBottom: 6, letterSpacing: 1 }}>ACTIVE SPECIALTIES</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
            {([...new Set((data.hcpSnaps ?? []).map(h => (h.specialty || h.providerType || "").trim()).filter(n => n && n !== "nan" && n !== "null"))]).slice(0, 10).map((name, ni) => (
              <span key={ni} style={{ color: T.textSecondary, fontSize: 12, lineHeight: 1.8 }}>· {name}</span>
            ))}
          </div>
        </div>
        <div>
          <div style={{ color: T.textSecondary, fontSize: 12, fontWeight: 700, marginBottom: 4, letterSpacing: 1 }}>
            TOP ATTRIBUTES ({data.topSHAP?.length ?? 0})
          </div>
          <div style={{ color: T.textMuted, fontSize: 9, marginBottom: 4 }}>
            red = raises death risk · green = lowers death risk
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
            {(data.topSHAP ?? []).slice(0, 10).map((s, si) => {
              const isPos  = s.contribution >= 0;
              const parts  = s.feature.split("::");
              const field  = (parts[0] ?? "").replace(/_/g, " ").replace("ACCESS USER ", "").toLowerCase();
              const value  = (parts[1] ?? "").replace(/^\*/, "").toLowerCase();
              const label  = `${field}: ${value}`;
              const barW   = Math.min(60, Math.abs(s.contribution) * 30);
              return (
                <div key={si} style={{ display: "flex", alignItems: "flex-start", gap: 6, marginBottom: 4 }}>
                  <span style={{ color: T.textSecondary, fontSize: 11, flex: 1, wordBreak: "break-word", lineHeight: 1.4 }}>{label}</span>
                  <div style={{ width: barW, height: 6, borderRadius: 3, background: isPos ? "#E53E3E" : "#38A169", opacity: 0.8, flexShrink: 0 }} />
                  <span style={{ color: isPos ? "#E53E3E" : "#38A169", fontSize: 12, fontWeight: 700, minWidth: 52, textAlign: "right" }}>
                    {isPos ? "+" : ""}{s.contribution.toFixed(3)}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}

export interface WeekInfoPanelProps {
  activeData: WeekData | null;
  pinnedWeek: number | null;
  avgRiskAll: string;
  peakWeek: WeekData | null;
  totalHCP: number;
  avgNotes: string;
  mode: ViewMode;
  peakDeltaWeek?: WeekData | null;
  accentBorder?: string;
  label?: string;
}

export function WeekInfoPanel({
  activeData, pinnedWeek, avgRiskAll, peakWeek,
  totalHCP, avgNotes, mode, peakDeltaWeek, accentBorder, label,
}: WeekInfoPanelProps) {
  return (
    <div style={{
      height: "100%", background: T.bgCard,
      border: `1px solid ${accentBorder ?? T.border}`,
      borderRadius: 10, boxShadow: "0 1px 4px rgba(0,0,0,0.06)",
      padding: "18px 22px", overflowY: "auto", fontFamily: T.font,
    }}>
      {label && (
        <div style={{
          fontSize: 9, fontWeight: 700, letterSpacing: 1.5,
          color: accentBorder ?? T.textMuted, marginBottom: 10,
          textTransform: "uppercase",
        }}>{label}</div>
      )}
      {activeData
        ? <WeekPanel data={activeData} pinned={!!pinnedWeek} mode={mode} />
        : <EmptyPanel
            avgRiskAll={avgRiskAll} peakWeek={peakWeek} totalPatientHCP={totalHCP}
            avgNotes={avgNotes} mode={mode} peakDeltaWeek={peakDeltaWeek}
          />
      }
    </div>
  );
}