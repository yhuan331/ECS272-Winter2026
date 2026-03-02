/**
 * App.tsx  —  wired to real data
 *
 * Changes from mock version:
 *  1. Calls initRealData() before first render
 *  2. Passes raw JSON down so switchPatient() can update weekly view
 *  3. ScatterPlot accepts onSelectPatient callback
 */

import { useState, useEffect, useRef } from "react";
import { ScatterPlot } from "./components/ScatterPlot";
import { RadialGlyph } from "./components/RadialGlyph";
// import { TimelineChart } from "./components/TimelineChart";
import {
  initRealData,
  switchPatient,
  selectedPatientId,
  patients,
  weeklyData,
  surgeonEvents,
  totalPatientHCP,
} from "./realData";

// Keep raw JSON in module scope after first load
// so switchPatient() can re-derive weekly data without re-fetching
let _temporal: Record<string, unknown> = {};
let _egoMap: Record<string, unknown> = {};

export default function App() {
  const [ready, setReady] = useState(false);
  const [focusId, setFocusId] = useState<string>("");
  // tick forces re-render when module-level arrays mutate
  const [tick, setTick] = useState(0);

  useEffect(() => {
    // Put JSON files in /public so Vite serves them at root
    initRealData(
      "/temporal_networks.json",
      "/full_va_export_with_ego.json",
    ).then(() => {
      setFocusId(selectedPatientId);
      setReady(true);

      // Cache raw objects for patient switching (strip NaN from Python exports)
      const nanSafe = (path: string) =>
        fetch(path).then((r) => r.text()).then((txt) =>
          JSON.parse(
            txt
              .replace(/\bNaN\b/g, "null")
              .replace(/-Infinity\b/g, "null")
              .replace(/\bInfinity\b/g, "null")
          )
        );
      Promise.all([
        nanSafe("/temporal_networks.json"),
        nanSafe("/full_va_export_with_ego.json"),
      ]).then(([t, e]) => {
        _temporal = t;
        // normalise ego to map if array
        if (Array.isArray(e)) {
          const m: Record<string, unknown> = {};
          for (const rec of e) m[rec.id] = rec;
          _egoMap = m;
        } else {
          _egoMap = e;
        }
      });
    });
  }, []);

  const handleSelectPatient = (id: string) => {
    switchPatient(id, _temporal, _egoMap as never);
    setFocusId(id);
    setTick((t) => t + 1); // force re-render
  };

  if (!ready) {
    return (
      <div
        style={{
          width: "100%",
          height: "100vh",
          background: "#0D0F14",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          color: "#4FFFB0",
          fontFamily: "'Space Mono', monospace",
          fontSize: 13,
          letterSpacing: 2,
        }}
      >
        LOADING PATIENT DATA…
      </div>
    );
  }

  return (
    <div
      style={{
        width: "100%",
        height: "100vh",
        background: "#0D0F14",
        display: "flex",
        fontFamily: "'Space Mono', monospace",
        overflow: "hidden",
      }}
    >
      {/* Left Panel — 35% */}
      <div style={{ width: "35%", padding: 16, boxSizing: "border-box" }}>
        <ScatterPlot
          selectedId={focusId}
          onSelectPatient={handleSelectPatient}
        />
      </div>

      {/* Right Panel — 65% */}
      <div
        style={{
          width: "65%",
          display: "flex",
          flexDirection: "column",
          padding: "16px 16px 16px 0",
          boxSizing: "border-box",
        }}
      >
        {/* Radial Glyph — 78% */}
        <div style={{ flex: "1 1 78%", minHeight: 0, overflow: "visible" }}>
          <RadialGlyph key={focusId + tick} />
        </div>

        {/* Timeline — 22% */}
        {/* <div style={{ flex: "0 0 22%", minHeight: 120 }}>
          <TimelineChart key={focusId + tick} />
        </div> */}
      </div>
    </div>
  );
}