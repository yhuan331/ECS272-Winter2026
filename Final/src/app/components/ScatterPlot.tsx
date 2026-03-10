import { useState, useMemo, useRef, useCallback } from "react";
import { patients, type PatientDot } from "../realData";
import { T, CANCER_COLORS } from "../theme";

const FONT = T.font;

interface Props {
  selectedId: string;
  compareId?: string;
  onSelectPatient: (id: string) => void;
  onComparePatient?: (id: string) => void;
  compareMode?: boolean;
}

interface Viewport { x0: number; y0: number; x1: number; y1: number; }
const DEFAULT_VP: Viewport = { x0: 0, y0: 0, x1: 1, y1: 1 };
const MIN_SPAN = 0.05;

export function ScatterPlot({
  selectedId,
  compareId,
  onSelectPatient,
  onComparePatient,
  compareMode = false,
}: Props) {
  const [hoverId,       setHoverId]       = useState<string | null>(null);
  const [activeFilters, setActiveFilters] = useState(new Set(["breast", "colon", "lung"]));
  const [vp,            setVp]            = useState<Viewport>(DEFAULT_VP);
  const [dragging,      setDragging]      = useState(false);
  const dragStart = useRef<{ mx: number; my: number; vp: Viewport } | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);

  // Extra top/bottom margin so edge dots are never clipped
  const pad   = { top: 52, right: 24, bottom: 52, left: 52 };
  const W     = 560, H = 500;
  const plotW = W - pad.left - pad.right;
  const plotH = H - pad.top  - pad.bottom;

  const maxTeam  = Math.max(...patients.map(p => p.maxTeam), 1);
  const selected = patients.find(p => p.id === selectedId) ?? patients[0];

  const dotRadius = (p: PatientDot, isSel: boolean, isCmp: boolean) => {
    if (isSel || isCmp) return 7;
    return 3 + (p.maxTeam / maxTeam) * 5;
  };

  const toggle = (c: string) => setActiveFilters(prev => {
    const n = new Set(prev);
    if (n.has(c)) { if (n.size > 1) n.delete(c); } else n.add(c);
    return n;
  });

  const visible   = patients.filter(p => activeFilters.has(p.cancer));
  const vpW       = vp.x1 - vp.x0;
  const vpH       = vp.y1 - vp.y0;
  const zoomLevel = (1 / Math.max(vpW, vpH)).toFixed(1);
  const isZoomed  = vpW < 0.99 || vpH < 0.99;

  const toSVG = (p: PatientDot) => ({
    cx: pad.left + ((p.x - vp.x0) / vpW) * plotW,
    cy: pad.top  + (1 - (p.y - vp.y0) / vpH) * plotH,
  });

  const svgToData = useCallback((svgX: number, svgY: number) => ({
    dx: vp.x0 + ((svgX - pad.left) / plotW) * vpW,
    dy: vp.y0 + (1 - (svgY - pad.top) / plotH) * vpH,
  }), [vp, vpW, vpH, plotW, plotH]);

  const getSVGPoint = (e: React.MouseEvent) => {
    const rect = svgRef.current!.getBoundingClientRect();
    return {
      svgX: ((e.clientX - rect.left) / rect.width)  * W,
      svgY: ((e.clientY - rect.top)  / rect.height) * H,
    };
  };

  const handleWheel = useCallback((e: React.WheelEvent) => {
    e.preventDefault();
    const { svgX, svgY } = getSVGPoint(e);
    const { dx, dy } = svgToData(svgX, svgY);
    const factor = e.deltaY > 0 ? 1.15 : 0.87;
    setVp(prev => {
      const newW  = Math.min(1, Math.max(MIN_SPAN, (prev.x1 - prev.x0) * factor));
      const newH  = Math.min(1, Math.max(MIN_SPAN, (prev.y1 - prev.y0) * factor));
      const fracX = (dx - prev.x0) / (prev.x1 - prev.x0);
      const fracY = (dy - prev.y0) / (prev.y1 - prev.y0);
      let x0 = dx - fracX * newW;
      let y0 = dy - fracY * newH;
      x0 = Math.max(0, Math.min(1 - newW, x0));
      y0 = Math.max(0, Math.min(1 - newH, y0));
      return { x0, y0, x1: x0 + newW, y1: y0 + newH };
    });
  }, [svgToData]);

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    if ((e.target as SVGElement).closest("[data-dot]")) return;
    const { svgX, svgY } = getSVGPoint(e);
    dragStart.current = { mx: svgX, my: svgY, vp: { ...vp } };
    setDragging(true);
  }, [vp]);

  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    if (!dragStart.current) return;
    const { svgX, svgY } = getSVGPoint(e);
    const dx = ((dragStart.current.mx - svgX) / plotW) * vpW;
    const dy = ((svgY - dragStart.current.my) / plotH) * vpH;
    const base = dragStart.current.vp;
    let x0 = base.x0 + dx;
    let y0 = base.y0 + dy;
    x0 = Math.max(0, Math.min(1 - vpW, x0));
    y0 = Math.max(0, Math.min(1 - vpH, y0));
    setVp({ x0, y0, x1: x0 + vpW, y1: y0 + vpH });
  }, [vpW, vpH, plotW, plotH]);

  const handleMouseUp = useCallback(() => {
    dragStart.current = null;
    setDragging(false);
  }, []);

  const xTicks = [0, 0.25, 0.5, 0.75, 1].map(f => ({
    svgX:  pad.left + f * plotW,
    label: ((vp.x0 + f * vpW) * 100).toFixed(0) + "%",
  }));
  const yTicks = [0, 0.25, 0.5, 0.75, 1].map(f => ({
    svgY:  pad.top + (1 - f) * plotH,
    label: ((vp.y0 + f * vpH) * 100).toFixed(1) + "%",
  }));

  const medX = pad.left + plotW * 0.5;
  const medY = pad.top  + plotH * 0.5;

  const MM = { x: W - pad.right - 62, y: pad.top + 2, w: 58, h: 52 };
  const thumbX = MM.x + vp.x0 * MM.w;
  const thumbY = MM.y + (1 - vp.y1) * MM.h;
  const thumbW = vpW * MM.w;
  const thumbH = vpH * MM.h;

  // Sort: render selected/compare on top
  const sortedVisible = useMemo(() => {
    const rest = visible.filter(p => p.id !== selectedId && p.id !== compareId);
    const sel  = visible.filter(p => p.id === selectedId);
    const cmp  = visible.filter(p => p.id === compareId);
    return [...rest, ...sel, ...cmp];
  }, [visible, selectedId, compareId]);

  return (
    <div style={{
      background: T.bgCard, border: `1px solid ${T.border}`, borderRadius: 10,
      padding: 14, height: "100%", display: "flex", flexDirection: "column",
      fontFamily: FONT, boxShadow: "0 1px 4px rgba(0,0,0,0.06)",
    }}>
      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
        <div style={{ color: T.textMuted, fontSize: 10, letterSpacing: 1.5, fontWeight: 700 }}>
          PATIENT COHORT OVERVIEW
        </div>
        {isZoomed && (
          <span style={{
            fontSize: 8, color: "#2B6CB0", background: "#EEF2FF",
            padding: "2px 6px", borderRadius: 3, border: "1px solid #2B6CB044",
          }}>🔍 {zoomLevel}×</span>
        )}
        {isZoomed && (
          <button onClick={() => setVp(DEFAULT_VP)} style={{
            marginLeft: "auto", fontSize: 8, fontFamily: FONT, cursor: "pointer",
            background: "transparent", border: `1px solid ${T.border}`,
            borderRadius: 3, padding: "2px 7px", color: T.textMuted,
          }}>RESET VIEW</button>
        )}
      </div>

      {/* Compare mode banner */}
      {compareMode && (
        <div style={{
          background: "#EEF2FF", border: "1px solid #2B6CB044", borderRadius: 5,
          padding: "4px 10px", marginBottom: 6, fontSize: 9, color: "#2B6CB0",
          fontFamily: FONT, letterSpacing: 1,
        }}>
          ✦ COMPARE MODE — click any dot to set compare patient
        </div>
      )}

      {/* Toggles */}
      <div style={{ display: "flex", gap: 6, marginBottom: 8, alignItems: "center" }}>
        {(["breast", "colon", "lung"] as const).map(c => {
          const active = activeFilters.has(c);
          const color  = CANCER_COLORS[c];
          return (
            <button key={c} onClick={() => toggle(c)} style={{
              background: active ? color + "18" : "transparent",
              border: `1px solid ${active ? color : T.border}`,
              borderRadius: 4, padding: "3px 10px",
              color: active ? color : T.textMuted,
              fontSize: 9, fontFamily: FONT, cursor: "pointer",
              textTransform: "uppercase", letterSpacing: 1, fontWeight: 700,
              transition: "all 0.15s",
            }}>{c}</button>
          );
        })}
        <span style={{ color: T.textFaint, fontSize: 8, marginLeft: 4 }}>
          scroll to zoom · drag to pan
        </span>
      </div>

      {/* SVG */}
      <svg
        ref={svgRef}
        viewBox={`0 0 ${W} ${H}`}
        style={{ flex: 1, width: "100%", cursor: dragging ? "grabbing" : "grab" }}
        onWheel={handleWheel}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
      >
        <defs>
          <clipPath id="plotClip">
            <rect x={pad.left} y={pad.top} width={plotW} height={plotH} />
          </clipPath>
        </defs>

        {/* Grid */}
        {[0.25, 0.5, 0.75].map(f => (
          <g key={f}>
            <line x1={pad.left} y1={pad.top + plotH * (1 - f)} x2={pad.left + plotW} y2={pad.top + plotH * (1 - f)}
              stroke={T.border} strokeWidth={1} />
            <line x1={pad.left + plotW * f} y1={pad.top} x2={pad.left + plotW * f} y2={pad.top + plotH}
              stroke={T.border} strokeWidth={1} />
          </g>
        ))}

        {/* Quadrant dividers */}
        <line x1={medX} y1={pad.top} x2={medX} y2={pad.top + plotH}
          stroke={T.borderMid} strokeWidth={1.2} strokeDasharray="5,4" opacity={0.6} />
        <line x1={pad.left} y1={medY} x2={pad.left + plotW} y2={medY}
          stroke={T.borderMid} strokeWidth={1.2} strokeDasharray="5,4" opacity={0.6} />

        {/* Quadrant labels */}
        <text x={pad.left + 4}         y={pad.top + 12}         fill={T.textFaint} fontSize={7} fontFamily={FONT}>Small network · High risk</text>
        <text x={pad.left + plotW - 4} y={pad.top + 12}         fill={T.textFaint} fontSize={7} fontFamily={FONT} textAnchor="end">Large network · High risk</text>
        <text x={pad.left + 4}         y={pad.top + plotH - 6}  fill={T.textFaint} fontSize={7} fontFamily={FONT}>Small network · Low risk</text>
        <text x={pad.left + plotW - 4} y={pad.top + plotH - 6}  fill={T.textFaint} fontSize={7} fontFamily={FONT} textAnchor="end">Large network · Low risk</text>

        {/* Y ticks */}
        {yTicks.map((t, i) => (
          <text key={i} x={pad.left - 6} y={t.svgY} textAnchor="end" dominantBaseline="middle"
            fill={T.textFaint} fontSize={7} fontFamily={FONT}>{t.label}</text>
        ))}

        {/* X ticks */}
        {xTicks.map((t, i) => (
          <text key={i} x={t.svgX} y={pad.top + plotH + 16} textAnchor="middle"
            fill={T.textFaint} fontSize={7} fontFamily={FONT}>{t.label}</text>
        ))}

        {/* ── Dots (clipped) ── */}
        <g clipPath="url(#plotClip)">
          {sortedVisible.map(p => {
            const { cx, cy } = toSVG(p);
            const color  = CANCER_COLORS[p.cancer];
            const isSel  = p.id === selectedId;
            const isCmp  = p.id === compareId;
            const isHov  = p.id === hoverId;
            const r      = dotRadius(p, isSel, isCmp);

            // Opacity: deceased (hollow) gets full opacity to stand out from survived (lighter)
            const survivedOpacity = isSel || isCmp ? 1 : isHov ? 0.85 : 0.38;
            const deceasedOpacity = isSel || isCmp ? 1 : isHov ? 1    : 0.88;

            const handleClick = (e: React.MouseEvent) => {
              e.stopPropagation();
              if (compareMode && onComparePatient) {
                onComparePatient(p.id);
              } else {
                onSelectPatient(p.id);
              }
            };

            return (
              <g key={p.id} data-dot="1" style={{ cursor: "pointer" }}
                onClick={handleClick}
                onMouseEnter={() => setHoverId(p.id)}
                onMouseLeave={() => setHoverId(null)}>

                {/* Selected ring */}
                {isSel && <>
                  <circle cx={cx} cy={cy} r={r + 9} fill="none"
                    stroke={p.survived ? "#0F172A" : T.red}
                    strokeWidth={2} strokeDasharray={p.survived ? "none" : "4,2"} />
                  <circle cx={cx} cy={cy} r={r + 14} fill="none" stroke={color} strokeWidth={1} opacity={0.25} />
                </>}

                {/* Compare ring — dashed purple */}
                {isCmp && <>
                  <circle cx={cx} cy={cy} r={r + 9} fill="none"
                    stroke="#6B46C1" strokeWidth={2} strokeDasharray="6,3" />
                  <circle cx={cx} cy={cy} r={r + 14} fill="none" stroke="#6B46C1" strokeWidth={1} opacity={0.3} />
                </>}

                {/* Hover ring */}
                {isHov && !isSel && !isCmp && (
                  <circle cx={cx} cy={cy} r={r + 5} fill="none" stroke={color} strokeWidth={1} opacity={0.4} />
                )}

                {/* Dot fill — survived lighter, deceased full opacity */}
                {p.survived
                  ? <circle cx={cx} cy={cy} r={r} fill={color} opacity={survivedOpacity} />
                  : <circle cx={cx} cy={cy} r={r} fill="none" stroke={color} strokeWidth={2}
                      opacity={deceasedOpacity} />
                }

                {/* Compare label badge */}
                {isCmp && (
                  <g style={{ pointerEvents: "none" }}>
                    <rect x={cx + r + 2} y={cy - 8} width={16} height={11} rx={2}
                      fill="#6B46C1" opacity={0.9} />
                    <text x={cx + r + 10} y={cy - 1} textAnchor="middle"
                      fill="white" fontSize={7} fontFamily={FONT} fontWeight={700}>B</text>
                  </g>
                )}
                {isSel && (
                  <g style={{ pointerEvents: "none" }}>
                    <rect x={cx + r + 2} y={cy - 8} width={16} height={11} rx={2}
                      fill="#2B6CB0" opacity={0.9} />
                    <text x={cx + r + 10} y={cy - 1} textAnchor="middle"
                      fill="white" fontSize={7} fontFamily={FONT} fontWeight={700}>A</text>
                  </g>
                )}

                {/* Tooltip */}
                {isHov && !isSel && !isCmp && (() => {
                  const flipX = cx > pad.left + plotW * 0.6;
                  const ttW   = 100;
                  const ttX   = flipX ? cx - ttW - 6 : cx + 8;
                  const ttY   = Math.max(pad.top + 2, Math.min(cy - 18, pad.top + plotH - 32));
                  return (
                    <g style={{ pointerEvents: "none" }}>
                      <rect x={ttX} y={ttY} width={ttW} height={compareMode ? 36 : 26} rx={3}
                        fill={T.bgCard} stroke={T.border} strokeWidth={0.8} />
                      <text x={ttX + 4} y={ttY + 11} fill={color} fontSize={8} fontFamily={FONT} fontWeight={700}>
                        {p.id}
                      </text>
                      <text x={ttX + 4} y={ttY + 22} fill={T.textMuted} fontSize={7} fontFamily={FONT}>
                        risk {p.avgRisk}% · team {p.maxTeam}
                      </text>
                      {compareMode && (
                        <text x={ttX + 4} y={ttY + 32} fill="#6B46C1" fontSize={7} fontFamily={FONT}>
                          click to compare →
                        </text>
                      )}
                    </g>
                  );
                })()}
              </g>
            );
          })}
        </g>

        {/* Axis labels */}
        <text x={pad.left + plotW / 2} y={H - 6} textAnchor="middle"
          fill={T.textFaint} fontSize={9} fontFamily={FONT}>
          Care Network Size →
        </text>
        <text x={14} y={pad.top + plotH / 2} textAnchor="middle"
          fill={T.textFaint} fontSize={9} fontFamily={FONT}
          transform={`rotate(-90,14,${pad.top + plotH / 2})`}>
          Avg Predicted Death Risk ↑
        </text>

        {/* Mini-map */}
        {isZoomed && (
          <g style={{ pointerEvents: "none" }}>
            <rect x={MM.x - 1} y={MM.y - 1} width={MM.w + 2} height={MM.h + 2}
              fill={T.bgCard} stroke={T.border} strokeWidth={0.8} rx={2} opacity={0.95} />
            {visible.map(p => (
              <circle key={p.id}
                cx={MM.x + p.x * MM.w}
                cy={MM.y + (1 - p.y) * MM.h}
                r={1.2}
                fill={p.survived ? CANCER_COLORS[p.cancer] : "none"}
                stroke={p.survived ? "none" : CANCER_COLORS[p.cancer]}
                strokeWidth={0.8}
                opacity={p.survived ? 0.35 : 0.75}
              />
            ))}
            <rect x={thumbX} y={thumbY} width={thumbW} height={thumbH}
              fill="#2B6CB020" stroke="#2B6CB0" strokeWidth={1} rx={1} />
            <text x={MM.x + MM.w / 2} y={MM.y + MM.h + 9}
              textAnchor="middle" fill={T.textFaint} fontSize={6} fontFamily={FONT}>minimap</text>
          </g>
        )}
      </svg>

      {selected && <InfoCard patient={selected} compareId={compareId} />}

      {/* Legend */}
      <div style={{ display: "flex", gap: 12, marginTop: 8, flexWrap: "wrap", alignItems: "center" }}>
        {(["breast", "colon", "lung"] as const).map(c => (
          <div key={c} style={{ display: "flex", alignItems: "center", gap: 4 }}>
            <svg width={8} height={8}><circle cx={4} cy={4} r={3.5} fill={CANCER_COLORS[c]} /></svg>
            <span style={{ color: T.textMuted, fontSize: 9, fontFamily: FONT, textTransform: "uppercase" }}>{c}</span>
          </div>
        ))}
        <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
          <svg width={10} height={10}>
            <circle cx={5} cy={5} r={4} fill="none" stroke={T.textMuted} strokeWidth={2} />
          </svg>
          <span style={{ color: T.textMuted, fontSize: 9 }}>Deceased (full opacity)</span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
          <svg width={10} height={10}><circle cx={5} cy={5} r={4} fill={T.textFaint} opacity={0.4} /></svg>
          <span style={{ color: T.textMuted, fontSize: 9 }}>Survived (dimmed)</span>
        </div>
      </div>
    </div>
  );
}

