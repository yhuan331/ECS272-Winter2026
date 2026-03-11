/**
 * realData.ts — enhanced with:
 *  - globalMaxWeeks: computed dynamically across all patients
 *  - compareWeeklyData / compareSurgeonEvents / compareTotalHCP: for side-by-side compare
 *  - getPatientById(): lookup helper
 *  - switchComparePatient() / clearComparePatient()
 */

import { SPECIALTY_COLORS } from "./theme";

export interface PatientDot {
  id: string;
  x: number;
  y: number;
  cancer: "breast" | "colon" | "lung";
  survived: boolean;
  weeks: number;
  avgRisk: number;
  maxTeam: number;
  density: number;
}

export interface WeekData {
  week: number;
  riskScore: number;
  probDelta: number;
  teamSize: number;
  spikeColor: string;
  hcpCount: number;
  noteFrequency: number;
  attributeSummary: string;
  hcpNames: string[];
  entropy: number;
  topSHAP: Array<{ feature: string; contribution: number }>;
  // Full surrogate data — feature, surrogate weight, value, contribution
  topContrib: Array<{ feature: string; contribution: number; weight: number; value: number }>;
}

export const cancerColors: Record<PatientDot["cancer"], string> = {
  breast: "#0694A2",
  colon:  "#E53E3E",
  lung:   "#2B6CB0",
};

const NOTE_PREFIXES = new Set(["METRIC_DESC", "METRIC_GROUP", "METRIC_LOG_TYPE_C"]);

// ─────────────────────────────────────────────
// MODULE STATE
// ─────────────────────────────────────────────

export let patients:             PatientDot[] = [];
export let weeklyData:           WeekData[]   = [];
export let surgeonEvents:        number[]     = [];
export let totalPatientHCP:      number       = 0;
export let selectedPatientId:    string       = "";

// Compare patient state
export let compareWeeklyData:    WeekData[]   = [];
export let compareSurgeonEvents: number[]     = [];
export let compareTotalHCP:      number       = 0;
export let comparePatientId:     string       = "";

// Global max weeks across all patients (for radial glyph arc cap)
export let globalMaxWeeks: number = 1;

// ── Raw record caches (for EgoNetwork component) ──────────────────────────────
let _egoMapCache:        Record<string, EgoRecord>            = {};
let _temporalMapCache:   Record<string, TemporalRecord>       = {};
let _egoNetworkCache:    Record<string, EgoNetworkRecord>     = {};

// Shape of a record from ego_network.json
export type EgoNetworkRecord = {
  patientNodeId: string;
  cancer:        string;
  stage:         string;
  vital_status:  string;
  weeklySnapshots: Record<string, { nodes: Record<string, unknown>[]; edges: Record<string, unknown>[] }>;
};

// Merged view returned to EgoNetwork component:
// weekly + riskDelta come from full_va_export_with_linear.json (EgoRecord)
// weeklySnapshots comes from ego_network.json (EgoNetworkRecord)
export type MergedEgoRecord = EgoRecord & {
  weeklySnapshots: EgoNetworkRecord["weeklySnapshots"];
};

export function getEgoRecord(id: string): MergedEgoRecord | null {
  const linear = _egoMapCache[id];
  if (!linear) return null;
  const net = _egoNetworkCache[id];
  return { ...linear, weeklySnapshots: net?.weeklySnapshots ?? {} };
}
export function getTemporalRecord(id: string): TemporalRecord | null {
  return _temporalMapCache[id] ?? null;
}

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
// TYPES
// ─────────────────────────────────────────────

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
  probDelta: number;
  teamSize: number;
  entropy: number;
  topContrib: Array<{
    feature: string;
    contribution: number;
    weight: number;
    value: number;
  }>;
  weeklyHCPSnapshot: Array<{ specialty: string; providerType: string; clinicianTitle: string }>;
};

type EgoRecord = {
  id: string;
  cohort: string;
  riskDelta: number;
  weekly: EgoWeek[];
};

