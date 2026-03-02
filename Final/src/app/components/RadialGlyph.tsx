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
import {
  weeklyData,
  surgeonEvents,
  totalPatientHCP,
} from "../realData";
import type { WeekData } from "../realData";

const FONT = "'Space Mono', monospace";
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

export function RadialGlyph() {
  const [hovered, setHovered] = useState<TooltipInfo | null>(null);
  const [hoveredIdx, setHoveredIdx] = useState<number | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);

  if (!weeklyData.length) return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100%", color: "#2A3040", fontFamily: FONT, fontSize: 12, letterSpacing: 2 }}>
      SELECT A PATIENT
    </div>
  );

  // Compute stats fresh each render (weeklyData mutates on patient switch)
  const totalNotes = weeklyData.reduce((s, d) => s + d.noteFrequency, 0);
  const avgNotes = weeklyData.length ? (totalNotes / weeklyData.length).toFixed(1) : "0";
  const avgRiskAll = weeklyData.length
    ? ((weeklyData.reduce((s, d) => s + d.riskScore, 0) / weeklyData.length) * 100).toFixed(1)
    : "0";
  const peakWeek = weeklyData.length
    ? weeklyData.reduce((max, d) => (d.riskScore > max.riskScore ? d : max), weeklyData[0])
    : null;

  const numWeeks = weeklyData.length;
  const anglePerWeek = 360 / Math.max(numWeeks, 1);

  // Spike HEIGHT = risk score (already normalized 0-1 per patient)
  // Spike WIDTH = care team size (normalized)
  const spikeHeights = weeklyData.map((d) => {
    return 14 + d.riskScore * 90; // min 14px, max 104px
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
    { fill: "#1A2535", startAngle: -90, endAngle: 0 },
    { fill: "#1E2D20", startAngle: 0, endAngle: 90 },
    { fill: "#1E1E2D", startAngle: 90, endAngle: 270 },
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
    },
    [spikePaths]
  );

  const handleSpikeLeave = useCallback(() => {
    setHovered(null);
    setHoveredIdx(null);
  }, []);

  return (
    <div
      style={{
        position: "relative",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        height: "100%",
      }}
    >
      <svg
        ref={svgRef}
        viewBox={`0 0 ${SIZE} ${SIZE}`}
        style={{ width: "100%", maxWidth: 560, height: "100%", maxHeight: 560 }}
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
              stroke="#252A35"
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
              <text x={lp.x} y={lp.y - 3} textAnchor="middle" dominantBaseline="central" fill="#64748B" fontSize={6} fontFamily={FONT}>TOTAL HCP</text>
              <text x={vp.x} y={vp.y + 3} textAnchor="middle" dominantBaseline="central" fill="#6B9FFF" fontSize={14} fontFamily={FONT} fontWeight={700}>{totalPatientHCP}</text>
            </g>
          );
        })()}

        {/* NOTE FREQ label */}
        {(() => {
          const lp = polarToCart(CX, CY, CENTER_R * 0.45, 45);
          const vp = polarToCart(CX, CY, CENTER_R * 0.62, 45);
          return (
            <g>
              <text x={lp.x} y={lp.y - 3} textAnchor="middle" dominantBaseline="central" fill="#64748B" fontSize={6} fontFamily={FONT}>NOTE FREQ</text>
              <text x={vp.x} y={vp.y + 3} textAnchor="middle" dominantBaseline="central" fill="#4FFFB0" fontSize={11} fontFamily={FONT} fontWeight={700}>{avgNotes}/wk</text>
            </g>
          );
        })()}

        {/* ATTR SUMMARY label */}
        {(() => {
          const lp = polarToCart(CX, CY, CENTER_R * 0.32, 180);
          return (
            <g>
              <text x={lp.x} y={lp.y - 12} textAnchor="middle" dominantBaseline="central" fill="#64748B" fontSize={6} fontFamily={FONT}>ATTR SUMMARY</text>
              <text x={lp.x} y={lp.y + 1} textAnchor="middle" dominantBaseline="central" fill="#FFD166" fontSize={8} fontFamily={FONT}>Avg Risk {avgRiskAll}%</text>
              {peakWeek && (
                <text x={lp.x} y={lp.y + 12} textAnchor="middle" dominantBaseline="central" fill="#94A3B8" fontSize={6} fontFamily={FONT}>
                  Peak w{peakWeek.week} @ {(peakWeek.riskScore * 100).toFixed(0)}%
                </text>
              )}
            </g>
          );
        })()}

        {/* Center hole */}
        <circle cx={CX} cy={CY} r={HOLE_R} fill="#0D0F14" />

        {/* Base ring */}
        <circle cx={CX} cy={CY} r={BASE_R} fill="none" stroke="#2A3040" strokeWidth={1.5} />

        {/* Spikes */}
        {spikePaths.map((s, i) => {
          const isHovered = hoveredIdx === i;
          return (
            <g key={i}>
              {isHovered && (
                <path d={s.path} fill={s.d.spikeColor} opacity={0.35} filter="url(#hoverGlow)" />
              )}
              <path
                d={s.path}
                fill={`url(#spikeGrad${i})`}
                stroke={s.d.spikeColor}
                strokeWidth={isHovered ? 1 : 0.4}
                strokeOpacity={isHovered ? 0.9 : 0.4}
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
          />
        ))}

        {/* Orbit glow */}
        <path d={orbitPath} fill="none" stroke="#FF6B6B" strokeWidth={6} opacity={0.2} filter="url(#orbitGlow)" />

        {/* Orbit colored segments */}
        {orbitPoints.map((p, i) => {
          if (i === 0) return null;
          const prev = orbitPoints[i - 1];
          return (
            <line key={i} x1={prev.x} y1={prev.y} x2={p.x} y2={p.y} stroke={p.color} strokeWidth={2} strokeLinecap="round" />
          );
        })}

        {/* Shimmer */}
        <path d={orbitPath} fill="none" stroke="rgba(255,255,255,0.15)" strokeWidth={0.8} />

        {/* Hover orbit highlight */}
        {hoveredIdx !== null && hoveredIdx > 0 && (
          <line
            x1={orbitPoints[hoveredIdx - 1].x}
            y1={orbitPoints[hoveredIdx - 1].y}
            x2={orbitPoints[hoveredIdx].x}
            y2={orbitPoints[hoveredIdx].y}
            stroke="#fff"
            strokeWidth={3}
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
              <line x1={inner.x} y1={inner.y} x2={outer.x} y2={outer.y} stroke="rgba(255,255,255,0.3)" strokeWidth={0.8} strokeDasharray="3,3" />
            );
          })()}

        {/* Week 0 annotation */}
        <line x1={w0Start.x} y1={w0Start.y} x2={w0End.x} y2={w0End.y} stroke="#94A3B8" strokeWidth={1} strokeDasharray="4,4" />
        <text x={w0Label.x} y={w0Label.y} textAnchor="middle" fill="#94A3B8" fontSize={8} fontFamily={FONT}>week 0</text>

        {/* Last week annotation */}
        <line x1={wLastStart.x} y1={wLastStart.y} x2={wLastEnd.x} y2={wLastEnd.y} stroke="#64748B" strokeWidth={1} strokeDasharray="4,4" />
        <text x={wLastLabel.x} y={wLastLabel.y} textAnchor="middle" fill="#64748B" fontSize={7} fontFamily={FONT} dominantBaseline="central">
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

      {hovered && <WeekTooltip data={hovered.data} x={hovered.x} y={hovered.y} />}
    </div>
  );
}

