/**
 * realData.ts
 *
 * Drop-in replacement for mockData.ts
 * Sources:
 *   - temporal_networks.json  → patient cohort (ScatterPlot)
 *   - full_va_export_with_ego.json → weekly timeline (RadialGlyph + TimelineChart)
 *
 * USAGE in your components — replace:
 *   import { ... } from './mockData';
 * with:
 *   import { ... } from './realData';
 *
 * Then call initRealData() once in main.tsx / App.tsx before rendering:
 *   import { initRealData } from './realData';
 *   await initRealData();
 */

// ─────────────────────────────────────────────
// TYPES (keep same shape as mockData for drop-in compat)
// ─────────────────────────────────────────────

export interface PatientDot {
  id: string;
  x: number;       // network density 0-1  (edge_counter / max_edges)
  y: number;       // avg risk score 0-1   (mean of weekly prob)
  cancer: "breast" | "colon" | "lung";
  survived: boolean;
  weeks: number;   // number of weekly records
  avgRisk: number; // percentage 0-100
  maxTeam: number; // max careTeamSize across weeks
  density: number; // edge_counter / node_counter, 0-100
}

export interface WeekData {
  week: number;
  riskScore: number;         // 0-1 normalized within patient range (for visuals)
  rawProb: number;           // raw model probability (for display)
  teamSize: number;          // careTeamSize
  spikeColor: string;        // interpolated from risk gradient
  hcpCount: number;          // unique HCPs active this week
  noteFrequency: number;     // notes logged this week
  attributeSummary: string;  // top +/- SHAP feature
  hcpNames: string[];        // provider specialties active this week
  entropy: number;           // care team entropy
  topSHAP: Array<{ feature: string; contribution: number }>;
}

export const cancerColors: Record<PatientDot["cancer"], string> = {
  breast: "#4FFFB0",
  colon:  "#FF6B6B",
  lung:   "#6B9FFF",
};

// ─────────────────────────────────────────────
// MODULE STATE  (populated by initRealData)
// ─────────────────────────────────────────────

export let patients:          PatientDot[] = [];
export let weeklyData:        WeekData[]   = [];
export let surgeonEvents:     number[]     = [];
export let totalPatientHCP:   number       = 0;
export let selectedPatientId: string       = "";

// ─────────────────────────────────────────────
// COLOR HELPERS
// ─────────────────────────────────────────────

function lerpColor(a: string, b: string, t: number): string {
  const parse = (h: string, o: number) => parseInt(h.slice(o, o + 2), 16);
  const r = Math.round(parse(a,1) + (parse(b,1) - parse(a,1)) * t);
  const g = Math.round(parse(a,3) + (parse(b,3) - parse(a,3)) * t);
  const bl= Math.round(parse(a,5) + (parse(b,5) - parse(a,5)) * t);
  return `#${r.toString(16).padStart(2,"0")}${g.toString(16).padStart(2,"0")}${bl.toString(16).padStart(2,"0")}`;
}

const RISK_GRADIENT = [
  { t: 0.0,  color: "#6BC96B" },
  { t: 0.3,  color: "#C8D966" },
  { t: 0.45, color: "#FFD166" },
  { t: 0.6,  color: "#FF9A3C" },
  { t: 0.75, color: "#FF4757" },
  { t: 1.0,  color: "#FF4757" },
];

function riskColor(t: number): string {
  const stops = RISK_GRADIENT;
  if (t <= stops[0].t) return stops[0].color;
  if (t >= stops[stops.length - 1].t) return stops[stops.length - 1].color;
  for (let i = 0; i < stops.length - 1; i++) {
    if (t >= stops[i].t && t <= stops[i + 1].t) {
      const ratio = (t - stops[i].t) / (stops[i + 1].t - stops[i].t);
      return lerpColor(stops[i].color, stops[i + 1].color, ratio);
    }
  }
  return stops[0].color;
}

// ─────────────────────────────────────────────
// TEMPORAL NETWORKS HELPERS
// ─────────────────────────────────────────────

/**
 * temporal_networks.json shape (per patient key):
 * {
 *   patient_info: [...array, index 20 = "ALIVE"|other, index 2 = cancer],
 *   cancer: "COLON"|"BREAST"|"LUNG",
 *   stage: "2A" etc,
 *   node_counter: number,
 *   edge_counter: number,
 *   node_prov: { [hashId]: weekNumber },   // HCP hash → week first appeared
 *   node_note: { [noteId]: weekNumber },   // note id  → week
 *   edge_list: [[src,tgt], ...],
 *   edge_time: { "(src, tgt)": [timestamps] }
 * }
 */

