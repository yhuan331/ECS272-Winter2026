/**
 * HCPBarChart.tsx
 * Replaces HCPTreeMap with a clean grouped horizontal bar chart.
 * Shows L1 specialty groups as rows; children as a stacked sub-row.
 * Hovering a row reveals the specialty breakdown.
 */

import { useState, useMemo } from "react";
import { T } from "../theme";
import { weeklyData, buildHCPTree, type TreeGroup, type WeekData } from "../realData";

const FONT = T.font;

interface Props {
  selectedWeek: number | null;
  data?: WeekData[]; // optional override — used for compare patient B
}

export function HCPBarChart({ selectedWeek, data }: Props) {
  const [hoveredGroup, setHoveredGroup] = useState<string | null>(null);
  const [expandedGroup, setExpandedGroup] = useState<string | null>(null);

  // Use provided data or fall back to global weeklyData
  const source = data ?? weeklyData;

  const tree: TreeGroup[] = useMemo(() => {
    if (!source.length) return [];
    if (selectedWeek !== null) {
      const week = source.find((w) => w.week === selectedWeek);
      // Use full hcpSnaps (all 3 fields) — fall back to hcpNames as specialty-only if missing
      const snaps = week?.hcpSnaps?.length
        ? week.hcpSnaps
        : (week?.hcpNames ?? []).map(n => ({ specialty: n, providerType: "", clinicianTitle: "" }));
      if (!snaps.length) return [];
      return buildHCPTree(snaps);
    }
    // All weeks: aggregate full snapshots
    const allSnaps = source.flatMap(w =>
      w.hcpSnaps?.length
        ? w.hcpSnaps
        : (w.hcpNames ?? []).map(n => ({ specialty: n, providerType: "", clinicianTitle: "" }))
    );
    return buildHCPTree(allSnaps);
  }, [selectedWeek, source.length]);

  if (!tree.length) {
    return (
      <div style={{
        height: "100%", display: "flex", alignItems: "center", justifyContent: "center",
        color: T.textFaint, fontFamily: FONT, fontSize: 11, letterSpacing: 2,
        background: T.bgCard, border: `1px solid ${T.border}`, borderRadius: 10,
      }}>
        {source.length ? "NO HCP DATA" : "SELECT A PATIENT"}
      </div>
    );
  }

  const maxValue = Math.max(...tree.map(g => g.value), 1);
  const totalHCPs = tree.reduce((s, g) => s + g.value, 0);

  return (
    <div style={{
      background: T.bgCard, border: `1px solid ${T.border}`, borderRadius: 10,
      padding: "10px 14px", height: "100%", display: "flex", flexDirection: "column",
      fontFamily: FONT, overflow: "hidden", position: "relative",
      boxShadow: "0 1px 4px rgba(0,0,0,0.06)",
    }}>
      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8, flexShrink: 0 }}>
        <div style={{ color: T.textMuted, fontSize: 10, fontWeight: 700, letterSpacing: 1.5 }}>
          HCP SPECIALTY MIX
        </div>
        {selectedWeek !== null
          ? <span style={{ color: "#D69E2E", fontSize: 9, fontWeight: 700, letterSpacing: 1 }}>WEEK {selectedWeek}</span>
          : <span style={{ color: T.textMuted, fontSize: 9 }}>ALL WEEKS</span>
        }
        <span style={{ marginLeft: "auto", color: T.textFaint, fontSize: 9 }}>
          {totalHCPs} total · {tree.length} groups · click to expand
        </span>
      </div>

      {/* Chart area */}
      <div style={{
        flex: 1, overflowY: "auto", display: "flex", flexDirection: "column", gap: 3,
        paddingRight: 4,
      }}>
        {tree.map((group) => {
          const isHov      = hoveredGroup === group.name;
          const isExpanded = expandedGroup === group.name;
          const barPct     = (group.value / maxValue) * 100;
          const sharePct   = ((group.value / totalHCPs) * 100).toFixed(1);

          return (
            <div key={group.name}>
              {/* ── Group row ── */}
              <div
                onMouseEnter={() => setHoveredGroup(group.name)}
                onMouseLeave={() => setHoveredGroup(null)}
                onClick={() => setExpandedGroup(isExpanded ? null : group.name)}
                style={{
                  display: "flex", alignItems: "center", gap: 8,
                  padding: "4px 6px", borderRadius: 5, cursor: "pointer",
                  background: isHov ? `${group.color}10` : isExpanded ? `${group.color}08` : "transparent",
                  border: `1px solid ${isHov || isExpanded ? group.color + "40" : "transparent"}`,
                  transition: "all 0.12s",
                }}
              >
                {/* Color swatch */}
                <div style={{
                  width: 8, height: 8, borderRadius: 2,
                  background: group.color, flexShrink: 0, opacity: 0.9,
                }} />

                {/* Label */}
                <div style={{
                  width: 170, flexShrink: 0,
                  color: isHov ? group.color : T.textSecondary,
                  fontSize: 10, fontWeight: isHov ? 700 : 400,
                  whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
                  transition: "color 0.12s",
                }}>
                  {group.name}
                </div>

                {/* Bar */}
                <div style={{ flex: 1, height: 10, background: T.bgInset, borderRadius: 5, overflow: "hidden", position: "relative" }}>
                  <div style={{
                    position: "absolute", left: 0, top: 0, height: "100%",
                    width: `${barPct}%`,
                    background: group.color,
                    opacity: isHov ? 0.9 : 0.55,
                    borderRadius: 5,
                    transition: "width 0.3s ease, opacity 0.12s",
                  }} />
                </div>

                {/* Count + share */}
                <div style={{
                  display: "flex", gap: 8, flexShrink: 0, alignItems: "center",
                  minWidth: 80, justifyContent: "flex-end",
                }}>
                  <span style={{ color: group.color, fontSize: 11, fontWeight: 700 }}>
                    {group.value}
                  </span>
                  <span style={{ color: T.textFaint, fontSize: 9 }}>
                    {sharePct}%
                  </span>
                  <span style={{
                    color: T.textFaint, fontSize: 9,
                    transform: isExpanded ? "rotate(90deg)" : "rotate(0deg)",
                    transition: "transform 0.15s",
                    display: "inline-block",
                  }}>▶</span>
                </div>
              </div>

              {/* ── Expanded children ── */}
              {isExpanded && group.children?.length > 0 && (
                <div style={{
                  marginLeft: 16, marginTop: 2, marginBottom: 4,
                  borderLeft: `2px solid ${group.color}30`,
                  paddingLeft: 10,
                  display: "flex", flexDirection: "column", gap: 2,
                }}>
                  {group.children.map((child) => {
                    const childPct = (child.value / group.value) * 100;
                    return (
                      <div key={child.name} style={{
                        display: "flex", alignItems: "center", gap: 8,
                        padding: "2px 4px",
                      }}>
                        <div style={{
                          width: 158, flexShrink: 0,
                          color: T.textSecondary, fontSize: 9,
                          whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
                        }}>
                          {child.name}
                        </div>
                        <div style={{ flex: 1, height: 6, background: T.bgInset, borderRadius: 3, overflow: "hidden" }}>
                          <div style={{
                            height: "100%", width: `${childPct}%`,
                            background: group.color, opacity: 0.45, borderRadius: 3,
                          }} />
                        </div>
                        <span style={{ color: group.color, fontSize: 9, minWidth: 20, textAlign: "right" }}>
                          {child.value}
                        </span>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Footer summary bar (stacked proportional) */}
      <div style={{ marginTop: 8, flexShrink: 0 }}>
        <div style={{ display: "flex", height: 8, borderRadius: 4, overflow: "hidden", gap: 1 }}>
          {tree.map((group) => (
            <div
              key={group.name}
              title={`${group.name}: ${group.value}`}
              style={{
                flex: group.value,
                background: group.color,
                opacity: hoveredGroup === group.name ? 1 : 0.6,
                transition: "opacity 0.12s",
                cursor: "pointer",
              }}
              onMouseEnter={() => setHoveredGroup(group.name)}
              onMouseLeave={() => setHoveredGroup(null)}
              onClick={() => setExpandedGroup(hoveredGroup === group.name ? null : group.name)}
            />
          ))}
        </div>
        <div style={{
          display: "flex", justifyContent: "space-between",
          marginTop: 3, color: T.textFaint, fontSize: 8,
        }}>
          <span>specialty distribution</span>
          {hoveredGroup && (
            <span style={{ color: tree.find(g => g.name === hoveredGroup)?.color }}>
              {hoveredGroup} — {tree.find(g => g.name === hoveredGroup)?.value} HCPs
            </span>
          )}
        </div>
      </div>
    </div>
  );
}