/**
 * RadialGlyph.tsx  — real data version
 *
 * Only change: imports from realData instead of mockData.
 * weeklyData, surgeonEvents, totalPatientHCP are now populated from
 * full_va_export_with_ego.json by initRealData().
 *
 * The center disc shows:
 *   - TOTAL HCP  (totalPatientHCP from temporal_networks node_counter)
 *   - NOTE FREQ  (avg notes/week from node_note timestamps)
 *   - ATTR SUMMARY  (avg risk %, peak week from weekly prob)
 *
 * Spike height  = careTeamSize (normalized)
 * Spike color   = risk color gradient from weekly prob
 * Orbit line    = connects spike tips, colored by risk
 * Yellow dots   = detected surgeon event weeks
 */

import { useState, useRef, useCallback } from "react";
import { weeklyData, surgeonEvents, totalPatientHCP } from "../realData";
import type { WeekData } from "../realData";
import { T } from "../theme";

const FONT = T.font;
const CX = 350;
const CY = 350;
const BASE_R = 130;
const CENTER_R = 88;
const HOLE_R = 30;
const SIZE = 700;

function polarToCart(cx: number, cy: number, r: number, angleDeg: number) {
  const rad = ((angleDeg - 90) * Math.PI) / 180;
  return { x: cx + r * Math.cos(rad), y: cy + r * Math.sin(rad) };
}

// Stats computed inside component so they update on patient switch

interface TooltipInfo {
  x: number;
  y: number;
  data: WeekData;
}

interface RadialProps {
  selectedWeek: number | null;
  onSelectWeek: (week: number | null) => void;
  onHoverWeek: (data: WeekData | null) => void;
}