type TemporalRecord = {
  patient_info: (string | number | null)[];
  cancer: string;
  stage: string;
  node_counter: number;
  edge_counter: number;
  node_prov: Record<string, number>;
  node_note: Record<string, number>;
  edge_list: [number, number][];
  edge_time: Record<string, number[]>;
};

type EgoWeek = {
  week: number;
  prob: number;
  careTeamSize: number;
  entropy: number;
  topAttributesSHAP: Array<{ feature: string; contribution: number }>;
  weeklyHCPSnapshot: Array<{ specialty: string; providerType: string }>;
};

type EgoRecord = {
  id: string;
  cohort: string;
  riskDelta: number;
  weekly: EgoWeek[];
};

// ─────────────────────────────────────────────
// SURGERY EVENT DETECTION
// ─────────────────────────────────────────────

/**
 * A week is a "surgeon event" if any SHAP feature
 * related to SURGERY has a positive contribution ≥ threshold,
 * OR if a surgeon specialty appears in the HCP snapshot.
 */
function detectSurgeonWeeks(weekly: EgoWeek[]): number[] {
  const SURGERY_KEYWORDS = ["SURGERY", "SURGICAL", "SURG", "SURGEON"];
  const SHAP_THRESHOLD = 0.003;

  return weekly
    .filter((w) => {
      // Check SHAP features
      const shapHit = w.topAttributesSHAP.some(
        (s) =>
          s.contribution >= SHAP_THRESHOLD &&
          SURGERY_KEYWORDS.some((kw) => s.feature.toUpperCase().includes(kw))
      );
      // Check HCP snapshot
      const hcpHit = w.weeklyHCPSnapshot?.some((h) =>
        SURGERY_KEYWORDS.some(
          (kw) =>
            h.specialty?.toUpperCase().includes(kw) ||
            h.providerType?.toUpperCase().includes(kw)
        )
      );
      return shapHit || hcpHit;
    })
    .map((w) => w.week);
}

// ─────────────────────────────────────────────
// BUILD WeekData[] FROM ego record
// ─────────────────────────────────────────────

function buildWeeklyData(
  egoRecord: EgoRecord,
  temporalRecord: TemporalRecord | null
): WeekData[] {
  const { weekly } = egoRecord;

  // Build note-per-week map from temporal_networks node_note
  const notesByWeek: Record<number, number> = {};
  if (temporalRecord?.node_note) {
    for (const week of Object.values(temporalRecord.node_note)) {
      notesByWeek[week] = (notesByWeek[week] ?? 0) + 1;
    }
  }

  const hcpSpecByWeek: Record<number, string[]> = {};
  if (temporalRecord?.node_prov) {
    for (const [_hash, week] of Object.entries(temporalRecord.node_prov)) {
      if (!hcpSpecByWeek[week]) hcpSpecByWeek[week] = [];
    }
  }

  // Normalize risk per-patient so the full color gradient is always used
  // Raw probs are typically in a narrow band (e.g. 0.3–0.5); normalizing
  // makes relative changes visible in the radial spike heights and colors
  const rawProbs = weekly.map((w) => w.prob).filter(Number.isFinite);
  const minProb = Math.min(...rawProbs);
  const maxProb = Math.max(...rawProbs);
  const probRange = maxProb - minProb || 0.001;

  return weekly.map((w) => {
    // Normalized 0-1 within this patient's own risk range
    const riskNorm = Math.min(1, Math.max(0, (w.prob - minProb) / probRange));
    // Keep raw prob for display purposes
    const riskScore = riskNorm;

    // Top positive and negative SHAP features → readable summary
    const shap = w.topAttributesSHAP ?? [];
    const topPos = shap
      .filter((s) => s.contribution > 0)
      .sort((a, b) => b.contribution - a.contribution)[0];
    const topNeg = shap
      .filter((s) => s.contribution < 0)
      .sort((a, b) => a.contribution - b.contribution)[0];

    const formatFeature = (f: string) => {
      // "ACCESS_USER_PROV_TYPE::*PHYSICIAN: RESIDENT::present" → "Physician Resident"
      const parts = f.split("::");
      const middle = parts[1] ?? f;
      return middle
        .replace(/^\*/, "")
        .replace(/_/g, " ")
        .replace(/\b\w/g, (c) => c.toUpperCase())
        .trim();
    };

    let attributeSummary = "";
    if (topPos)
      attributeSummary += `↑ ${formatFeature(topPos.feature)} (+${(topPos.contribution * 100).toFixed(1)}%)`;
    if (topNeg)
      attributeSummary += `${topPos ? "  " : ""}↓ ${formatFeature(topNeg.feature)} (${(topNeg.contribution * 100).toFixed(1)}%)`;
    if (!attributeSummary) attributeSummary = "No significant attributes";

    // HCP names from weeklyHCPSnapshot
    const snapshot = w.weeklyHCPSnapshot ?? [];
    const hcpNames = snapshot
      .map((h) => h.specialty && h.specialty !== "UNKNOWN" ? h.specialty : h.providerType)
      .filter(Boolean)
      .filter((v) => v !== "UNKNOWN");

    return {
      week:             w.week,
      riskScore,
      rawProb:          w.prob,
      teamSize:         w.careTeamSize,
      spikeColor:       riskColor(riskScore),
      hcpCount:         snapshot.length || w.careTeamSize,
      noteFrequency:    notesByWeek[w.week] ?? 0,
      attributeSummary,
      hcpNames,
      entropy:          w.entropy,
      topSHAP:          shap.slice(0, 10),
    };
  });
}

