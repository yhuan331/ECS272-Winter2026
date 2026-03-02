import { useState, useEffect } from "react";
import { ScatterPlot } from "./components/ScatterPlot";
import { RadialGlyph } from "./components/RadialGlyph";
// import { TimelineChart } from "./components/TimelineChart";
import { HCPTreeMap } from "./components/HCPTreeMap";
import { initRealData, switchPatient, selectedPatientId } from "./realData";

let _temporal: Record<string, unknown> = {};
let _egoMap: Record<string, unknown> = {};

const nanSafe = (path: string) =>
  fetch(path).then((r) => r.text()).then((txt) =>
    JSON.parse(
      txt.replace(/\bNaN\b/g, "null")
         .replace(/-Infinity\b/g, "null")
         .replace(/\bInfinity\b/g, "null")
    )
  );

export default function App() {
  const [ready, setReady] = useState(false);
  const [focusId, setFocusId] = useState<string>("");
  const [tick, setTick] = useState(0);
  const [selectedWeek, setSelectedWeek] = useState<number | null>(null);

  useEffect(() => {
    initRealData("/temporal_networks.json", "/full_va_export_with_ego.json").then(() => {
      setFocusId(selectedPatientId);
      setReady(true);
      Promise.all([
        nanSafe("/temporal_networks.json"),
        nanSafe("/full_va_export_with_ego.json"),
      ]).then(([t, e]) => {
        _temporal = t as Record<string, unknown>;
        if (Array.isArray(e)) {
          const m: Record<string, unknown> = {};
          for (const rec of e as Array<{id: string}>) m[rec.id] = rec;
          _egoMap = m;
        } else {
          _egoMap = e as Record<string, unknown>;
        }
      });
    });
  }, []);

  const handleSelectPatient = (id: string) => {
    switchPatient(id, _temporal, _egoMap as never);
    setFocusId(id);
    setSelectedWeek(null);
    setTick((t) => t + 1);
  };

  const handleSelectWeek = (week: number | null) => {
    setSelectedWeek(week);
  };

  if (!ready) {
    return (
      <div style={{
        width: "100%", height: "100vh", background: "#0D0F14",
        display: "flex", alignItems: "center", justifyContent: "center",
        color: "#4FFFB0", fontFamily: "'Space Mono', monospace",
        fontSize: 13, letterSpacing: 2,
      }}>
        LOADING PATIENT DATA
      </div>
    );
  }

  return (
    <div style={{
      width: "100%", height: "100vh", background: "#0D0F14",
      display: "flex", fontFamily: "'Space Mono', monospace", overflow: "hidden",
    }}>
      {/* Left Panel */}
      <div style={{ width: "38%", padding: 16, boxSizing: "border-box" }}>
        <ScatterPlot selectedId={focusId} onSelectPatient={handleSelectPatient} />
      </div>

      {/* Right Panel */}
      <div style={{
        width: "62%", display: "flex", flexDirection: "column",
        padding: "16px 16px 16px 0", boxSizing: "border-box", gap: 8,
      }}>
        {/* Top row: Radial + TreeMap */}
        <div style={{ flex: "1 1 0", minHeight: 0, display: "flex", gap: 8 }}>
          <div style={{ flex: "0 0 56%", minHeight: 0 }}>
            <RadialGlyph
              key={focusId + tick}
              selectedWeek={selectedWeek}
              onSelectWeek={handleSelectWeek}
            />
          </div>
          <div style={{ flex: "1 1 0", minHeight: 0 }}>
            <HCPTreeMap
              key={focusId + tick + (selectedWeek ?? "all")}
              selectedWeek={selectedWeek}
            />
          </div>
        </div>

        {/* Timeline */}
        {/* <div style={{ flex: "0 0 155px" }}>
          <TimelineChart
            key={focusId + tick}
            onSelectWeek={handleSelectWeek}
            selectedWeek={selectedWeek}
          />
        </div> */}
      </div>
    </div>
  );
}