function WeekTooltip({ data, x, y }: { data: WeekData; x: number; y: number }) {
  const isSurgeonWeek = surgeonEvents.includes(data.week);
  return (
    <div
      style={{
        position: "fixed",
        left: x + 14,
        top: y - 10,
        background: "#151820",
        border: "1px solid #252A35",
        borderRadius: 8,
        padding: "10px 14px",
        fontFamily: FONT,
        pointerEvents: "none",
        zIndex: 100,
        minWidth: 240,
        maxWidth: 320,
        boxShadow: "0 8px 32px rgba(0,0,0,0.6)",
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
        <span style={{ color: "#fff", fontSize: 11, fontWeight: 700 }}>WEEK {data.week}</span>
        {isSurgeonWeek && (
          <span style={{ color: "#FFD166", fontSize: 8, background: "rgba(255,209,102,0.12)", padding: "2px 6px", borderRadius: 4 }}>
            SURGEON EVENT
          </span>
        )}
      </div>

      <Row label="RISK SCORE (RAW)" value={`${((data.rawProb ?? data.riskScore) * 100).toFixed(1)}%`} color={data.spikeColor} />
      <Row label="RISK (NORMALIZED)" value={`${(data.riskScore * 100).toFixed(1)}%`} color="#94A3B8" />
      <Row label="CARE TEAM SIZE" value={String(data.teamSize)} color="#6B9FFF" />
      <Row label="NOTES THIS WEEK" value={String(data.noteFrequency)} color="#4FFFB0" />
      <Row label="ENTROPY" value={data.entropy?.toFixed(3) ?? "—"} color="#94A3B8" />

      {data.hcpNames.length > 0 && (
        <div style={{ borderTop: "1px solid #252A35", paddingTop: 5, marginTop: 3, marginBottom: 5 }}>
          <div style={{ color: "#64748B", fontSize: 8, marginBottom: 3 }}>ACTIVE SPECIALTIES</div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: "2px 8px" }}>
            {data.hcpNames.slice(0, 8).map((name, ni) => (
              <span key={ni} style={{ color: "#94A3B8", fontSize: 7.5 }}>{name}</span>
            ))}
          </div>
        </div>
      )}

      <div style={{ borderTop: "1px solid #252A35", paddingTop: 5, marginTop: 3 }}>
        <div style={{ color: "#64748B", fontSize: 8, marginBottom: 2 }}>TOP DRIVERS</div>
        <div style={{ color: "#CBD5E1", fontSize: 8, lineHeight: 1.5 }}>{data.attributeSummary}</div>
      </div>

      {data.topSHAP?.length > 0 && (
        <div style={{ marginTop: 5 }}>
          {data.topSHAP.slice(0, 5).map((s, si) => {
            const pct = (s.contribution * 100).toFixed(1);
            const isPos = s.contribution >= 0;
            const label = s.feature.split("::")[1]?.replace(/^\*/, "").slice(0, 24) ?? s.feature.slice(0, 24);
            return (
              <div key={si} style={{ display: "flex", justifyContent: "space-between", marginBottom: 2 }}>
                <span style={{ color: "#475569", fontSize: 7, maxWidth: 170, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{label}</span>
                <span style={{ color: isPos ? "#FF6B6B" : "#4FFFB0", fontSize: 7, fontWeight: 700 }}>
                  {isPos ? "+" : ""}{pct}%
                </span>
              </div>
            );
          })}
        </div>
      )}
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