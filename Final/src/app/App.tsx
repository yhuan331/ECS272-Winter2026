import { useState, useEffect } from "react";
import { ScatterPlot } from "./components/ScatterPlot";
import { RadialGlyph } from "./components/RadialGlyph";
import { TimelineChart } from "./components/TimelineChart";
import { HCPTreeMap } from "./components/HCPTreeMap";
import { initRealData, switchPatient, selectedPatientId } from "./realData";
import { T } from "./theme";

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

  useEffect(() => {
    initRealData("/temporal_networks.json", "/full_va_export_with_ego.json").then(() => {
      setFocusId(selectedPatientId);
      setReady(true);
      Promise.all([nanSafe("/temporal_networks.json"), nanSafe("/full_va_export_with_ego.json")])
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
    setFocusId(id); setSelectedWeek(null); setTick(t => t+1);
  };

  if (!ready) return (
    <div style={{ width:"100%", height:"100vh", background: T.bg, display:"flex",
      alignItems:"center", justifyContent:"center", color: T.textMuted,
      fontFamily: T.font, fontSize:13, letterSpacing:2 }}>
      LOADING PATIENT DATA…
    </div>
  );

  return (
    <div style={{ width:"100%", height:"100vh", background: T.bg,
      display:"flex", fontFamily: T.font, overflow:"hidden" }}>

      {/* Left — scatter */}
      <div style={{ width:"37%", padding:12, boxSizing:"border-box" }}>
        <ScatterPlot selectedId={focusId} onSelectPatient={handleSelectPatient} />
      </div>

      {/* Right */}
      <div style={{ width:"63%", display:"flex", flexDirection:"column",
        padding:"12px 12px 12px 0", boxSizing:"border-box", gap:8 }}>

        {/* Top row */}
        <div style={{ flex:"1 1 0", minHeight:0, display:"flex", gap:8 }}>
          <div style={{ flex:"0 0 60%", minHeight:0 }}>
            <RadialGlyph key={focusId+tick} selectedWeek={selectedWeek} onSelectWeek={setSelectedWeek} />
          </div>
          <div style={{ flex:"1 1 0", minHeight:0 }}>
            <HCPTreeMap key={focusId+tick+(selectedWeek??"all")} selectedWeek={selectedWeek} />
          </div>
        </div>


      </div>
    </div>
  );
}