// ─────────────────────────────────────────────
// BUILD PatientDot[] FROM temporal_networks + ego
// ─────────────────────────────────────────────

function normalizeCancer(raw: string): PatientDot["cancer"] {
  const up = raw.toUpperCase();
  if (up.includes("BREAST")) return "breast";
  if (up.includes("LUNG") || up.includes("BRONCH")) return "lung";
  return "colon"; // colon / rectum / colorectal → colon
}

function buildPatients(
  temporal: Record<string, TemporalRecord>,
  ego: Record<string, EgoRecord>
): PatientDot[] {
  const allEdgeCounts = Object.values(temporal).map((r) => r.edge_counter);
  const maxEdges = Math.max(...allEdgeCounts, 1);
  const allNodeCounts = Object.values(temporal).map((r) => r.node_counter);
  const maxNodes = Math.max(...allNodeCounts, 1);

  // Compute avg prob per patient from ego weekly
  const avgProbs: Record<string, number> = {};
  for (const [id, rec] of Object.entries(ego)) {
    const probs = rec.weekly.map((w) => w.prob).filter(Number.isFinite);
    avgProbs[id] = probs.length ? probs.reduce((a, b) => a + b, 0) / probs.length : 0.5;
  }
  const allProbs = Object.values(avgProbs);
  const maxProb = Math.max(...allProbs, 1);
  const minProb = Math.min(...allProbs, 0);
  const probRange = maxProb - minProb || 1;

  const dots: PatientDot[] = [];

  for (const [id, rec] of Object.entries(temporal)) {
    const egoRec = ego[id];
    const cancer = normalizeCancer(rec.cancer ?? "colon");

    // survived: patient_info[20] === "ALIVE"
    const survived =
      Array.isArray(rec.patient_info) &&
      typeof rec.patient_info[20] === "string" &&
      (rec.patient_info[20] as string).trim().toUpperCase() === "ALIVE";

    // x = node_counter (unique HCPs) normalized — better spread than edge_counter
    const x = Math.min(1, rec.node_counter / maxNodes);

    // y = avg risk score normalized to 0-1 for scatter positioning
    const avgProb = avgProbs[id] ?? 0.5;
    const y = (avgProb - minProb) / probRange;

    // weeks = number of weekly records
    const weeks = egoRec?.weekly?.length ?? 0;

    // avgRisk as percentage
    const avgRisk = Math.round(avgProb * 1000) / 10;

    // maxTeam = max careTeamSize
    const maxTeam = egoRec
      ? Math.max(...egoRec.weekly.map((w) => w.careTeamSize), 0)
      : rec.node_counter;

    // density = edge_counter / node_counter * 100, capped at 100
    const density =
      Math.round(
        Math.min(100, (rec.edge_counter / Math.max(rec.node_counter, 1)) * 100) * 10
      ) / 10;

    dots.push({ id, x, y, cancer, survived, weeks, avgRisk, maxTeam, density });
  }

  return dots;
}