// ─────────────────────────────────────────────
// SURGEON DETECTION
// ─────────────────────────────────────────────

function detectSurgeonWeeks(weekly: EgoWeek[]): number[] {
  const SURGERY_KEYWORDS = ["SURGERY", "SURGICAL", "SURG", "SURGEON"];
  const SHAP_THRESHOLD = 0.003;
  return weekly
    .filter((w) => {
      const shapHit = (w.topContrib ?? []).some(
        (s) => s.contribution >= SHAP_THRESHOLD &&
          SURGERY_KEYWORDS.some((kw) => s.feature.toUpperCase().includes(kw))
      );
      const hcpHit = w.weeklyHCPSnapshot?.some((h) =>
        SURGERY_KEYWORDS.some(
          (kw) => h.specialty?.toUpperCase().includes(kw) ||
            h.providerType?.toUpperCase().includes(kw)
        )
      );
      return shapHit || hcpHit;
    })
    .map((w) => w.week);
}

// ─────────────────────────────────────────────
// BUILD WeekData[]
// ─────────────────────────────────────────────

function buildWeeklyData(
  egoRecord: EgoRecord,
  temporalRecord: TemporalRecord | null
): WeekData[] {
  const { weekly } = egoRecord;

  const notesByWeek: Record<number, number> = {};
  if (temporalRecord?.node_note) {
    for (const week of Object.values(temporalRecord.node_note)) {
      notesByWeek[week] = (notesByWeek[week] ?? 0) + 1;
    }
  }

  return weekly.map((w, i) => {
    const riskScore = Math.min(1, Math.max(0, w.prob));
    const prevProb = i > 0 ? weekly[i - 1].prob : w.prob;
    const probDelta = w.prob - prevProb;

    const shap = w.topContrib ?? [];
    const topPos = shap.filter((s) => s.contribution > 0).sort((a, b) => b.contribution - a.contribution)[0];
    const topNeg = shap.filter((s) => s.contribution < 0).sort((a, b) => a.contribution - b.contribution)[0];

    const formatFeature = (f: string) => {
      const parts = f.split("::");
      const middle = parts[1] ?? f;
      return middle.replace(/^\*/, "").replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()).trim();
    };

    let attributeSummary = "";
    if (topPos) attributeSummary += `↑ ${formatFeature(topPos.feature)} (+${(topPos.contribution * 100).toFixed(1)}%)`;
    if (topNeg) attributeSummary += `${topPos ? "  " : ""}↓ ${formatFeature(topNeg.feature)} (${(topNeg.contribution * 100).toFixed(1)}%)`;
    if (!attributeSummary) attributeSummary = "No significant attributes";

    const snapshot = w.weeklyHCPSnapshot ?? [];
    const BAD = new Set(["UNKNOWN", "nan", "NaN", "null", "undefined", "", "NONE"]);
    const hcpNames = [...new Set(snapshot
      .map((h) => {
        const sp = (h.specialty ?? "").trim();
        const pt = (h.providerType ?? "").trim();
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
      teamSize: w.teamSize,
      spikeColor: (() => {
        if (probDelta > 0.005)  return riskColor(0.6 + Math.min(0.4, probDelta * 10));
        if (probDelta < -0.005) return riskColor(Math.max(0, 0.3 - Math.abs(probDelta) * 8));
        return riskColor(0.45);
      })(),
      hcpCount:         snapshot.length || w.teamSize,
      noteFrequency:    notesByWeek[w.week] ?? 0,
      attributeSummary,
      hcpNames,
      entropy:          w.entropy,
      topSHAP:          shap.slice(0, 10),
      topContrib:       (w.topContrib ?? [])
        .filter(c => !NOTE_PREFIXES.has(c.feature.split("::")[0]))
        .sort((a, b) => Math.abs(b.contribution) - Math.abs(a.contribution))
        .slice(0, 20),
    };
  });
}

// ─────────────────────────────────────────────
// BUILD PatientDot[]
// ─────────────────────────────────────────────

function normalizeCancer(raw: string): PatientDot["cancer"] {
  const up = raw.toUpperCase();
  if (up.includes("BREAST")) return "breast";
  if (up.includes("LUNG") || up.includes("BRONCH")) return "lung";
  return "colon";
}

function buildPatients(
  temporal: Record<string, TemporalRecord>,
  ego: Record<string, EgoRecord>
): PatientDot[] {
  const allEdgeCounts = Object.values(temporal).map((r) => r.edge_counter);
  const maxEdges = Math.max(...allEdgeCounts, 1);
  void maxEdges;
  const allNodeCounts = Object.values(temporal).map((r) => r.node_counter);
  const maxNodes = Math.max(...allNodeCounts, 1);

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
    const survived =
      Array.isArray(rec.patient_info) &&
      typeof rec.patient_info[20] === "string" &&
      (rec.patient_info[20] as string).trim().toUpperCase() === "ALIVE";

    const x = Math.min(1, rec.node_counter / maxNodes);
    const avgProb = avgProbs[id] ?? 0.5;
    const y = (avgProb - minProb) / probRange;
    const weeks = egoRec?.weekly?.length ?? 0;
    const avgRisk = Math.round(avgProb * 1000) / 10;
    const maxTeam = egoRec
      ? Math.max(...egoRec.weekly.map((w) => w.teamSize), 0)
      : rec.node_counter;
    const density = Math.round(Math.min(100, (rec.edge_counter / Math.max(rec.node_counter, 1)) * 100) * 10) / 10;

    dots.push({ id, x, y, cancer, survived, weeks, avgRisk, maxTeam, density });
  }

  return dots;
}

// ─────────────────────────────────────────────
// FETCH HELPER
// ─────────────────────────────────────────────

async function fetchJSON(path: string): Promise<unknown> {
  const text = await fetch(path).then((r) => r.text());
  const clean = text
    .replace(/\bNaN\b/g, "null")
    .replace(/-Infinity\b/g, "null")
    .replace(/\bInfinity\b/g, "null");
  return JSON.parse(clean);
}

// ─────────────────────────────────────────────
// INIT
// ─────────────────────────────────────────────

export async function initRealData(
  temporalPath   = "/temporal_networks.json",
  egoPath        = "/full_va_export_with_linear.json",
  egoNetworkPath = "/ego_network.json",
  focusPatientId?: string,
): Promise<void> {
  const [temporalRaw, egoRaw, egoNetRaw] = await Promise.all([
    fetchJSON(temporalPath),
    fetchJSON(egoPath),
    fetchJSON(egoNetworkPath),
  ]);

  const temporal = temporalRaw as Record<string, TemporalRecord>;
  let egoMap: Record<string, EgoRecord>;
  if (Array.isArray(egoRaw)) {
    egoMap = {};
    for (const rec of egoRaw as EgoRecord[]) egoMap[rec.id] = rec;
  } else {
    egoMap = egoRaw as Record<string, EgoRecord>;
  }

  // ego_network.json is already keyed by patient ID
  const egoNetwork = egoNetRaw as Record<string, EgoNetworkRecord>;

  patients.length = 0;
  patients.push(...buildPatients(temporal, egoMap));

  // ── Cache raw records for EgoNetwork component ──
  _egoMapCache      = egoMap;
  _temporalMapCache = temporal;
  _egoNetworkCache  = egoNetwork;

  // ── Compute globalMaxWeeks across ALL patients ──
  let maxW = 1;
  for (const rec of Object.values(egoMap)) {
    if (rec.weekly?.length > maxW) maxW = rec.weekly.length;
  }
  globalMaxWeeks = maxW;

  const defaultFocus =
    focusPatientId ??
    Object.keys(egoMap).find((id) => egoMap[id].weekly?.length > 0) ??
    patients[0]?.id ?? "";

  selectedPatientId = defaultFocus;

  const selectedEgo = egoMap[selectedPatientId];
  const selectedTemporal = temporal[selectedPatientId] ?? null;

  weeklyData.length = 0;
  if (selectedEgo?.weekly?.length) {
    weeklyData.push(...buildWeeklyData(selectedEgo, selectedTemporal));
  }

  surgeonEvents.length = 0;
  if (selectedEgo?.weekly) {
    surgeonEvents.push(...detectSurgeonWeeks(selectedEgo.weekly));
  }

  totalPatientHCP = selectedTemporal?.node_counter ?? selectedEgo?.weekly?.reduce(
    (max, w) => Math.max(max, w.weeklyHCPSnapshot?.length ?? 0), 0
  ) ?? 0;
}

// ─────────────────────────────────────────────
// SWITCH SELECTED PATIENT
// ─────────────────────────────────────────────

export function switchPatient(
  patientId: string,
  temporal: Record<string, unknown>,
  egoMap: Record<string, EgoRecord>,
): void {
  selectedPatientId = patientId;
  const egoRec  = egoMap[patientId];
  const tempRec = (temporal[patientId] ?? null) as TemporalRecord | null;

  weeklyData.length = 0;
  if (egoRec?.weekly?.length) weeklyData.push(...buildWeeklyData(egoRec, tempRec));

  surgeonEvents.length = 0;
  if (egoRec?.weekly) surgeonEvents.push(...detectSurgeonWeeks(egoRec.weekly));

  totalPatientHCP = tempRec?.node_counter ?? egoRec?.weekly?.reduce(
    (max, w) => Math.max(max, w.weeklyHCPSnapshot?.length ?? 0), 0
  ) ?? 0;
}

// ─────────────────────────────────────────────
// COMPARE PATIENT
// ─────────────────────────────────────────────

export function switchComparePatient(
  patientId: string,
  temporal: Record<string, unknown>,
  egoMap: Record<string, EgoRecord>,
): void {
  comparePatientId = patientId;
  const egoRec  = egoMap[patientId];
  const tempRec = (temporal[patientId] ?? null) as TemporalRecord | null;

  compareWeeklyData.length = 0;
  if (egoRec?.weekly?.length) compareWeeklyData.push(...buildWeeklyData(egoRec, tempRec));

  compareSurgeonEvents.length = 0;
  if (egoRec?.weekly) compareSurgeonEvents.push(...detectSurgeonWeeks(egoRec.weekly));

  compareTotalHCP = tempRec?.node_counter ?? egoRec?.weekly?.reduce(
    (max, w) => Math.max(max, w.weeklyHCPSnapshot?.length ?? 0), 0
  ) ?? 0;
}

export function clearComparePatient(): void {
  comparePatientId = "";
  compareWeeklyData.length = 0;
  compareSurgeonEvents.length = 0;
  compareTotalHCP = 0;
}

// ─────────────────────────────────────────────
// LOOKUP HELPERS
// ─────────────────────────────────────────────

export function getPatientById(id: string): PatientDot | undefined {
  return patients.find((p) => p.id === id);
}

// ─────────────────────────────────────────────
// SUMMARY STATS
// ─────────────────────────────────────────────

export function getPatientSummary(data?: WeekData[]) {
  const d = data ?? weeklyData;
  const avgRiskAll = d.length
    ? ((d.reduce((s, w) => s + w.riskScore, 0) / d.length) * 100).toFixed(1)
    : "0";
  const peakWeek = d.length
    ? d.reduce((max, w) => w.riskScore > max.riskScore ? w : max, d[0])
    : null;
  const totalNotes = d.reduce((s, w) => s + w.noteFrequency, 0);
  const avgNotes = d.length ? (totalNotes / d.length).toFixed(1) : "0";
  return { avgRiskAll, peakWeek, avgNotes };
}

// ─────────────────────────────────────────────
// HCP TAXONOMY — strictly mirrors EgoNetwork LEVEL1_GROUPS
// Same keys, labels, colors, and terms. Single source logic.
// ─────────────────────────────────────────────

export type HCPLevel1 =
  | "Ancillary" | "Dietary" | "Emergency Medicine" | "Family Practice"
  | "General Practice" | "Internal Medicine" | "Int. Med. Specialty"
  | "Medical Oncology" | "Mental Health" | "Nursing" | "Pathology"
  | "Patient Support" | "Pediatrics" | "Pharmacy"
  | "Radiation Oncology" | "Radiology" | "Scribe" | "Specialty Other"
  | "Surgery Other" | "Surgical Oncology" | "Therapy" | "Urgent Care" | "Unknown";

// ── Canonical group definitions — MUST stay in sync with EgoNetwork LEVEL1_GROUPS ──
const CANON_GROUPS: Array<{ label: HCPLevel1; terms: string[] }> = [
  { label: "Ancillary",          terms: ["acupuncture","audiologist","chaplain","clinical research coordinator","cpt","health coach","home health aide","technician","tech","audiology","health educator","sonographer","spiritual care"] },
  { label: "Dietary",            terms: ["dietetic asst","dietetic intern","dietician","nutrition","rd","registered dietician"] },
  { label: "Emergency Medicine", terms: ["emergency medicine","geriatric emergency medicine","pediatric emergency"] },
  { label: "Family Practice",    terms: ["family practice"] },
  { label: "General Practice",   terms: ["general practice","gen prevent med","preventative medicine","preventive medicine"] },
  { label: "Internal Medicine",  terms: ["geriatric med, int","hospitalist","internal medicine","geriatric medicine","medicine"] },
  { label: "Int. Med. Specialty",terms: ["allergy","allergist","immunology","cardiology","cardiovascular dis","critical care med","endocrinology/metabo","gastroenterology","hematology","infectious disease","intervent cardiology","interventional cardiology","nephrology","pulmonary disease","rheumatology","adult congenital heart","cardiac electrophysiology","critical care","endocrinology","heart failure","hepatology","pulmonary medicine"] },
  { label: "Medical Oncology",   terms: ["hematology/oncology","hospice","medical oncology","oncology, int","palliative medicine","bone marrow transplant","neuro oncology","oncology"] },
  { label: "Mental Health",      terms: ["addiction psych","child/adolescent psy","clinic psychologist","internal medicine/psy","psychiatry","psychology","psych tech","psychology intern","psychology trainee","marriage and family therapist","neuropsychology"] },
  { label: "Nursing",            terms: ["husc","registered nurse","rn","lvn","mosc","nurse practitioner","np","nursing","physician assistant","unit service coordinator","transition nurse specialist","pa/np"] },
  { label: "Pathology",          terms: ["clinical laboratory scientist","ct (ascp)","cytotech","anatomic pathology","anatomic/cln path","blood banking","clinical pathology","cytopathology","cytotechnologist","dermatopathology","gross assistant","histotech","hospital laboratory technician","hlt","hcla","hematopathology","lab tech","pathology","pathology molecular genetic","pa(ascp)","pathologists","sct (ascp)"] },
  { label: "Patient Support",    terms: ["case manager","case manager assistant","health services navigator","dc plng/case mgmt","licensed clinical social worker","lcsw","msw","patient navigator","social worker","social work intern","care coordinator","care management associate"] },
  { label: "Pediatrics",         terms: ["pediatrics","neo/perinatal med","pediatrics/allergy","pediatric hematology","ped infectious dis","neonatology","pediatric dermatology","pediatric neurology"] },
  { label: "Pharmacy",           terms: ["pharm intern","pharm resident","pharm tech","pharmacist","pharmd","rph","pharmacy intern","pharmacy resident","pharmacy tech"] },
  { label: "Radiation Oncology", terms: ["radiation oncology","radiation therapy"] },
  { label: "Radiology",          terms: ["diagnostic radiology","nuclear medicine","nuclear radiology","neuroradiology","radiology","radiology/pediatrics","rad tech","vasc/intrvn radiology","interventional radiology"] },
  { label: "Scribe",             terms: ["scribe"] },
  { label: "Specialty Other",    terms: ["certified nurse midwife","dental asst","cln neurophysiology","dentist","dermatology","geneticist","genetic counselor","maternal/fetal med","med geneticist","neurology","ob/gyn","obstetrics","other m.d.","pain management","pain medicine","pmr","podiatrist","sleep medicine","sports medicine","vascular med","vascular neurology","athletic training","epileptologist","gynecology","hyperbaric medicine","hyperbaric technician","interventional pain management","maternal and fetal medicine","medical genetics","micrographic dermatologic surgery","osteopathic manipulative medicine","physical medicine and rehab","podiatry","reproductive endocrinology","no/unknown physician specialty"] },
  { label: "Surgery Other",      terms: ["bariatric surgery","female pelvic medicine","gen vascular surg","hand surg, plast sur","hand surg, ortho","laryngology","ophthalmology","optometrist","ortho tech","ortho - foot and ankle","orthopaedics sports","ortho trauma","orthotist","otolaryngology","prosthetics/orthotics","transplant","transplant surgery","surgery trauma","trauma acs","general trauma surgery","hand surgery","head and neck neck surgery","optometry","orthopaedic tech","vascular surgery","transplant assistant"] },
  { label: "Surgical Oncology",  terms: ["adult reconstructive surgery","anesthesiologist","anesthesiologists","cardiothoracic surg","colon/rectal surg","crit care med, anes","gynecologic oncology","nurse anesthes","orthopaedic oncology","ortho spine","orthopaedic surgery","plastic surgery","surgery","surg/cardiovascular","surgery crit care","surg/neur crit care","surgery/neurologic","surgery/oncology","surg tech","thoracic surg","urology","anesthesiology","cardiac surgery","certified registered nurse anesthes","colon and rectal surgery","general surgery","gyn oncology","neurosurgery","orthopedics"] },
  { label: "Therapy",            terms: ["child life","occupational therap","occ therap","respiratory therap","speech pathology","slp","speech pathologist","massage therapy","pulmonary tech","speech therapy","orthoptist","physical therapy assistant","physical therap","pt assist"] },
  { label: "Urgent Care",        terms: ["urgent care"] },
];

// Normalize strings exactly as EgoNetwork does
function normHCP(s: unknown): string {
  return String(s ?? "").toLowerCase().trim()
    .replace(/[()]/g, "").replace(/&/g, " and ")
    .replace(/[/:;,.-]/g, " ").replace(/\s+/g, " ");
}
function hasPhrase(field: string, term: string): boolean {
  return term ? (` ${field} `).includes(` ${term} `) : false;
}

// Pre-normalize terms once
const CANON_NORM = CANON_GROUPS.map(g => ({
  label: g.label,
  termsNorm: g.terms.map(t => normHCP(t)),
}));

export function classifyHCP(specialty: string, providerType: string, clinicianTitle: string): HCPLevel1 {
  const fields = [
    normHCP(specialty),
    normHCP(providerType),
    normHCP(clinicianTitle),
  ].filter(Boolean);

  // Priority 1: match specialty field first (same priority as EgoNetwork)
  const specField = normHCP(specialty);
  for (const { label, termsNorm } of CANON_NORM) {
    if (termsNorm.some(tn => hasPhrase(specField, tn))) return label;
  }
  // Priority 2: match any field
  for (const { label, termsNorm } of CANON_NORM) {
    if (termsNorm.some(tn => fields.some(f => hasPhrase(f, tn)))) return label;
  }
  return "Unknown";
}


// L1_COLORS is now an alias for SPECIALTY_COLORS from theme — single source of truth
export const L1_COLORS = SPECIALTY_COLORS;

export interface TreeLeaf  { name: string; value: number; color: string; specialty: string; }
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

// ─────────────────────────────────────────────
// SURROGATE RANKING
// Per-patient: avg |weight| across all weeks, sorted by importance.
// Excludes clinical note features. Returns top 60.
// ─────────────────────────────────────────────
export interface SurrogateFeature {
  feature:    string;          // e.g. "ACCESS_USER_PROV_SPECIALTY::SURGICAL_ONCOLOGY::freq|present"
  displayLabel: string;        // e.g. "Surgical Oncology"
  importance: number;          // avg |weight|
  weight:     number;          // avg |weight| (same — model coefficient magnitude)
  avgContrib: number;          // avg |contribution| across patient weeks
  avgValue:   number;          // avg feature value
  weekCount:  number;          // how many weeks this feature appeared
}

export function getPatientSurrogateRanking(data: WeekData[], limit = 60): SurrogateFeature[] {
  const weightMap: Record<string, { weights: number[]; contribs: number[]; values: number[] }> = {};

  for (const wk of data) {
    for (const c of (wk.topContrib ?? [])) {
      if (!weightMap[c.feature]) weightMap[c.feature] = { weights: [], contribs: [], values: [] };
      weightMap[c.feature].weights.push(Math.abs(c.weight));
      weightMap[c.feature].contribs.push(Math.abs(c.contribution));
      weightMap[c.feature].values.push(c.value ?? 0);
    }
  }

  const avg = (arr: number[]) => arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : 0;

  return Object.entries(weightMap)
    .map(([feature, d]) => {
      const parts = feature.split("::");
      const raw   = parts[1] ?? parts[0];
      const displayLabel = raw.replace(/^\*/, "").replace(/_/g, " ")
        .replace(/\b\w/g, c => c.toUpperCase()).trim();
      return {
        feature,
        displayLabel,
        importance:  avg(d.weights),
        weight:      avg(d.weights),
        avgContrib:  avg(d.contribs),
        avgValue:    avg(d.values),
        weekCount:   d.weights.length,
      };
    })
    .sort((a, b) => b.importance - a.importance)
    .slice(0, limit);
}

// ─────────────────────────────────────────────
// WHAT-IF PERTURBATION (surrogate logit math)
// Mirrors whatif.js / data.js getPerturbedRiskTimeline (Format B)
//
// Math: for each week i >= centerWeek:
//   Find the topContrib entry matching hcpSpec (fuzzy)
//   deltaLogit = -weight × (perturbPct/100) × |value|
//   newLogit   = log(risk / (1-risk)) + deltaLogit
//   newRisk    = sigmoid(newLogit)
// ─────────────────────────────────────────────

// Fuzzy-match HCP display name → feature string
// Mirrors hcpMatchesFeature() from whatif.js
export function hcpMatchesFeature(hcpSpec: string, featureName: string): boolean {
  if (!hcpSpec || !featureName) return false;
  const norm = (s: string) => s.toUpperCase().replace(/[^A-Z0-9]/g, " ").replace(/\s+/g, " ").trim();
  const hcp  = norm(hcpSpec);
  const feat = norm(featureName);
  if (!feat.includes("FREQ") && !feat.includes("PRESENT")) return false;
  if (feat.includes(hcp)) return true;
  const hcpTokens  = hcp.split(" ").filter(t => t.length > 2);
  const featTokens = new Set(feat.split(" "));
  const matches    = hcpTokens.filter(t => featTokens.has(t));
  if (matches.length >= Math.min(2, hcpTokens.length)) return true;
  if (hcp.length >= 5 && feat.includes(hcp.slice(0, 5))) return true;
  return false;
}

export function computePerturbedRisk(
  data: WeekData[],
  centerWeekIdx: number,    // index into data[] (not week number)
  perturbPct: number,       // 0–100: % reduction
  featureName: string,      // full feature string to match
): number[] {
  return data.map((wk, i) => {
    const origRisk = wk.riskScore;
    if (i < centerWeekIdx) return origRisk;
    const contrib = wk.topContrib.find(c => c.feature === featureName ||
      hcpMatchesFeature(featureName.split("::")[1] ?? featureName, c.feature));
    if (!contrib) return origRisk;
    const deltaLogit = -contrib.weight * (perturbPct / 100) * Math.abs(contrib.value);
    const logit      = Math.log(origRisk / Math.max(1 - origRisk, 1e-9));
    return Math.max(0, Math.min(1, 1 / (1 + Math.exp(-(logit + deltaLogit)))));
  });
}