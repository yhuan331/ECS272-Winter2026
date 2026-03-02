import { useState, useMemo, useRef } from "react";
import { T } from "../theme";
import { weeklyData, buildHCPTree, type TreeGroup } from "../realData";

const FONT = "'Space Mono', monospace";

interface Props { selectedWeek: number | null; }

interface TooltipState {
  x: number; y: number;
  group: TreeGroup;
  leaf?: { name: string; value: number } | null;
}

// ── Simple slice-based treemap (more predictable than squarify for small sets) ──
function layoutTreemap(
  items: { value: number }[],
  x: number, y: number, w: number, h: number
): Array<{ x: number; y: number; w: number; h: number; idx: number }> {
  if (!items.length) return [];
  const total = items.reduce((s, d) => s + d.value, 0);
  if (total === 0) return [];

  const sorted = items.map((d, i) => ({ ...d, idx: i })).sort((a, b) => b.value - a.value);
  const result: Array<{ x: number; y: number; w: number; h: number; idx: number }> = [];

  function slice(nodes: typeof sorted, x: number, y: number, w: number, h: number) {
    if (!nodes.length) return;
    const nodeSum = nodes.reduce((s, d) => s + d.value, 0);
    const horiz = w >= h;
    let offset = horiz ? x : y;

    nodes.forEach((node) => {
      const frac = node.value / nodeSum;
      const dim = frac * (horiz ? w : h);
      result.push({
        x: horiz ? offset : x,
        y: horiz ? y : offset,
        w: horiz ? dim : w,
        h: horiz ? h : dim,
        idx: node.idx,
      });
      offset += dim;
    });
  }

  // Split into two halves for better balance
  if (sorted.length <= 4) {
    slice(sorted, x, y, w, h);
    return result;
  }

  const half = Math.ceil(sorted.length / 2);
  const top = sorted.slice(0, half);
  const bot = sorted.slice(half);
  const topSum = top.reduce((s, d) => s + d.value, 0);
  const frac = topSum / total;

  if (w >= h) {
    slice(top, x, y, w * frac, h);
    slice(bot, x + w * frac, y, w * (1 - frac), h);
  } else {
    slice(top, x, y, w, h * frac);
    slice(bot, x, y + h * frac, w, h * (1 - frac));
  }
  return result;
}