export function RadialGlyph({ selectedWeek, onSelectWeek, onHoverWeek }: RadialProps) {
  const [hovered, setHovered] = useState<TooltipInfo | null>(null);
  const [hoveredIdx, setHoveredIdx] = useState<number | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);

  if (!weeklyData.length) return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100%", color: T.textFaint, fontFamily: FONT, fontSize: 12, letterSpacing: 2 }}>
      SELECT A PATIENT
    </div>
  );

  // Compute stats fresh each render (weeklyData mutates on patient switch)
  const totalNotes = weeklyData.reduce((s, d) => s + d.noteFrequency, 0);
  const avgNotes = weeklyData.length ? (totalNotes / weeklyData.length).toFixed(1) : "0";
  const avgRiskAll = weeklyData.length
    ? ((weeklyData.reduce((s, d) => s + d.riskScore, 0) / weeklyData.length) * 100).toFixed(1)
    : "0"; // raw avg prob across weeks
  const peakWeek = weeklyData.length
    ? weeklyData.reduce((max, d) => (d.riskScore > max.riskScore ? d : max), weeklyData[0])
    : null;

  const numWeeks = weeklyData.length;
  const anglePerWeek = 360 / Math.max(numWeeks, 1);

  // Spike HEIGHT = |Δprob| (week-over-week risk change magnitude)
  // Encodes EVOLUTION: tall spike = big change (up or down)
  // Color encodes DIRECTION: red = rising, green = falling, amber = stable
  const maxDelta = Math.max(...weeklyData.map(d => Math.abs(d.probDelta)), 0.001);
  const spikeHeights = weeklyData.map((d) => {
    const norm = Math.abs(d.probDelta) / maxDelta;
    return 10 + norm * 95; // min 10px stub, max 105px for largest swing
  });

  const teamSizes = weeklyData.map((d) => d.teamSize);
  const maxTeam = Math.max(...teamSizes, 1);
  const minTeam = Math.min(...teamSizes, 0);
  const teamRange = maxTeam - minTeam || 1;

  // Width scales with team size: narrow = small team, wide = large team
  const spikeWidths = weeklyData.map((d) => {
    const norm = (d.teamSize - minTeam) / teamRange;
    return anglePerWeek * (0.35 + norm * 0.55); // 35%-90% of slot
  });

  const spikePaths = weeklyData.map((d, i) => {
    const centerAngle = i * anglePerWeek;
    const h = spikeHeights[i];
    const innerR = BASE_R;
    const outerR = BASE_R + h;
    const sw = spikeWidths[i];
    const a1 = centerAngle - sw / 2;
    const a2 = centerAngle + sw / 2;

    const p1 = polarToCart(CX, CY, innerR, a1);
    const p2 = polarToCart(CX, CY, innerR, a2);
    const p3 = polarToCart(CX, CY, outerR, a2);
    const p4 = polarToCart(CX, CY, outerR, a1);

    const hitA1 = centerAngle - anglePerWeek / 2;
    const hitA2 = centerAngle + anglePerWeek / 2;
    const h1 = polarToCart(CX, CY, innerR - 4, hitA1);
    const h2 = polarToCart(CX, CY, innerR - 4, hitA2);
    const h3 = polarToCart(CX, CY, outerR + 6, hitA2);
    const h4 = polarToCart(CX, CY, outerR + 6, hitA1);

    return {
      d,
      i,
      path: `M${p1.x},${p1.y} L${p4.x},${p4.y} L${p3.x},${p3.y} L${p2.x},${p2.y} Z`,
      hitPath: `M${h1.x},${h1.y} L${h4.x},${h4.y} L${h3.x},${h3.y} L${h2.x},${h2.y} Z`,
      centerAngle,
      outerR,
    };
  });

  const orbitPoints = spikePaths.map((s) => {
    const pt = polarToCart(CX, CY, s.outerR, s.centerAngle);
    return { ...pt, color: s.d.spikeColor };
  });

  const orbitPath = orbitPoints
    .map((p, i) => (i === 0 ? `M${p.x},${p.y}` : `L${p.x},${p.y}`))
    .join(" ");

  // Center disc segments
  const segments = [
    { fill: "#EEF2FF", startAngle: -90, endAngle: 0 },
    { fill: "#F0FFF4", startAngle: 0, endAngle: 90 },
    { fill: "#FFFBEB", startAngle: 90, endAngle: 270 },
  ];

  // Week 0 and last week annotations
  const w0Start = polarToCart(CX, CY, BASE_R, 0);
  const w0End = polarToCart(CX, CY, BASE_R + 130, 0);
  const w0Label = polarToCart(CX, CY, BASE_R + 142, 0);

  const lastWeekAngle = (numWeeks - 1) * anglePerWeek;
  const wLastStart = polarToCart(CX, CY, BASE_R, lastWeekAngle);
  const wLastEnd = polarToCart(CX, CY, BASE_R + 130, lastWeekAngle);
  const wLastLabel = polarToCart(CX, CY, BASE_R + 144, lastWeekAngle);

  const handleSpikeHover = useCallback(
    (i: number, e: React.MouseEvent<SVGPathElement>) => {
      if (!svgRef.current) return;
      const rect = svgRef.current.getBoundingClientRect();
      const scaleX = rect.width / SIZE;
      const scaleY = rect.height / SIZE;
      const tipPt = polarToCart(
        CX,
        CY,
        spikePaths[i].outerR + 12,
        spikePaths[i].centerAngle
      );
      setHovered({
        x: tipPt.x * scaleX + rect.left,
        y: tipPt.y * scaleY + rect.top,
        data: weeklyData[i],
      });
      setHoveredIdx(i);
      onHoverWeek(weeklyData[i]);
    },
    [spikePaths]
  );

  const handleSpikeLeave = useCallback(() => {
    setHovered(null);
    setHoveredIdx(null);
    onHoverWeek(null);
  }, [onHoverWeek]);

  return (
    <div style={{
      height: "100%",
      position: "relative",
      background: T.bgCard,
      border: `1px solid ${T.border}`,
      borderRadius: 10,
      boxShadow: "0 1px 4px rgba(0,0,0,0.06)",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
    }}>
      <div style={{ width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center" }}>
      <svg
        ref={svgRef}
        viewBox={`0 0 ${SIZE} ${SIZE}`}
        style={{ width: "100%", height: "100%", maxWidth: "100%", maxHeight: "100%" }}
      >
        <defs>
          {spikePaths.map((s, i) => (
            <radialGradient
              key={`sg${i}`}
              id={`spikeGrad${i}`}
              cx="50%"
              cy="50%"
              r="50%"
            >
              <stop offset="0%" stopColor={s.d.spikeColor} stopOpacity={0.38} />
              <stop offset="100%" stopColor={s.d.spikeColor} stopOpacity={1} />
            </radialGradient>
          ))}
          <filter id="orbitGlow" x="-20%" y="-20%" width="140%" height="140%">
            <feGaussianBlur in="SourceGraphic" stdDeviation="3" />
          </filter>
          <filter id="hoverGlow" x="-50%" y="-50%" width="200%" height="200%">
            <feGaussianBlur in="SourceGraphic" stdDeviation="4" />
          </filter>
        </defs>

        {/* Center disc */}
        {segments.map((seg, si) => {
          const sweep = seg.endAngle - seg.startAngle;
          const largeArc = sweep > 180 ? 1 : 0;
          const p1 = polarToCart(CX, CY, CENTER_R, seg.startAngle);
          const p2 = polarToCart(CX, CY, CENTER_R, seg.endAngle);
          return (
            <path
              key={si}
              d={`M${CX},${CY} L${p1.x},${p1.y} A${CENTER_R},${CENTER_R} 0 ${largeArc} 1 ${p2.x},${p2.y} Z`}
              fill={seg.fill}
            />
          );
        })}

        {/* Divider lines */}
        {[-90, 0, 90, 270].map((a) => {
          const p = polarToCart(CX, CY, CENTER_R, a);
          return (
            <line
              key={a}
              x1={CX}
              y1={CY}
              x2={p.x}
              y2={p.y}
              stroke={T.border}
              strokeWidth={1}
            />
          );
        })}

        {/* TOTAL HCP label */}
        {(() => {
          const lp = polarToCart(CX, CY, CENTER_R * 0.45, -45);
          const vp = polarToCart(CX, CY, CENTER_R * 0.62, -45);
          return (
            <g>
              <text x={lp.x} y={lp.y - 3} textAnchor="middle" dominantBaseline="central" fill={T.textMuted} fontSize={9} fontFamily={FONT}>TOTAL HCP</text>
              <text x={vp.x} y={vp.y + 3} textAnchor="middle" dominantBaseline="central" fill="#2B6CB0" fontSize={16} fontFamily={FONT} fontWeight={700}>{totalPatientHCP}</text>
            </g>
          );
        })()}

        {/* NOTE FREQ label */}
        {(() => {
          const lp = polarToCart(CX, CY, CENTER_R * 0.45, 45);
          const vp = polarToCart(CX, CY, CENTER_R * 0.62, 45);
          return (
            <g>
              <text x={lp.x} y={lp.y - 3} textAnchor="middle" dominantBaseline="central" fill={T.textMuted} fontSize={9} fontFamily={FONT}>NOTE FREQ</text>
              <text x={vp.x} y={vp.y + 3} textAnchor="middle" dominantBaseline="central" fill="#38A169" fontSize={13} fontFamily={FONT} fontWeight={700}>{avgNotes}/wk</text>
            </g>
          );
        })()}

        {/* ATTR SUMMARY label */}
        {(() => {
          const lp = polarToCart(CX, CY, CENTER_R * 0.32, 180);
          return (
            <g>
              <text x={lp.x} y={lp.y - 12} textAnchor="middle" dominantBaseline="central" fill={T.textMuted} fontSize={9} fontFamily={FONT}>ATTR SUMMARY</text>
              <text x={lp.x} y={lp.y + 1} textAnchor="middle" dominantBaseline="central" fill="#D69E2E" fontSize={11} fontFamily={FONT}>Avg Prob {avgRiskAll}%</text>
              {peakWeek && (
                <text x={lp.x} y={lp.y + 12} textAnchor="middle" dominantBaseline="central" fill={T.textSecondary} fontSize={9} fontFamily={FONT}>
                  Peak w{peakWeek.week} @ {(peakWeek.riskScore * 100).toFixed(0)}%
                </text>
              )}
            </g>
          );
        })()}

        {/* Center hole */}
        <circle cx={CX} cy={CY} r={HOLE_R} fill={T.bgCard} />

        {/* Base ring */}
        <circle cx={CX} cy={CY} r={BASE_R} fill="none" stroke={T.borderMid} strokeWidth={1.5} />

        {/* Spikes */}
        {spikePaths.map((s, i) => {
          const isHovered = hoveredIdx === i;
          const isWeekSelected = selectedWeek !== null && weeklyData[i]?.week === selectedWeek;
          return (
            <g key={i}>
              {(isHovered || isWeekSelected) && (
                <path d={s.path} fill={s.d.spikeColor} opacity={isWeekSelected ? 0.5 : 0.35} filter="url(#hoverGlow)" />
              )}
              <path
                d={s.path}
                fill={`url(#spikeGrad${i})`}
                stroke={s.d.spikeColor}
                strokeWidth={isHovered || isWeekSelected ? 1.5 : 0.4}
                strokeOpacity={isHovered || isWeekSelected ? 1 : 0.4}
                opacity={selectedWeek !== null && !isWeekSelected ? 0.35 : 1}
              />
            </g>
          );
        })}

        {/* Hit areas */}
        {spikePaths.map((s, i) => (
          <path
            key={`hit${i}`}
            d={s.hitPath}
            fill="transparent"
            stroke="none"
            style={{ cursor: "pointer" }}
            onMouseEnter={(e) => handleSpikeHover(i, e)}
            onMouseMove={(e) => handleSpikeHover(i, e)}
            onMouseLeave={handleSpikeLeave}
            onClick={() => {
              const w = weeklyData[i];
              if (!w) return;
              const isAlreadyPinned = selectedWeek === w.week;
              onSelectWeek(isAlreadyPinned ? null : w.week);
            }}
          />
        ))}

        {/* Orbit glow */}
        <path d={orbitPath} fill="none" stroke="#E53E3E" strokeWidth={6} opacity={0.12} filter="url(#orbitGlow)" />

        {/* Orbit colored segments */}
        {orbitPoints.map((p, i) => {
          if (i === 0) return null;
          const prev = orbitPoints[i - 1];
          return (
            <line key={i} x1={prev.x} y1={prev.y} x2={p.x} y2={p.y} stroke={p.color} strokeWidth={2} strokeLinecap="round" />
          );
        })}

        {/* Shimmer */}
        <path d={orbitPath} fill="none" stroke="rgba(0,0,0,0.06)" strokeWidth={0.8} />

        {/* Hover orbit highlight */}
        {hoveredIdx !== null && hoveredIdx > 0 && (
          <line
            x1={orbitPoints[hoveredIdx - 1].x}
            y1={orbitPoints[hoveredIdx - 1].y}
            x2={orbitPoints[hoveredIdx].x}
            y2={orbitPoints[hoveredIdx].y}
            stroke={T.textPrimary}
            strokeWidth={2}
            strokeLinecap="round"
            opacity={0.5}
          />
        )}

        {/* Hover radial line */}
        {hoveredIdx !== null &&
          (() => {
            const angle = spikePaths[hoveredIdx].centerAngle;
            const inner = polarToCart(CX, CY, BASE_R - 5, angle);
            const outer = polarToCart(CX, CY, spikePaths[hoveredIdx].outerR + 14, angle);
            return (
              <line x1={inner.x} y1={inner.y} x2={outer.x} y2={outer.y} stroke="rgba(0,0,0,0.2)" strokeWidth={0.8} strokeDasharray="3,3" />
            );
          })()}

        {/* Week 0 annotation */}
        <line x1={w0Start.x} y1={w0Start.y} x2={w0End.x} y2={w0End.y} stroke={T.textMuted} strokeWidth={1} strokeDasharray="4,4" />
        <text x={w0Label.x} y={w0Label.y} textAnchor="middle" fill={T.textSecondary} fontSize={10} fontFamily={FONT}>week 0</text>

        {/* Last week annotation */}
        <line x1={wLastStart.x} y1={wLastStart.y} x2={wLastEnd.x} y2={wLastEnd.y} stroke={T.textFaint} strokeWidth={1} strokeDasharray="4,4" />
        <text x={wLastLabel.x} y={wLastLabel.y} textAnchor="middle" fill={T.textMuted} fontSize={10} fontFamily={FONT} dominantBaseline="central">
          last week (w{numWeeks - 1})
        </text>

        {/* Surgeon event markers */}
        {surgeonEvents.map((weekNum) => {
          const idx = weeklyData.findIndex((w) => w.week === weekNum);
          if (idx < 0) return null;
          const angle = idx * anglePerWeek;
          const outer = polarToCart(CX, CY, BASE_R + spikeHeights[idx] + 10, angle);
          return <circle key={weekNum} cx={outer.x} cy={outer.y} r={3} fill="#FFD166" opacity={0.85} />;
        })}
      </svg>
      </div>


    </div>
  );
}

// ── Empty state panel (no week hovered) ──────────────────────────────────────
export function EmptyPanel({ avgRiskAll, peakWeek, totalPatientHCP, avgNotes }: {
  avgRiskAll: string; peakWeek: any; totalPatientHCP: number; avgNotes: string;
}) {
  return (
    <div style={{ fontFamily: FONT }}>
      <div style={{ color: T.textFaint, fontSize: 11, letterSpacing: 1.5, marginBottom: 8 }}>
        HOVER A SPIKE TO INSPECT
      </div>
      <div style={{ color: T.textMuted, fontSize: 9, marginBottom: 8 }}>Spike height = |Δrisk|&nbsp;&nbsp;·&nbsp;&nbsp;Red = rising&nbsp;&nbsp;·&nbsp;&nbsp;Green = falling&nbsp;&nbsp;·&nbsp;&nbsp;Amber = stable</div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "6px 16px" }}>
        <Stat label="AVG RISK" value={`${avgRiskAll}%`} color="#D69E2E" />
        <Stat label="TOTAL HCP" value={String(totalPatientHCP)} color="#2B6CB0" />
        <Stat label="NOTES / WK" value={avgNotes} color="#38A169" />
        {peakWeek && <Stat label="PEAK WEEK" value={`W${peakWeek.week} · ${(peakWeek.riskScore*100).toFixed(0)}%`} color="#E53E3E" />}
      </div>
    </div>
  );
}