function InfoCard({ patient, compareId }: { patient: PatientDot; compareId?: string }) {
  const color = CANCER_COLORS[patient.cancer];
  return (
    <div style={{
      background: T.bgInset, border: `1px solid ${T.border}`, borderRadius: 8,
      padding: "8px 12px", marginTop: 6,
      display: "flex", gap: 16, alignItems: "flex-start",
    }}>
      <div style={{ flex: 1 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 2 }}>
          <span style={{ background: "#2B6CB0", color: "white", fontSize: 7, fontFamily: FONT,
            borderRadius: 3, padding: "1px 5px", fontWeight: 700 }}>A</span>
          <span style={{ color, fontSize: 11, fontWeight: 700 }}>{patient.id}</span>
        </div>
        <div style={{ color: T.textSecondary, fontSize: 9, lineHeight: 1.7 }}>
          {patient.survived ? "SURVIVED" : "DECEASED"} · {patient.weeks} WKS · RISK {patient.avgRisk}% · TEAM {patient.maxTeam}
        </div>
      </div>
      {compareId && (
        <div style={{ color: T.textFaint, fontSize: 9, display: "flex", alignItems: "center", gap: 4 }}>
          <span style={{ background: "#6B46C1", color: "white", fontSize: 7, fontFamily: FONT,
            borderRadius: 3, padding: "1px 5px", fontWeight: 700 }}>B</span>
          <span style={{ color: "#6B46C1", fontWeight: 700 }}>{compareId}</span>
        </div>
      )}
    </div>
  );
}