export function HCPTreeMap({ selectedWeek }: Props) {
  const [tooltip, setTooltip] = useState<TooltipState | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);

  const tree: TreeGroup[] = useMemo(() => {
    if (!weeklyData.length) return [];
    if (selectedWeek !== null) {
      const week = weeklyData.find((w) => w.week === selectedWeek);
      if (!week?.hcpNames?.length) return [];
      return buildHCPTree(week.hcpNames.map((sp) => ({ specialty: sp, providerType: "", clinicianTitle: "" })));
    }
    const allSnaps = weeklyData.flatMap((w) =>
      (w.hcpNames ?? []).map((sp) => ({ specialty: sp, providerType: "", clinicianTitle: "" }))
    );
    return buildHCPTree(allSnaps);
  }, [selectedWeek, weeklyData.length]);

  if (!tree.length) {
    return (
      <div style={{
        height: "100%", display: "flex", alignItems: "center", justifyContent: "center",
        color: T.textFaint, fontFamily: T.font, fontSize: 11, letterSpacing: 2,
        background: T.bgCard, border: `1px solid ${T.border}`, borderRadius: 10,
      }}>
        {weeklyData.length ? "NO HCP DATA" : "SELECT A PATIENT"}
      </div>
    );
  }

  const PAD = 8;
  const W = 400, H_TREE = 340;
  const layouts = layoutTreemap(tree, PAD, PAD, W - PAD * 2, H_TREE - PAD * 2);

  const handleGroupHover = (
    e: React.MouseEvent<SVGGElement>,
    group: TreeGroup,
    leaf?: { name: string; value: number } | null
  ) => {
    if (!svgRef.current) return;
    const rect = svgRef.current.getBoundingClientRect();
    setTooltip({
      x: e.clientX - rect.left,
      y: e.clientY - rect.top,
      group,
      leaf,
    });
  };

  return (
    <div style={{
      background: T.bgCard, border: `1px solid ${T.border}`, borderRadius: 10,
      padding: 10, height: "100%", display: "flex", flexDirection: "column",
      fontFamily: T.font, overflow: "hidden", position: "relative",
      boxShadow: "0 1px 4px rgba(0,0,0,0.06)",
    }}>
      {/* Header */}
      <div style={{ color: T.textMuted, fontSize: 10, fontWeight: 700, letterSpacing: 1.5, marginBottom: 6, flexShrink: 0 }}>
        HCP SPECIALTY MIX
        {selectedWeek !== null
          ? <span style={{ color: "#D69E2E", marginLeft: 8 }}>WEEK {selectedWeek}</span>
          : <span style={{ color: T.textMuted, marginLeft: 8, fontSize: 9 }}>ALL WEEKS · HOVER TO INSPECT</span>
        }
      </div>

      {/* SVG treemap */}
      <svg
        ref={svgRef}
        viewBox={`0 0 ${W} ${H_TREE}`}
        style={{ width: "100%", flex: 1, minHeight: 0 }}
        onMouseLeave={() => setTooltip(null)}
      >
        {layouts.map((cell) => {
          const group = tree[cell.idx];
          if (!group) return null;
          const isHov = tooltip?.group.name === group.name;
          const GAP = 2;

          // Sub-layout children inside parent cell
          const childLayouts = group.children?.length > 1
            ? layoutTreemap(
                group.children,
                cell.x + GAP, cell.y + GAP,
                cell.w - GAP * 2, cell.h - GAP * 2
              )
            : null;

          return (
            <g key={group.name}>
              {/* Group background */}
              <rect
                x={cell.x} y={cell.y}
                width={Math.max(0, cell.w - 1)} height={Math.max(0, cell.h - 1)}
                fill={group.color} fillOpacity={isHov ? 0.18 : 0.08}
                stroke={group.color} strokeOpacity={isHov ? 1 : 0.5}
                strokeWidth={isHov ? 1.5 : 0.8} rx={3}
              />

              {/* Child specialty cells */}
              {childLayouts?.map((cl, ci) => {
                const child = group.children[cl.idx];
                if (!child) return null;
                const isLeafHov = tooltip?.leaf?.name === child.name;
                return (
                  <g
                    key={child.name}
                    onMouseEnter={(e) => handleGroupHover(e, group, child)}
                    onMouseMove={(e) => handleGroupHover(e, group, child)}
                    style={{ cursor: "pointer" }}
                  >
                    <rect
                      x={cl.x} y={cl.y}
                      width={Math.max(0, cl.w - 1)} height={Math.max(0, cl.h - 1)}
                      fill={group.color}
                      fillOpacity={isLeafHov ? 0.5 : 0.22}
                      stroke={group.color}
                      strokeOpacity={isLeafHov ? 1 : 0.3}
                      strokeWidth={0.5} rx={1}
                    />
                    {/* Leaf label if big enough */}
                    {cl.w > 30 && cl.h > 12 && (
                      <text
                        x={cl.x + cl.w / 2} y={cl.y + cl.h / 2}
                        textAnchor="middle" dominantBaseline="central"
                        fill={group.color} fillOpacity={0.95}
                        fontSize={Math.min(9, Math.max(6, cl.w / 7))}
                        fontFamily={FONT}
                        style={{ pointerEvents: "none" }}
                      >
                        {child.name.length > 14 ? child.name.slice(0, 12) + "…" : child.name}
                      </text>
                    )}
                  </g>
                );
              })}

              {/* If no child layout, single block is hoverable */}
              {!childLayouts && (
                <rect
                  x={cell.x} y={cell.y}
                  width={Math.max(0, cell.w - 1)} height={Math.max(0, cell.h - 1)}
                  fill="transparent" stroke="none"
                  onMouseEnter={(e) => handleGroupHover(e, group, null)}
                  onMouseMove={(e) => handleGroupHover(e, group, null)}
                  style={{ cursor: "pointer" }}
                />
              )}

              {/* Group label */}
              {cell.w > 40 && cell.h > 18 && (
                <text
                  x={cell.x + 4} y={cell.y + 9}
                  fill={group.color} fillOpacity={0.9}
                  fontSize={Math.min(10, Math.max(7, cell.w / 8))}
                  fontFamily={FONT}
                  fontWeight={700}
                  style={{ pointerEvents: "none" }}
                >
                  {group.name.length > 16 && cell.w < 90 ? group.name.split(" ")[0] : group.name}
                </text>
              )}

              {/* Count badge */}
              {cell.w > 30 && cell.h > 22 && (
                <text
                  x={cell.x + cell.w - 4} y={cell.y + 9}
                  textAnchor="end"
                  fill={group.color} fillOpacity={0.5}
                  fontSize={8} fontFamily={T.font}
                  style={{ pointerEvents: "none" }}
                >
                  {group.value}
                </text>
              )}
            </g>
          );
        })}
      </svg>

      {/* Floating tooltip */}
      {tooltip && (
        <div style={{
          position: "absolute",
          left: Math.min(tooltip.x + 12, W - 180),
          top: Math.min(tooltip.y + 8, H_TREE - 120),
          background: T.bgCard,
          border: `1px solid ${tooltip.group.color}33`,
          borderLeft: `3px solid ${tooltip.group.color}`,
          borderRadius: 6,
          padding: "8px 10px",
          pointerEvents: "none",
          zIndex: 50,
          minWidth: 160,
          maxWidth: 220,
          boxShadow: "0 4px 20px rgba(0,0,0,0.7)",
        }}>
          {/* L1 group header */}
          <div style={{ color: tooltip.group.color, fontSize: 11, fontWeight: 700, marginBottom: 4 }}>
            {tooltip.group.name}
            <span style={{ color: T.textMuted, fontWeight: 400, marginLeft: 6 }}>
              {tooltip.group.value} HCPs
            </span>
          </div>

          {/* Highlighted leaf specialty */}
          {tooltip.leaf && (
            <div style={{
              background: tooltip.group.color + "12",
              border: `1px solid ${tooltip.group.color}33`,
              borderRadius: 4, padding: "3px 6px", marginBottom: 5,
            }}>
              <span style={{ color: T.textPrimary, fontSize: 11, fontWeight: 700 }}>
                {tooltip.leaf.name}
              </span>
              <span style={{ color: tooltip.group.color, fontSize: 10, marginLeft: 6 }}>
                ×{tooltip.leaf.value}
              </span>
            </div>
          )}

          {/* All specialties in this L1 group */}
          <div style={{ color: T.textMuted, fontSize: 9, fontWeight: 700, marginBottom: 3 }}>ALL IN GROUP:</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
            {tooltip.group.children?.map((c) => (
              <div key={c.name} style={{
                display: "flex", justifyContent: "space-between", alignItems: "center",
              }}>
                <span style={{
                  color: c.name === tooltip.leaf?.name ? T.textPrimary : T.textSecondary,
                  fontSize: 10,
                  fontWeight: c.name === tooltip.leaf?.name ? 700 : 400,
                }}>
                  {c.name}
                </span>
                <span style={{ color: tooltip.group.color, fontSize: 10, marginLeft: 8 }}>
                  {c.value}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}