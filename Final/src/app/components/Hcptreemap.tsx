/**
 * HCPTreeMap.tsx
 *
 * Shows HCP specialty distribution as a squarified treemap.
 * - If selectedWeek is set: shows HCPs from that week's snapshot
 * - Otherwise: shows aggregate across all weeks for selected patient
 *
 * Level 1 groups from node_attr_vocabs.json taxonomy.
 * Colors match L1_COLORS from realData.
 */

import { useState, useMemo } from "react";
import { weeklyData, buildHCPTree, type TreeGroup } from "../realData";

const FONT = "'Space Mono', monospace";

interface Props {
  selectedWeek: number | null;
}

// Squarified treemap layout algorithm
function squarify(
  items: { value: number; [k: string]: unknown }[],
  x: number, y: number, w: number, h: number
): Array<{ x: number; y: number; w: number; h: number; idx: number }> {
  if (!items.length) return [];
  const total = items.reduce((s, d) => s + d.value, 0);
  if (total === 0) return [];

  const result: Array<{ x: number; y: number; w: number; h: number; idx: number }> = [];
  const sorted = [...items.map((d, i) => ({ ...d, idx: i }))].sort((a, b) => b.value - a.value);

  let cx = x, cy = y, cw = w, ch = h;
  let start = 0;

  while (start < sorted.length) {
    const remaining = sorted.slice(start);
    const remSum = remaining.reduce((s, d) => s + d.value, 0);
    const isHoriz = cw >= ch;
    const dim = isHoriz ? cw : ch;

    // Find optimal row
    let rowEnd = start;
    let bestRatio = Infinity;
    let rowSum = 0;

    for (let i = start; i < sorted.length; i++) {
      rowSum += sorted[i].value;
      const rowDim = (rowSum / remSum) * dim;
      let maxR = 0;
      let rs = 0;
      for (let j = start; j <= i; j++) {
        rs += sorted[j].value;
        const sliceDim = isHoriz ? ch : cw;
        const cellDim = (sorted[j].value / rowSum) * rowDim;
        const r = Math.max(
          (sliceDim * sliceDim * (rowSum * rowSum)) / (sorted[j].value * rowSum * rowSum),
          (sorted[j].value * rowSum * rowSum) / (sliceDim * sliceDim * (rowSum * rowSum))
        );
        maxR = Math.max(maxR, r);
      }
      if (maxR < bestRatio) { bestRatio = maxR; rowEnd = i; }
      else break;
    }

    const row = sorted.slice(start, rowEnd + 1);
    const rowValueSum = row.reduce((s, d) => s + d.value, 0);
    const rowDim = (rowValueSum / remSum) * dim;

    let offset = isHoriz ? cy : cx;
    for (const item of row) {
      const cellDim = ((isHoriz ? ch : cw)) * (item.value / rowValueSum);
      result.push({
        x: isHoriz ? cx : offset,
        y: isHoriz ? offset : cy,
        w: isHoriz ? rowDim : cellDim,
        h: isHoriz ? cellDim : rowDim,
        idx: item.idx,
      });
      offset += cellDim;
    }

    if (isHoriz) { cx += rowDim; cw -= rowDim; }
    else { cy += rowDim; ch -= rowDim; }
    start = rowEnd + 1;
  }

  return result;
}

