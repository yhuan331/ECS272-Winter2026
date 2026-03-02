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
  riskScore: number;         // raw model probability 0-1
  probDelta: number;         // Δ from previous week (0 for week 0)
  teamSize: number;          // careTeamSize
  spikeColor: string;        // red=rising / green=falling based on probDelta
  hcpCount: number;          // unique HCPs active this week
  noteFrequency: number;     // notes logged this week
  attributeSummary: string;  // top +/- SHAP feature
  hcpNames: string[];        // provider specialties active this week
  entropy: number;           // care team entropy
  topSHAP: Array<{ feature: string; contribution: number }>;
}

export const cancerColors: Record<PatientDot["cancer"], string> = {
  breast: "#0694A2",
  colon:  "#E53E3E",
  lung:   "#2B6CB0",
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
  { t: 0.0,  color: "#38A169" },
  { t: 0.3,  color: "#D69E2E" },
  { t: 0.5,  color: "#DD6B20" },
  { t: 0.75, color: "#E53E3E" },
  { t: 1.0,  color: "#9B2335" },
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

  return weekly.map((w, i) => {
    const riskScore = Math.min(1, Math.max(0, w.prob));
    // Week-over-week change — the evolution signal
    const prevProb = i > 0 ? weekly[i - 1].prob : w.prob;
    const probDelta = w.prob - prevProb;  // positive = risk rising, negative = falling

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
    const BAD = new Set(["UNKNOWN", "nan", "NaN", "null", "undefined", "", "NONE"]);
    const hcpNames = [...new Set(snapshot
      .map((h) => {
        const sp = (h.specialty ?? "").trim();
        const pt = (h.providerType ?? "").trim();
        // Prefer specialty, fall back to providerType, skip bad values
        if (sp && !BAD.has(sp)) return sp;
        if (pt && !BAD.has(pt)) return pt;
        return null;
      })
      .filter((v): v is string => v !== null)
    )];

    return {
      week:             w.week,
      riskScore,
      probDelta,
      teamSize:         w.careTeamSize,
      // Color encodes DIRECTION of change:
      //   rising  (delta > +0.5%)  → red spectrum  (alarming)
      //   falling (delta < -0.5%)  → green spectrum (improving)
      //   stable  (|delta| ≤ 0.5%) → amber (watch)
      spikeColor: (() => {
        if (probDelta > 0.005)  return riskColor(0.6 + Math.min(0.4, probDelta * 10));  // red
        if (probDelta < -0.005) return riskColor(Math.max(0, 0.3 - Math.abs(probDelta) * 8)); // green
        return riskColor(0.45); // amber = stable
      })(),
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

// ─────────────────────────────────────────────
// HCP TAXONOMY  (node_attr_vocabs.json grouping)
// ─────────────────────────────────────────────

export type HCPLevel1 =
  | "Ancillary" | "Dietary" | "Emergency Medicine" | "Family Practice"
  | "General Practice" | "Internal Medicine" | "Internal Medicine Specialty"
  | "Medical Oncology" | "Mental Health" | "Nursing" | "Pathology"
  | "Patient Support Services" | "Pediatrics" | "Pharmacy"
  | "Radiation Oncology" | "Radiology" | "Scribe" | "Specialty Other"
  | "Surgery Other" | "Surgical Oncology" | "Therapy" | "Urgent Care" | "Unknown";

const SPECIALTY_TO_L1: Record<string, HCPLevel1> = {
  "EMERGENCY MEDICINE": "Emergency Medicine", "PEDIATRIC EMERGENCY": "Emergency Medicine",
  "FAMILY PRACTICE": "Family Practice",
  "GENERAL PRACTICE": "General Practice",
  "INTERNAL MEDICINE": "Internal Medicine", "HOSPITALIST": "Internal Medicine",
  "GERIATRIC MED, INT": "Internal Medicine", "GERIATRIC MEDICINE": "Internal Medicine",
  "ALLERGY": "Internal Medicine Specialty", "ALLERGIST/IMMUNOLOGY": "Internal Medicine Specialty",
  "CARDIOLOGY": "Internal Medicine Specialty", "CARDIOVASCULAR DIS": "Internal Medicine Specialty",
  "ENDOCRINOLOGY/METABO": "Internal Medicine Specialty", "GASTROENTEROLOGY": "Internal Medicine Specialty",
  "HEMATOLOGY": "Internal Medicine Specialty", "INFECTIOUS DISEASE": "Internal Medicine Specialty",
  "NEPHROLOGY": "Internal Medicine Specialty", "PULMONARY DISEASE": "Internal Medicine Specialty",
  "RHEUMATOLOGY": "Internal Medicine Specialty",
  "HEMATOLOGY/ONCOLOGY": "Medical Oncology", "ONCOLOGY, INT": "Medical Oncology",
  "RADIATION ONCOLOGY": "Radiation Oncology",
  "PSYCHIATRY": "Mental Health", "CHILD/ADOLESCENT PSY": "Mental Health", "INTERNAL MED/PSY": "Mental Health",
  "NURSE PRACTITIONER": "Nursing", "PHYSICIAN ASSISTANT": "Nursing",
  "PATHOLOGY": "Pathology", "BLOOD BANKING": "Pathology", "DERMATOPATHOLOGY,DER": "Pathology",
  "DIAGNOSTIC RADIOLOGY": "Radiology", "NUCLEAR RADIOLOGY": "Radiology",
  "RADIOLOGY": "Radiology", "VASC/INTRVN RADIOLOG": "Radiology",
  "SURGERY": "Surgical Oncology", "SURGERY/ONCOLOGY": "Surgical Oncology",
  "GYNECOLOGIC ONCOLOGY": "Surgical Oncology", "COLON/RECTAL SURG": "Surgical Oncology",
  "CARDIOTHORACIC SURG": "Surgical Oncology", "ORTHOPAEDIC SURGERY": "Surgical Oncology",
  "PLASTIC SURGERY": "Surgical Oncology", "UROLOGY": "Surgical Oncology",
  "ANESTHESIOLOGISTS": "Surgical Oncology", "SURGERY CRIT CARE": "Surgical Oncology",
  "SURG/CARDIOVASCULAR": "Surgical Oncology", "THORACIC SURGERY": "Surgical Oncology",
  "CRIT CARE MED, ANES": "Surgical Oncology",
  "ORTHOPAEDIC TRAUMA": "Surgery Other", "HAND SURG, PLAST SUR": "Surgery Other",
  "OTOLARYNGOLOGY": "Surgery Other", "OPHTHALMOLOGY": "Surgery Other",
  "GEN VASCULAR SURG": "Surgery Other", "TRAUMA ACS": "Surgery Other",
  "TRANSPLANT SURGERY": "Surgery Other",
  "DERMATOLOGY": "Specialty Other", "NEUROLOGY": "Specialty Other",
  "OBSTETRICS/GYN": "Specialty Other", "PAIN MANAGEMENT": "Specialty Other",
  "PMR": "Specialty Other", "SPORTS MEDICINE": "Specialty Other",
  "VASCULAR MEDICINE": "Specialty Other", "CLN NEUROPHYSIOLOGY": "Specialty Other",
  "URGENT CARE": "Urgent Care",
};

const PROV_TYPE_TO_L1: Record<string, HCPLevel1> = {
  "*PHYSICIAN: RESIDENT": "Internal Medicine", "*PHYSICIAN: FELLOW": "Internal Medicine",
  "*PHYSICIAN: FACULTY": "Internal Medicine", "*PHYSICIAN: INTERN": "Internal Medicine",
  "PHYSICIAN": "Internal Medicine",
  ".NURSE: (RN OR LVN)": "Nursing", ".NURSE: CLINICAL SPECIALIST": "Nursing", "PA/NP": "Nursing",
  "PHARM TECH": "Pharmacy",
  ".DC PLNG/CASE MGMT": "Patient Support Services", "HIM (CDS)": "Patient Support Services",
};

const CLINICIAN_TITLE_TO_L1: Record<string, HCPLevel1> = {
  "MD": "Internal Medicine", "RN": "Nursing", "NP": "Nursing",
  "PHARM TECH": "Pharmacy", "PA": "Nursing", "CASE MANAGER": "Patient Support Services",
};

export function classifyHCP(specialty: string, providerType: string, clinicianTitle: string): HCPLevel1 {
  const sp = (specialty ?? "").toUpperCase().trim();
  const pt = (providerType ?? "").toUpperCase().trim();
  const ct = (clinicianTitle ?? "").toUpperCase().trim();
  return SPECIALTY_TO_L1[sp] ?? PROV_TYPE_TO_L1[pt] ?? CLINICIAN_TITLE_TO_L1[ct] ?? "Unknown";
}

export const L1_COLORS: Record<string, string> = {
  "Surgical Oncology":           "#FF6B6B",
  "Medical Oncology":            "#FF9A3C",
  "Radiation Oncology":          "#FFD166",
  "Internal Medicine Specialty": "#4FFFB0",
  "Internal Medicine":           "#6B9FFF",
  "Nursing":                     "#A78BFA",
  "Pharmacy":                    "#F472B6",
  "Radiology":                   "#38BDF8",
  "Patient Support Services":    "#34D399",
  "Pathology":                   "#FB923C",
  "Surgery Other":               "#F87171",
  "Specialty Other":             "#94A3B8",
  "Mental Health":               "#C084FC",
  "Therapy":                     "#86EFAC",
  "Emergency Medicine":          "#FCA5A5",
  "Family Practice":             "#FDE68A",
  "General Practice":            "#D9F99D",
  "Pediatrics":                  "#FBB6CE",
  "Urgent Care":                 "#E9D5FF",
  "Ancillary":                   "#CBD5E1",
  "Dietary":                     "#D1FAE5",
  "Scribe":                      "#E2E8F0",
  "Unknown":                     "#334155",
};

// Build treemap data from a list of HCP snapshots
export interface TreeLeaf { name: string; value: number; color: string; specialty: string; }
export interface TreeGroup { name: string; value: number; color: string; children: TreeLeaf[]; }

export function buildHCPTree(
  snapshots: Array<{ specialty: string; providerType: string; clinicianTitle?: string }>
): TreeGroup[] {
  const groups: Record<string, Record<string, number>> = {};
  for (const h of snapshots) {
    const l1 = classifyHCP(h.specialty, h.providerType, h.clinicianTitle ?? "");
    const BAD_V = new Set(["UNKNOWN", "nan", "NaN", "null", "undefined", "", "NONE"]);
    const rawSp = (h.specialty ?? "").trim();
    const rawPt = (h.providerType ?? "").trim();
    const sp = (!BAD_V.has(rawSp) && rawSp) ? rawSp : ((!BAD_V.has(rawPt) && rawPt) ? rawPt : "Unknown");
    if (!groups[l1]) groups[l1] = {};
    groups[l1][sp] = (groups[l1][sp] ?? 0) + 1;
  }
  return Object.entries(groups)
    .map(([l1, specs]) => ({
      name: l1,
      value: Object.values(specs).reduce((a, b) => a + b, 0),
      color: L1_COLORS[l1] ?? "#334155",
      children: Object.entries(specs).map(([sp, count]) => ({
        name: sp, value: count, color: L1_COLORS[l1] ?? "#334155", specialty: sp,
      })).sort((a, b) => b.value - a.value),
    }))
    .sort((a, b) => b.value - a.value);
}

// ── Summary stats for WeekInfoPanel ──────────────────────────────────────────
export function getPatientSummary() {
  const avgRiskAll = weeklyData.length
    ? ((weeklyData.reduce((s, d) => s + d.riskScore, 0) / weeklyData.length) * 100).toFixed(1)
    : "0";
  const peakWeek = weeklyData.length
    ? weeklyData.reduce((max, d) => d.riskScore > max.riskScore ? d : max, weeklyData[0])
    : null;
  const totalNotes = weeklyData.reduce((s, d) => s + d.noteFrequency, 0);
  const avgNotes = weeklyData.length ? (totalNotes / weeklyData.length).toFixed(1) : "0";
  return { avgRiskAll, peakWeek, avgNotes };
}