// ─────────────────────────────────────────────
// MAIN INIT — call once before rendering
// ─────────────────────────────────────────────

/**
 * Call this in main.tsx / App.tsx before first render:
 *
 *   import { initRealData } from './realData';
 *   await initRealData();         // uses default paths
 *
 * Or with custom paths:
 *   await initRealData('/data/temporal_networks.json', '/data/full_va_export_with_ego.json');
 *
 * After this resolves, all exported arrays (patients, weeklyData, etc.)
 * are populated and components can render.
 */
/** Fetch JSON with NaN/Infinity stripped (Python json dumps artefacts) */
async function fetchJSON(path: string): Promise<unknown> {
  const text = await fetch(path).then((r) => r.text());
  // Replace bare NaN / Infinity / -Infinity with null
  // Replace Python-emitted NaN/Infinity in any position (array elem, value, etc.)
  const clean = text
    .replace(/\bNaN\b/g, "null")
    .replace(/-Infinity\b/g, "null")
    .replace(/\bInfinity\b/g, "null");
  return JSON.parse(clean);
}

export async function initRealData(
  temporalPath = "/temporal_networks.json",
  egoPath      = "/full_va_export_with_ego.json",
  focusPatientId?: string,
): Promise<void> {
  const [temporalRaw, egoRaw] = await Promise.all([
    fetchJSON(temporalPath),
    fetchJSON(egoPath),
  ]);

  const temporal = temporalRaw as Record<string, TemporalRecord>;
  // ego file is either an array or a dict
  let egoMap: Record<string, EgoRecord>;
  if (Array.isArray(egoRaw)) {
    egoMap = {};
    for (const rec of egoRaw as EgoRecord[]) {
      egoMap[rec.id] = rec;
    }
  } else {
    egoMap = egoRaw as Record<string, EgoRecord>;
  }

  // Build cohort scatter data
  patients.length = 0;
  patients.push(...buildPatients(temporal, egoMap));

  // Pick focus patient: use provided id, or first patient in ego that has weekly data
  const defaultFocus =
    focusPatientId ??
    Object.keys(egoMap).find((id) => egoMap[id].weekly?.length > 0) ??
    patients[0]?.id ??
    "";

  selectedPatientId = defaultFocus;

  // Build weekly data for the selected patient
  const selectedEgo = egoMap[selectedPatientId];
  const selectedTemporal = temporal[selectedPatientId] ?? null;

  weeklyData.length = 0;
  if (selectedEgo?.weekly?.length) {
    weeklyData.push(...buildWeeklyData(selectedEgo, selectedTemporal));
  }

  // Surgeon events
  surgeonEvents.length = 0;
  if (selectedEgo?.weekly) {
    surgeonEvents.push(...detectSurgeonWeeks(selectedEgo.weekly));
  }

  // Total unique HCPs across the patient's entire record
  totalPatientHCP = selectedTemporal?.node_counter ?? selectedEgo?.weekly?.reduce(
    (max, w) => Math.max(max, w.weeklyHCPSnapshot?.length ?? 0), 0
  ) ?? 0;
}

// ─────────────────────────────────────────────
// SWITCH SELECTED PATIENT  (for interactivity)
// ─────────────────────────────────────────────

/**
 * Call this when the user clicks a dot in the scatter plot.
 * Pass the same temporal + ego objects you fetched in initRealData.
 * Re-exports are updated in-place so components re-render if you use state.
 */
export function switchPatient(
  patientId: string,
  temporal: Record<string, unknown>,
  egoMap: Record<string, EgoRecord>,
): void {
  selectedPatientId = patientId;
  const egoRec = egoMap[patientId];
  const tempRec = (temporal[patientId] ?? null) as TemporalRecord | null;

  weeklyData.length = 0;
  if (egoRec?.weekly?.length) {
    weeklyData.push(...buildWeeklyData(egoRec, tempRec));
  }

  surgeonEvents.length = 0;
  if (egoRec?.weekly) {
    surgeonEvents.push(...detectSurgeonWeeks(egoRec.weekly));
  }

  totalPatientHCP = tempRec?.node_counter ?? egoRec?.weekly?.reduce(
    (max, w) => Math.max(max, w.weeklyHCPSnapshot?.length ?? 0), 0
  ) ?? 0;
}