// ── Week detail panel (shown in the space below glyph) ───────────────────────
export function WeekPanel({ data, pinned }: { data: WeekData; pinned?: boolean }) {
  const isSurgeonWeek = surgeonEvents.includes(data.week);
  return (
    <div style={{ fontFamily: FONT }}>
      {/* Header row */}
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 8 }}>
        <span style={{ color: T.textPrimary, fontSize: 14, fontWeight: 700 }}>WEEK {data.week}</span>
        {isSurgeonWeek && (
          <span style={{ color: "#D69E2E", fontSize: 9, background: "#FFFBEB", padding: "2px 8px", borderRadius: 4, border: "1px solid #D69E2E44" }}>
            ✦ SURGEON EVENT
          </span>
        )}
        <span style={{ color: T.textFaint, fontSize: 9, marginLeft: "auto" }}>
          {pinned
            ? <span style={{ color:"#2B6CB0", background:"#EEF2FF", padding:"2px 8px", borderRadius:4, border:"1px solid #2B6CB044", fontSize:9 }}>📌 PINNED — click again to unpin</span>
            : "hover or click spike to inspect"
          }
        </span>
      </div>

      {/* Stats grid */}
     <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "4px 12px", marginBottom: 8 }}>
        <Stat label="GNN SCORE" value={`${(data.riskScore * 100).toFixed(1)}%`} color={data.spikeColor} />
        <Stat label="TEAM SIZE" value={String(data.teamSize ?? "—")} color="#6B9FFF" />
        <Stat label="ENTROPY" value={data.entropy?.toFixed(2) ?? "—"} color="#A78BFA" />
      </div>

      {/* Two columns: specialties + SHAP */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
        {/* Specialties */}
        <div>
          <div style={{ color: T.textSecondary, fontSize: 10, fontWeight: 700, marginBottom: 4, letterSpacing: 1 }}>ACTIVE SPECIALTIES</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
            {(data.hcpNames?.filter(n => n && n !== "nan" && n !== "null") ?? []).slice(0, 10).map((name, ni) => (
              <span key={ni} style={{ color: T.textSecondary, fontSize: 10, lineHeight: 1.6 }}>· {name}</span>
            ))}
          </div>
        </div>

        {/* SHAP features */}
       <div>
          <div style={{ color: T.textSecondary, fontSize: 10, fontWeight: 700, marginBottom: 2, letterSpacing: 1 }}>
            TOP ATTRIBUTES ({data.topSHAP?.length ?? 0})
          </div>
          <div style={{ color: T.textMuted, fontSize: 8, marginBottom: 4 }}>
            red = raises survival score · green = lowers
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
            {(data.topSHAP ?? []).slice(0, 10).map((s, si) => {
              const isPos = s.contribution >= 0;
              // Parse feature name: "FIELD::VALUE::type" → readable label
              const parts = s.feature.split("::");
              const field = (parts[0] ?? "").replace(/_/g, " ").replace("ACCESS USER ", "").toLowerCase();
              const value = (parts[1] ?? "").replace(/^\*/, "").toLowerCase();
              const label = `${field}: ${value}`.slice(0, 28);
              const barW = Math.min(60, Math.abs(s.contribution) * 30);
              return (
                <div key={si} style={{ display: "flex", alignItems: "center", gap: 4 }}>
                  <span style={{
                    color: T.textSecondary, fontSize: 10, flex: 1,
                    overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap"
                  }}>
                    {label}
                  </span>
                  <div style={{
                    width: barW, height: 3, borderRadius: 2,
                    background: isPos ? '#E53E3E' : '#38A169',
                    opacity: 0.8, flexShrink: 0
                  }}/>
                  <span style={{
                    color: isPos ? '#E53E3E' : '#38A169',
                    fontSize: 10, fontWeight: 700, minWidth: 42, textAlign: "right"
                  }}>
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

function Row({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
      <span style={{ color: "#64748B", fontSize: 9 }}>{label}</span>
      <span style={{ color, fontSize: 10, fontWeight: 700 }}>{value}</span>
    </div>
  );
}

export function Stat({ label, value, color, small }: { label: string; value: string; color: string; small?: boolean }) {
  return (
    <div>
      <div style={{ color: T.textMuted, fontSize: 9, letterSpacing: 1, marginBottom: 2 }}>{label}</div>
      <div style={{ color, fontSize: small ? 10 : 13, fontWeight: 700, fontFamily: FONT }}>{value}</div>
    </div>
  );
}

// ── Exported side panel for App layout ───────────────────────────────────────
export interface WeekInfoPanelProps {
  activeData: WeekData | null;
  pinnedWeek: number | null;
  avgRiskAll: string;
  peakWeek: WeekData | null;
  totalHCP: number;
  avgNotes: string;
}

export function WeekInfoPanel({ activeData, pinnedWeek, avgRiskAll, peakWeek, totalHCP, avgNotes }: WeekInfoPanelProps) {
  return (
    <div style={{
      height: "100%",
      background: T.bgCard,
      border: `1px solid ${T.border}`,
      borderRadius: 10,
      boxShadow: "0 1px 4px rgba(0,0,0,0.06)",
      padding: "14px 16px",
      overflowY: "auto",
      fontFamily: FONT,
    }}>
      {activeData
        ? <WeekPanel data={activeData} pinned={!!pinnedWeek} />
        : <EmptyPanel avgRiskAll={avgRiskAll} peakWeek={peakWeek} totalPatientHCP={totalHCP} avgNotes={avgNotes} />
      }
    </div>
  );
}