export function HCPTreeMap({ selectedWeek }: Props) {
  const [hoveredGroup, setHoveredGroup] = useState<string | null>(null);

  const tree: TreeGroup[] = useMemo(() => {
    if (!weeklyData.length) return [];

    if (selectedWeek !== null) {
      // Use that specific week's HCP snapshot
      const week = weeklyData.find((w) => w.week === selectedWeek);
      if (!week || !week.hcpNames?.length) return [];
      // hcpNames are specialties — reconstruct minimal snapshot
      const snapshots = week.hcpNames.map((sp) => ({
        specialty: sp, providerType: "", clinicianTitle: "",
      }));
      return buildHCPTree(snapshots);
    } else {
      // Aggregate all weeks
      const allSnapshots = weeklyData.flatMap((w) =>
        (w.hcpNames ?? []).map((sp) => ({ specialty: sp, providerType: "", clinicianTitle: "" }))
      );
      return buildHCPTree(allSnapshots);
    }
  }, [selectedWeek, weeklyData.length]);

  if (!tree.length) {
    return (
      <div style={{
        height: "100%", display: "flex", alignItems: "center", justifyContent: "center",
        color: "#2A3040", fontFamily: FONT, fontSize: 10, letterSpacing: 2,
        background: "#151820", border: "1px solid #252A35", borderRadius: 8,
      }}>
        {weeklyData.length ? "NO HCP DATA" : "SELECT A PATIENT"}
      </div>
    );
  }

  const PAD = 12;
  const W = 380, H_TREE = 320;

  // Layout L1 groups
  const layouts = squarify(tree, PAD, PAD, W - PAD * 2, H_TREE - PAD * 2);

  return (
    <div style={{
      background: "#151820", border: "1px solid #252A35", borderRadius: 8,
      padding: 12, height: "100%", display: "flex", flexDirection: "column",
      fontFamily: FONT, overflow: "hidden",
    }}>
      <div style={{ color: "#64748B", fontSize: 9, letterSpacing: 1.5, marginBottom: 6 }}>
        HCP SPECIALTY MIX
        {selectedWeek !== null && (
          <span style={{ color: "#FFD166", marginLeft: 8 }}>W{selectedWeek}</span>
        )}
        {selectedWeek === null && (
          <span style={{ color: "#475569", marginLeft: 8, fontSize: 7 }}>ALL WEEKS</span>
        )}
      </div>

      <svg
        viewBox={`0 0 ${W} ${H_TREE}`}
        style={{ width: "100%", flex: 1 }}
      >
        {layouts.map((cell, ci) => {
          const group = tree[cell.idx];
          if (!group) return null;
          const isHov = hoveredGroup === group.name;
          const MIN_LABEL = 28;

          return (
            <g
              key={group.name}
              onMouseEnter={() => setHoveredGroup(group.name)}
              onMouseLeave={() => setHoveredGroup(null)}
              style={{ cursor: "default" }}
            >
              {/* Background rect */}
              <rect
                x={cell.x + 1} y={cell.y + 1}
                width={Math.max(0, cell.w - 2)} height={Math.max(0, cell.h - 2)}
                fill={group.color}
                fillOpacity={isHov ? 0.28 : 0.14}
                stroke={group.color}
                strokeOpacity={isHov ? 0.9 : 0.45}
                strokeWidth={isHov ? 1.5 : 0.8}
                rx={2}
              />

              {/* Children (specialty breakdown) as horizontal fill */}
              {isHov && group.children && cell.w > 40 && cell.h > 20 && (() => {
                const total = group.children.reduce((s, c) => s + c.value, 0);
                let dx = cell.x + 2;
                return group.children.slice(0, 8).map((child, ci2) => {
                  const cw = ((child.value / total) * (cell.w - 4));
                  const rect = (
                    <rect key={ci2} x={dx} y={cell.y + cell.h - 6}
                      width={Math.max(0, cw - 1)} height={4}
                      fill={group.color} fillOpacity={0.6 - ci2 * 0.05} rx={1}/>
                  );
                  dx += cw;
                  return rect;
                });
              })()}

              {/* L1 label */}
              {cell.w > MIN_LABEL && cell.h > 16 && (
                <text
                  x={cell.x + cell.w / 2}
                  y={cell.y + cell.h / 2 - (cell.h > 30 ? 5 : 0)}
                  textAnchor="middle"
                  dominantBaseline="central"
                  fill={group.color}
                  fillOpacity={isHov ? 1 : 0.85}
                  fontSize={Math.min(9, Math.max(5, cell.w / 8))}
                  fontFamily={FONT}
                  style={{ pointerEvents: "none" }}
                >
                  {group.name.length > 14 && cell.w < 80
                    ? group.name.split(" ").map((w, wi) => (
                        <tspan key={wi} x={cell.x + cell.w / 2} dy={wi === 0 ? 0 : "1.1em"}>
                          {w}
                        </tspan>
                      ))
                    : group.name}
                </text>
              )}

              {/* Count */}
              {cell.w > 30 && cell.h > 28 && (
                <text
                  x={cell.x + cell.w / 2}
                  y={cell.y + cell.h / 2 + 8}
                  textAnchor="middle"
                  dominantBaseline="central"
                  fill={group.color}
                  fillOpacity={0.6}
                  fontSize={Math.min(8, Math.max(5, cell.w / 10))}
                  fontFamily={FONT}
                  style={{ pointerEvents: "none" }}
                >
                  {group.value}
                </text>
              )}
            </g>
          );
        })}
      </svg>

      {/* Hover detail */}
      {hoveredGroup && (() => {
        const g = tree.find((t) => t.name === hoveredGroup);
        if (!g) return null;
        return (
          <div style={{
            borderTop: "1px solid #252A35", paddingTop: 6, marginTop: 4,
            maxHeight: 80, overflowY: "auto",
          }}>
            <div style={{ color: g.color, fontSize: 8, marginBottom: 3, fontWeight: 700 }}>
              {g.name} ({g.value})
            </div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: "2px 10px" }}>
              {g.children?.slice(0, 10).map((c) => (
                <span key={c.name} style={{ color: "#64748B", fontSize: 7 }}>
                  {c.name} <span style={{ color: g.color }}>{c.value}</span>
                </span>
              ))}
            </div>
          </div>
        );
      })()}
    </div>
  );
}