import { useState, useEffect } from "react";
import { ScatterPlot } from "./components/ScatterPlot";
import { RadialGlyph, WeekInfoPanel } from "./components/RadialGlyph";
import type { ViewMode } from "./components/RadialGlyph";
import { HCPTreeMap } from "./components/HCPTreeMap";
import { initRealData, switchPatient, selectedPatientId, totalPatientHCP, getPatientSummary, weeklyData } from "./realData";import { T } from "./theme";

let _temporal: Record<string, unknown> = {};
let _egoMap: Record<string, unknown> = {};

const nanSafe = (path: string) =>
  fetch(path).then(r => r.text()).then(txt =>
    JSON.parse(txt.replace(/\bNaN\b/g,"null").replace(/-Infinity\b/g,"null").replace(/\bInfinity\b/g,"null"))
  );

export default function App() {
  const [ready, setReady]               = useState(false);
  const [focusId, setFocusId]           = useState("");
  const [tick, setTick]                 = useState(0);
  const [selectedWeek, setSelectedWeek] = useState<number|null>(null);
  const [hoveredData, setHoveredData]   = useState<WeekData|null>(null);
  const [mode, setMode]                 = useState<ViewMode>("delta");  // ← new
  useEffect(() => {
    initRealData("/temporal_networks.json", "/full_va_export_with_linear.json").then(() => {
      setFocusId(selectedPatientId);
      setReady(true);
      Promise.all([nanSafe("/temporal_networks.json"), nanSafe("/full_va_export_with_linear.json")])

        .then(([t, e]) => {
          _temporal = t as Record<string,unknown>;
          if (Array.isArray(e)) {
            const m: Record<string,unknown> = {};
            for (const r of e as Array<{id:string}>) m[r.id] = r;
            _egoMap = m;
          } else { _egoMap = e as Record<string,unknown>; }
        });
    });
  }, []);

  const handleSelectPatient = (id: string) => {
    switchPatient(id, _temporal, _egoMap as never);
    setFocusId(id);
    setSelectedWeek(null);
    setHoveredData(null);
    setTick(t => t + 1);
  };

  const handleHoverWeek = (data: WeekData | null) => {
    // Only update if not pinned (pinned = selectedWeek is set)
    if (selectedWeek === null || data !== null) {
      setHoveredData(data);
    }
  };

  const handleSelectWeek = (week: number | null) => {
    setSelectedWeek(week);
    if (week === null) setHoveredData(null);
  };

  if (!ready) return (
    <div style={{ width:"100%", height:"100vh", background: T.bg, display:"flex",
      alignItems:"center", justifyContent:"center", color: T.textMuted,
      fontFamily: T.font, fontSize:13, letterSpacing:2 }}>
      LOADING PATIENT DATA…
    </div>
  );

  const { avgRiskAll, peakWeek, avgNotes } = getPatientSummary();
  const peakDeltaWeek = weeklyData.length
    ? weeklyData.reduce((best, d) =>
        Math.abs(d.probDelta) > Math.abs(best.probDelta) ? d : best,
        weeklyData[0])
    : null;

  return (
    <div style={{
      width: "100%",
      height: "100vh",
      background: T.bg,
      fontFamily: T.font,
      overflow: "hidden",
      display: "flex",
      flexDirection: "column",
      padding: 12,
      boxSizing: "border-box",
      gap: 8,
    }}>

      {/* ── TOP ROW: Scatter | Radial | WeekInfoPanel ── */}
      <div style={{
        flex: "0 0 62%",
        minHeight: 0,
        display: "flex",
        gap: 8,
      }}>
        {/* Scatter — 30% */}
        <div style={{ flex: "0 0 29%", minHeight: 0 }}>
          <ScatterPlot selectedId={focusId} onSelectPatient={handleSelectPatient} />
        </div>

        {/* Radial — 40% */}
        <div style={{ flex: "0 0 39%", minHeight: 0 }}>
          <RadialGlyph
          key={focusId + tick}
          selectedWeek={selectedWeek}
          onSelectWeek={handleSelectWeek}
          onHoverWeek={handleHoverWeek}
          mode={mode}
          onModeChange={setMode}
        />
        </div>

        {/* Week info panel — remaining ~31% */}
        <div style={{ flex: "1 1 0", minHeight: 0 }}>
          <WeekInfoPanel
          key={focusId + tick}
          activeData={hoveredData}
          pinnedWeek={selectedWeek}
          avgRiskAll={avgRiskAll}
          peakWeek={peakWeek}
          totalHCP={totalPatientHCP}
          avgNotes={avgNotes}
          mode={mode}
          peakDeltaWeek={peakDeltaWeek}
        />
        </div>
      </div>

      {/* ── BOTTOM ROW: Full-width TreeMap ── */}
      <div style={{ flex: "1 1 0", minHeight: 0 }}>
        <HCPTreeMap
          key={focusId + tick + (selectedWeek ?? "all")}
          selectedWeek={selectedWeek}
        />
      </div>
    </div>
  );
}