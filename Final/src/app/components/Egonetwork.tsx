/**
 * EgoNetwork.tsx
 * Full port of ego.js → React/TypeScript.
 *
 * Preserves ALL functionality from ego.js v4:
 *  - Weekly mode: scrub / play through per-week HCP co-access snapshots
 *  - Cumulative mode: merged full-timeline network, node size = weeks active, edge = frequency
 *  - Solo mode: weeks with no co-access edges show individual HCPs in orbital layout
 *  - Force-directed layout with specialty-group angular anchoring
 *  - Split-color nodes for multi-group HCPs
 *  - Tooltip with specialty badges on hover
 *  - Click to highlight / dim connected nodes + edges
 *  - Legend updates per selected week
 *  - Layout cache keyed by patient+week to avoid re-simulation
 *
 * Adapts from ego.js:
 *  - STATE / DOM mutations → React useState / useRef
 *  - innerHTML SVG construction → SVG JSX
 *  - Custom event dispatch → prop callbacks
 *  - getPatient() / getEgoSnapshotAtPct() → getEgoRecord() / getTemporalRecord() from realData
 */

import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { getEgoRecord, getTemporalRecord } from "../realData";
import type { MergedEgoRecord } from "../realData";
import { T } from "../theme";

// ── Constants ─────────────────────────────────────────────────────────────────
const W = 520, H = 440, CX = W / 2, CY = H / 2;
const FONT = "'Space Mono', monospace";

// ── Specialty taxonomy (verbatim from ego.js) ─────────────────────────────────
const LEVEL1_GROUPS = [
  { key: "ancillary",         label: "Ancillary",            color: "#7B8CDE", angle: -150,
    terms: ["acupuncture","audiologist","chaplain","clinical research coordinator","cpt","health coach","home health aide","technician","tech","audiology","health educator","sonographer","spiritual care"] },
  { key: "dietary",           label: "Dietary",              color: "#56C596", angle: 150,
    terms: ["dietetic asst","dietetic intern","dietician","nutrition","rd","registered dietician"] },
  { key: "emergency",         label: "Emergency Medicine",   color: "#e07b39", angle: -120,
    terms: ["emergency medicine","geriatric emergency medicine","pediatric emergency"] },
  { key: "family_practice",   label: "Family Practice",      color: "#F4A261", angle: 90,
    terms: ["family practice"] },
  { key: "general_practice",  label: "General Practice",     color: "#E9C46A", angle: 75,
    terms: ["general practice","gen prevent med","preventative medicine","preventive medicine"] },
  { key: "internal_medicine", label: "Internal Medicine",    color: "#2A9D8F", angle: 60,
    terms: ["geriatric med, int","hospitalist","internal medicine","geriatric medicine","medicine"] },
  { key: "int_med_specialty", label: "Int. Med. Specialty",  color: "#1a47c8", angle: 30,
    terms: ["allergy","allergist","immunology","cardiology","cardiovascular dis","critical care med","endocrinology/metabo","gastroenterology","hematology","infectious disease","intervent cardiology","interventional cardiology","nephrology","pulmonary disease","rheumatology","adult congenital heart","cardiac electrophysiology","critical care","endocrinology","heart failure","hepatology","pulmonary medicine"] },
  { key: "medical_oncology",  label: "Medical Oncology",     color: "#be185d", angle: -90,
    terms: ["hematology/oncology","hospice","medical oncology","oncology, int","palliative medicine","bone marrow transplant","neuro oncology","oncology"] },
  { key: "mental_health",     label: "Mental Health",        color: "#d97706", angle: -150,
    terms: ["addiction psych","child/adolescent psy","clinic psychologist","internal medicine/psy","psychiatry","psychology","psych tech","psychology intern","psychology trainee","marriage and family therapist","neuropsychology"] },
  { key: "nursing",           label: "Nursing",              color: "#0891b2", angle: 150,
    terms: ["husc","registered nurse","rn","lvn","mosc","nurse practitioner","np","nursing","physician assistant","unit service coordinator","transition nurse specialist","pa/np"] },
  { key: "pathology",         label: "Pathology",            color: "#6D6875", angle: 180,
    terms: ["clinical laboratory scientist","ct (ascp)","cytotech","anatomic pathology","anatomic/cln path","blood banking","clinical pathology","cytopathology","cytotechnologist","dermatopathology","gross assistant","histotech","hospital laboratory technician","hlt","hcla","hematopathology","lab tech","pathology","pathology molecular genetic","pa(ascp)","pathologists","sct (ascp)"] },
  { key: "patient_support",   label: "Patient Support",      color: "#92400e", angle: 210,
    terms: ["case manager","case manager assistant","health services navigator","dc plng/case mgmt","licensed clinical social worker","lcsw","msw","patient navigator","social worker","social work intern","care coordinator","care management associate"] },
  { key: "pediatrics",        label: "Pediatrics",           color: "#FF9F1C", angle: 45,
    terms: ["pediatrics","neo/perinatal med","pediatrics/allergy","pediatric hematology","ped infectious dis","neonatology","pediatric dermatology","pediatric neurology"] },
  { key: "pharmacy",          label: "Pharmacy",             color: "#2EC4B6", angle: 120,
    terms: ["pharm intern","pharm resident","pharm tech","pharmacist","pharmd","rph","pharmacy intern","pharmacy resident","pharmacy tech"] },
  { key: "radiation_oncology",label: "Radiation Oncology",   color: "#CB4335", angle: -80,
    terms: ["radiation oncology","radiation therapy"] },
  { key: "radiology",         label: "Radiology",            color: "#0284c7", angle: 180,
    terms: ["diagnostic radiology","nuclear medicine","nuclear radiology","neuroradiology","radiology","radiology/pediatrics","rad tech","vasc/intrvn radiology","interventional radiology"] },
  { key: "scribe",            label: "Scribe",               color: "#AAB7B8", angle: -170,
    terms: ["scribe"] },
  { key: "specialty_other",   label: "Specialty Other",      color: "#D4AC0D", angle: -30,
    terms: ["certified nurse midwife","dental asst","cln neurophysiology","dentist","dermatology","geneticist","genetic counselor","maternal/fetal med","med geneticist","neurology","ob/gyn","obstetrics","other m.d.","pain management","pain medicine","pmr","podiatrist","sleep medicine","sports medicine","vascular med","vascular neurology","athletic training","epileptologist","gynecology","hyperbaric medicine","hyperbaric technician","interventional pain management","maternal and fetal medicine","medical genetics","micrographic dermatologic surgery","osteopathic manipulative medicine","physical medicine and rehab","podiatry","reproductive endocrinology","no/unknown physician specialty"] },
  { key: "surgery_other",     label: "Surgery Other",        color: "#884EA0", angle: -45,
    terms: ["bariatric surgery","female pelvic medicine","gen vascular surg","hand surg, plast sur","hand surg, ortho","laryngology","ophthalmology","optometrist","ortho tech","ortho - foot and ankle","orthopaedics sports","ortho trauma","orthotist","otolaryngology","prosthetics/orthotics","transplant","transplant surgery","surgery trauma","trauma acs","general trauma surgery","hand surgery","head and neck neck surgery","optometry","orthopaedic tech","vascular surgery","transplant assistant"] },
  { key: "surgical_oncology", label: "Surgical Oncology",    color: "#7c3aed", angle: -30,
    terms: ["adult reconstructive surgery","anesthesiologist","anesthesiologists","cardiothoracic surg","colon/rectal surg","crit care med, anes","gynecologic oncology","nurse anesthes","orthopaedic oncology","ortho spine","orthopaedic surgery","plastic surgery","surgery","surg/cardiovascular","surgery crit care","surg/neur crit care","surgery/neurologic","surgery/oncology","surg tech","thoracic surg","urology","anesthesiology","cardiac surgery","certified registered nurse anesthes","colon and rectal surgery","general surgery","gyn oncology","neurosurgery","orthopedics"] },
  { key: "therapy",           label: "Therapy",              color: "#1ABC9C", angle: 135,
    terms: ["child life","occupational therap","occ therap","respiratory therap","speech pathology","slp","speech pathologist","massage therapy","pulmonary tech","speech therapy","orthoptist","physical therapy assistant","physical therap","pt assist"] },
  { key: "urgent_care",       label: "Urgent Care",          color: "#f97316", angle: -110,
    terms: ["urgent care"] },
] as const;

type GroupDef = typeof LEVEL1_GROUPS[number] | { key: "other"; label: "Other"; color: "#94a3b8"; angle: 0; terms?: string[] };
const FALLBACK_GROUP: GroupDef = { key: "other", label: "Other", color: "#94a3b8", angle: 0 };
const GROUP_BY_KEY: Record<string, GroupDef> = Object.fromEntries(LEVEL1_GROUPS.map(g => [g.key, g]));

function normStr(s: unknown): string {
  return String(s ?? "").toLowerCase().trim()
    .replace(/[()]/g, "").replace(/&/g, " and ")
    .replace(/[/:;,.-]/g, " ").replace(/\s+/g, " ");
}
function hasPhrase(f: string, t: string): boolean {
  return t ? (` ${f} `).includes(` ${t} `) : false;
}
const GROUP_TERMS_NORM = LEVEL1_GROUPS.map(g => ({
  g, termsNorm: g.terms.map(t => normStr(t)).filter(Boolean),
}));

function classifyNode(n: RawNode): GroupDef[] {
  const specField = normStr(n.spec);
  const allFields = [normStr(n.spec), normStr(n.ptype), normStr(n.title)].filter(Boolean);
  const specMatches = GROUP_TERMS_NORM
    .filter(({ g }) => g.key !== "other")
    .filter(({ termsNorm }) => termsNorm.some(tn => hasPhrase(specField, tn)))
    .map(({ g }) => g as GroupDef);
  if (specMatches.length) return specMatches;
  const anyMatch = GROUP_TERMS_NORM
    .filter(({ g }) => g.key !== "other")
    .find(({ termsNorm }) => termsNorm.some(tn => allFields.some(fn => hasPhrase(fn, tn))));
  return anyMatch ? [anyMatch.g as GroupDef] : [FALLBACK_GROUP];
}
function primaryGroup(matches: GroupDef[]): GroupDef {
  return matches[0] ?? FALLBACK_GROUP;
}

// ── Node / Edge types ─────────────────────────────────────────────────────────
interface RawNode {
  id: string;
  spec: string;
  ptype: string;
  title: string;
  deg: number;
  isDirect: boolean;
}
interface Node extends RawNode {
  groupMatches: GroupDef[];
  weekCount?: number;   // cumulative: how many weeks active
  isSolo?: boolean;
}
interface Edge {
  s: string;
  t: string;
  freq?: number;        // cumulative: how many weeks this edge appeared
}

function normaliseNode(n: Record<string, unknown>): RawNode {
  return {
    id:       String(n.id ?? ""),
    spec:     String(n.specialty      ?? n.spec  ?? "").trim(),
    ptype:    String(n.providerType   ?? n.ptype ?? "").trim(),
    title:    String(n.clinicianTitle ?? n.title ?? "").trim(),
    deg:      Number(n.degree ?? n.deg ?? 0),
    isDirect: Boolean(n.isDirectConn ?? true),
  };
}
function normaliseEdge(e: Record<string, unknown>): Edge {
  return { s: String(e.source ?? e.s ?? ""), t: String(e.target ?? e.t ?? "") };
}
function specName(n: RawNode): string {
  if (n.spec  && n.spec.length  > 0) return n.spec;
  if (n.ptype && n.ptype.length > 0) return n.ptype.replace(/^\*[^:]+:\s*/, "").trim() || n.ptype;
  if (n.title && n.title.length > 0) return n.title;
  return `HCP ${n.id}`;
}

// ── Cumulative network builder ─────────────────────────────────────────────────
interface WeeklySnapshot {
  nodes: Record<string, unknown>[];
  edges: Record<string, unknown>[];
}
function buildCumulativeNetwork(weeklySnapshots: Record<string, WeeklySnapshot>) {
  const nodeMap: Record<string, RawNode & { weekCount: number }> = {};
  const edgeMap: Record<string, number> = {};
  Object.values(weeklySnapshots).forEach(snap => {
    if (!snap?.nodes?.length) return;
    (snap.nodes ?? []).forEach(rawN => {
      const n = normaliseNode(rawN);
      if (!nodeMap[n.id]) nodeMap[n.id] = { ...n, weekCount: 0 };
      nodeMap[n.id].weekCount++;
      nodeMap[n.id].deg = Math.max(nodeMap[n.id].deg, n.deg);
    });
    (snap.edges ?? []).forEach(rawE => {
      const e   = normaliseEdge(rawE);
      const key = [e.s, e.t].sort().join("~~~");
      edgeMap[key] = (edgeMap[key] ?? 0) + 1;
    });
  });
  const nodes = Object.values(nodeMap);
  const edges: Array<Edge & { freq: number }> = Object.entries(edgeMap).map(([key, freq]) => {
    const [s, t] = key.split("~~~");
    return { s, t, freq };
  });
  return { nodes, edges };
}

// ── Force layout (verbatim logic from ego.js) ──────────────────────────────────
const _layoutCache: Record<string, Record<string, { x: number; y: number }>> = {};

function forceLayout(nodes: Node[], edges: Edge[], cacheKey: string): Record<string, { x: number; y: number }> {
  if (_layoutCache[cacheKey]) return _layoutCache[cacheKey];
  if (!nodes.length) return {};

  const STEPS = 280, REPEL = 2800, ATTRACT = 0.018, ANCHOR = 0.035;
  const RADIAL_SPRING = 0.055, TARGET_R_MIN = 80, TARGET_R_MAX = 200, MAX_VEL = 7;
  const maxDeg = Math.max(...nodes.map(n => n.deg), 1);

  const targetR: Record<string, number> = {};
  nodes.forEach(n => {
    targetR[n.id] = TARGET_R_MIN + (n.deg / maxDeg) * (TARGET_R_MAX - TARGET_R_MIN);
  });

  const pos: Record<string, { x: number; y: number }> = {};
  const vel: Record<string, { x: number; y: number }> = {};
  nodes.forEach(n => {
    const g   = primaryGroup(n.groupMatches);
    const ang = ((g.angle ?? 0) * Math.PI) / 180;
    const j   = () => (Math.random() - 0.5) * 40;
    pos[n.id] = { x: CX + targetR[n.id] * Math.cos(ang) + j(), y: CY + targetR[n.id] * Math.sin(ang) + j() };
    vel[n.id] = { x: 0, y: 0 };
  });

  const adj: Record<string, string[]> = {};
  nodes.forEach(n => { adj[n.id] = []; });
  edges.forEach(e => {
    if (adj[e.s]) adj[e.s].push(e.t);
    if (adj[e.t]) adj[e.t].push(e.s);
  });

  function centroid(key: string) {
    const m = nodes.filter(n => primaryGroup(n.groupMatches).key === key);
    if (!m.length) return { x: CX, y: CY };
    const s = m.reduce((a, n) => ({ x: a.x + pos[n.id].x, y: a.y + pos[n.id].y }), { x: 0, y: 0 });
    return { x: s.x / m.length, y: s.y / m.length };
  }

  for (let step = 0; step < STEPS; step++) {
    const cool = 1 - step / STEPS;
    nodes.forEach(a => {
      let fx = 0, fy = 0;
      const pa = pos[a.id];
      const _rScale = nodes.length <= 6 ? 0.65 : 1;
      const rA = Math.max(16, Math.min(30, 11 + Math.log1p(a.deg) * 3.0)) * _rScale;
      nodes.forEach(b => {
        if (b.id === a.id) return;
        const rB    = Math.max(16, Math.min(30, 11 + Math.log1p(b.deg) * 3.0)) * _rScale;
        const dx    = pa.x - pos[b.id].x, dy = pa.y - pos[b.id].y;
        const d     = Math.sqrt(dx * dx + dy * dy) + 0.01;
        const force = REPEL / (d * d) + Math.max(0, (rA + rB) * 2.4 - d) * 14;
        fx += force * (dx / d); fy += force * (dy / d);
      });
      const dx = pa.x - CX, dy = pa.y - CY;
      const dist  = Math.sqrt(dx * dx + dy * dy) + 0.01;
      const delta = dist - targetR[a.id];
      fx -= RADIAL_SPRING * delta * (dx / dist);
      fy -= RADIAL_SPRING * delta * (dy / dist);
      (adj[a.id] || []).forEach(bid => {
        if (pos[bid]) { fx += ATTRACT * (pos[bid].x - pa.x); fy += ATTRACT * (pos[bid].y - pa.y); }
      });
      const gc = centroid(primaryGroup(a.groupMatches).key);
      fx += ANCHOR * (gc.x - pa.x); fy += ANCHOR * (gc.y - pa.y);
      vel[a.id].x = Math.max(-MAX_VEL, Math.min(MAX_VEL, (vel[a.id].x + fx) * 0.54));
      vel[a.id].y = Math.max(-MAX_VEL, Math.min(MAX_VEL, (vel[a.id].y + fy) * 0.54));
    });
    nodes.forEach(n => {
      pos[n.id].x = Math.max(40, Math.min(W - 40, pos[n.id].x + vel[n.id].x * cool));
      pos[n.id].y = Math.max(40, Math.min(H - 60, pos[n.id].y + vel[n.id].y * cool));
    });
  }
  _layoutCache[cacheKey] = pos;
  return pos;
}

// ── SVG node shape helpers (verbatim logic from ego.js) ────────────────────────
function buildCircleJSX(nx: number, ny: number, r: number, matches: GroupDef[]) {
  const g0 = matches[0] ?? FALLBACK_GROUP;
  const g1 = matches[1];
  if (!g1) {
    return <circle cx={nx} cy={ny} r={r} fill={g0.color} opacity={0.93} stroke="white" strokeWidth={2}/>;
  }
  return (
    <>
      <path d={`M${nx},${ny - r} A${r},${r} 0 0,0 ${nx},${ny + r} Z`} fill={g0.color} opacity={0.93}/>
      <path d={`M${nx},${ny - r} A${r},${r} 0 0,1 ${nx},${ny + r} Z`} fill={g1.color} opacity={0.93}/>
      <circle cx={nx} cy={ny} r={r} fill="none" stroke="white" strokeWidth={2}/>
    </>
  );
}

function buildLabelJSX(nx: number, ny: number, r: number, matches: GroupDef[]) {
  const fs   = Math.max(6, Math.min(8.5, r * 0.30));
  const real = matches.filter(g => g.key !== "other");
  if (!real.length) {
    return <text x={nx} y={ny} textAnchor="middle" dominantBaseline="middle"
      fontSize={fs} fill="white" fontWeight={700} fontFamily={FONT} pointerEvents="none">?</text>;
  }
  if (real.length === 1) {
    const words = real[0].label.split(" ");
    const mid   = Math.ceil(words.length / 2);
    const l1    = words.slice(0, mid).join(" ");
    const l2    = words.slice(mid).join(" ");
    const lh    = fs + 1.6;
    const y0    = l2 ? ny - lh * 0.5 : ny;
    return (
      <>
        <text x={nx} y={y0} textAnchor="middle" dominantBaseline="middle"
          fontSize={fs} fill="white" fontWeight={700} fontFamily={FONT} pointerEvents="none">{l1}</text>
        {l2 && <text x={nx} y={y0 + lh} textAnchor="middle" dominantBaseline="middle"
          fontSize={fs} fill="rgba(255,255,255,0.9)" fontWeight={600} fontFamily={FONT} pointerEvents="none">{l2}</text>}
      </>
    );
  }
  const abbr = (g: GroupDef) => g.label.split(" ").map(w => w[0]).join("");
  const lh   = fs + 1.8;
  return (
    <>
      <text x={nx} y={ny - lh * 0.5} textAnchor="middle" dominantBaseline="middle"
        fontSize={fs} fill="white" fontWeight={700} fontFamily={FONT} pointerEvents="none">{abbr(real[0])}</text>
      <line x1={nx - r * 0.35} y1={ny} x2={nx + r * 0.35} y2={ny}
        stroke="rgba(255,255,255,0.4)" strokeWidth={0.8} pointerEvents="none"/>
      <text x={nx} y={ny + lh * 0.5} textAnchor="middle" dominantBaseline="middle"
        fontSize={fs} fill="rgba(255,255,255,0.9)" fontWeight={700} fontFamily={FONT} pointerEvents="none">{abbr(real[1])}</text>
    </>
  );
}

// ── Tooltip component ─────────────────────────────────────────────────────────
interface TooltipState {
  visible: boolean;
  x: number;
  y: number;
  node: Node | null;
  isCumulative: boolean;
}
function EgoTooltip({ tt }: { tt: TooltipState }) {
  if (!tt.visible || !tt.node) return null;
  const n    = tt.node;
  const name = specName(n);
  const g0   = primaryGroup(n.groupMatches);
  const real = n.groupMatches.filter(g => g.key !== "other");
  return (
    <div style={{
      position: "fixed", left: tt.x, top: tt.y,
      pointerEvents: "none", zIndex: 999,
      background: "#0f172a", border: "1.5px solid #1e293b", borderRadius: 10,
      padding: "14px 16px", minWidth: 190, maxWidth: 260,
      boxShadow: "0 8px 32px rgba(0,0,0,0.6)",
      fontFamily: FONT,
    }}>
      <div style={{ fontSize: 15, fontWeight: 800, color: g0.color,
        marginBottom: 10, paddingBottom: 9, borderBottom: "1px solid #1e293b",
        wordBreak: "break-all", lineHeight: 1.3 }}>{name}</div>
      <div style={{ marginBottom: 8, lineHeight: 1.8, display: "flex", flexWrap: "wrap", gap: 4 }}>
        {real.length > 0
          ? real.map(g => (
              <span key={g.key} style={{
                display: "inline-flex", alignItems: "center", padding: "4px 10px",
                borderRadius: 6, background: g.color + "20", color: g.color,
                fontSize: 12, fontWeight: 700, border: `1px solid ${g.color}44`,
              }}>{g.label}</span>
            ))
          : <span style={{ color: "#475569", fontSize: 11 }}>Unclassified</span>}
      </div>
      {tt.isCumulative && n.weekCount
        ? <div style={{ marginTop: 6, color: "#0891b2", fontSize: 11, fontWeight: 700 }}>
            Active {n.weekCount} week{n.weekCount !== 1 ? "s" : ""} across full timeline
          </div>
        : <div style={{ color: "#64748b", fontSize: 11, marginTop: 4 }}>
            <strong style={{ color: g0.color }}>{n.deg}</strong> co-care connections this week
          </div>}
      {n.ptype && <div style={{ color: "#475569", fontSize: 10, marginTop: 4 }}>{n.ptype}</div>}
      <div style={{ marginTop: 9, paddingTop: 7, borderTop: "1px solid #1e293b",
        fontSize: 10, color: "#334155" }}>Click to highlight connections</div>
    </div>
  );
}

// ── Network SVG renderer ──────────────────────────────────────────────────────
interface NetworkSVGProps {
  nodes: Node[];
  edges: Edge[];
  cacheKey: string;
  isCumulative: boolean;
  maxEdgeFreq: number;
  selectedHCP: string | null;
  onSelectHCP: (name: string | null) => void;
  onHover: (node: Node | null, x: number, y: number) => void;
}
function NetworkSVG({ nodes, edges, cacheKey, isCumulative, maxEdgeFreq, selectedHCP, onSelectHCP, onHover }: NetworkSVGProps) {
  if (!nodes.length) {
    return (
      <div style={{ height: H, display: "flex", flexDirection: "column", alignItems: "center",
        justifyContent: "center", background: "#f7f9fc", borderRadius: 10,
        border: "1.5px dashed #cbd5e1", gap: 10 }}>
        <div style={{ fontSize: 28, opacity: 0.3 }}>◯</div>
        <div style={{ fontSize: 13, color: "#94a3b8", fontFamily: FONT, fontWeight: 600 }}>
          No active care network
        </div>
      </div>
    );
  }

  const maxDeg  = Math.max(...nodes.map(n => n.deg), 1);
  const pos     = forceLayout(nodes, edges, cacheKey);
  const nodeById: Record<string, Node> = Object.fromEntries(nodes.map(n => [n.id, n]));

  const nodeSizeScale = nodes.length <= 2 ? 0.30 : nodes.length <= 4 ? 0.45 : nodes.length <= 8 ? 0.70 : nodes.length <= 12 ? 0.88 : 1.0;

  // Adaptive viewBox — enforce a minimum size so sparse networks don't blow up
  const PAD    = 60;
  const posVals = Object.values(pos);
  const maxR   = Math.max(...nodes.map(n =>
    Math.round(Math.max(16, Math.min(28, 11 + Math.log1p(n.deg) * 3.0)) * nodeSizeScale)
  ), 10);
  const minX = Math.min(...posVals.map(p => p.x)) - maxR - PAD;
  const maxX = Math.max(...posVals.map(p => p.x)) + maxR + PAD;
  const minY = Math.min(...posVals.map(p => p.y)) - maxR - PAD;
  const maxY = Math.max(...posVals.map(p => p.y)) + maxR + PAD + 18;
  // Minimum viewBox dimensions — prevents zooming in on 1-3 node layouts
  const vbW  = Math.max(maxX - minX, W * 0.8);
  const vbH  = Math.max(maxY - minY, H * 0.7);

  return (
    <svg
      viewBox={`${minX.toFixed(0)} ${minY.toFixed(0)} ${vbW.toFixed(0)} ${vbH.toFixed(0)}`}
      style={{ width: "100%", display: "block", borderRadius: 10, background: "#f7f9fc" }}
    >
      {/* Edges */}
      {edges.map((e, ei) => {
        const a = nodeById[e.s], b = nodeById[e.t];
        if (!a || !b || !pos[a.id] || !pos[b.id]) return null;
        const aName = specName(a), bName = specName(b);
        const isConn = selectedHCP ? (aName === selectedHCP || bName === selectedHCP) : true;
        let thick: number, opacity: number;
        if (isCumulative) {
          const freq = (e as { freq?: number }).freq ?? 1;
          thick   = 0.5 + (freq / Math.max(maxEdgeFreq, 1)) * 5;
          opacity = 0.2 + (freq / Math.max(maxEdgeFreq, 1)) * 0.55;
        } else {
          thick   = 0.6 + ((a.deg + b.deg) / 2 / maxDeg) * 3.5;
          opacity = 0.38;
        }
        if (selectedHCP) opacity = isConn ? 0.88 : 0.04;
        return (
          <line key={ei}
            x1={pos[a.id].x} y1={pos[a.id].y}
            x2={pos[b.id].x} y2={pos[b.id].y}
            stroke={selectedHCP ? (isConn ? "#f59e0b" : "#a8b2cc") : "#a8b2cc"}
            strokeWidth={thick}
            opacity={opacity}
          />
        );
      })}

      {/* Nodes */}
      {nodes.map(n => {
        const nx = pos[n.id]?.x ?? CX;
        const ny = pos[n.id]?.y ?? CY;
        const g0 = primaryGroup(n.groupMatches);
        const name = specName(n);
        const isSel = selectedHCP === name;

        let r: number;
        if (isCumulative) {
          const wc = n.weekCount ?? 1;
          r = Math.max(12, Math.min(28, 10 + Math.log1p(wc) * 5.5)) * nodeSizeScale;
        } else {
          r = Math.max(14, Math.min(26, 12 + Math.log1p(n.deg) * 3.2)) * nodeSizeScale;
        }
        r = Math.round(r);

        const nodeOpacity = selectedHCP ? (isSel ? 1 : 0.08) : 1;
        const subLabel    = isCumulative ? `${n.weekCount ?? "?"}wk` : `deg ${n.deg}`;

        return (
          <g key={n.id}
            style={{ cursor: "pointer", opacity: nodeOpacity }}
            onMouseEnter={e => onHover(n, e.clientX, e.clientY)}
            onMouseLeave={() => onHover(null, 0, 0)}
            onClick={() => onSelectHCP(isSel ? null : name)}
          >
            {/* Selection ring */}
            {isSel && <circle cx={nx} cy={ny} r={r + 9} fill="none"
              stroke={g0.color} strokeWidth={2.5} strokeDasharray="5 3"/>}
            {buildCircleJSX(nx, ny, r, n.groupMatches)}
            {buildLabelJSX(nx, ny, r, n.groupMatches)}
            <text x={nx} y={ny + r + 11} textAnchor="middle"
              fontSize={7} fill={g0.color} fontFamily={FONT} fontWeight={600} pointerEvents="none">
              {subLabel}
            </text>
          </g>
        );
      })}

      <text x={(maxX - PAD / 2).toFixed(0)} y={(minY + 14).toFixed(0)} textAnchor="end"
        fontSize={8} fill="#94a3b8" fontFamily={FONT}>
        {nodes.length} HCPs · {edges.length} edges
      </text>
    </svg>
  );
}

// ── Solo orbit view (no co-access edges) ─────────────────────────────────────
interface SoloHCP { specialty: string; providerType: string; clinicianTitle?: string }
function SoloNetworkSVG({ hcps, patientId, weekNum }: { hcps: SoloHCP[]; patientId: string; weekNum: number }) {
  if (!hcps.length) {
    return (
      <div style={{ height: H, display: "flex", flexDirection: "column", alignItems: "center",
        justifyContent: "center", background: "#f7f9fc", borderRadius: 10,
        border: "1.5px dashed #cbd5e1", gap: 10 }}>
        <div style={{ fontSize: 28, opacity: 0.3 }}>◯</div>
        <div style={{ fontSize: 13, color: "#94a3b8", fontFamily: FONT, fontWeight: 600 }}>
          No active care network this week
        </div>
        <div style={{ fontSize: 11, color: "#cbd5e1", fontFamily: FONT }}>
          Week {weekNum} — no co-access events recorded
        </div>
      </div>
    );
  }

  // Dedup by specialty label
  const seen  = new Set<string>();
  const dedup = hcps.filter(h => {
    const n = normaliseNode({ id: "0", specialty: h.specialty, providerType: h.providerType, clinicianTitle: h.clinicianTitle });
    const key = specName(n);
    if (seen.has(key)) return false;
    seen.add(key); return true;
  });

  const svgW = 500, svgH = H;
  const cx = svgW / 2, cy = svgH / 2;
  const R  = Math.min(cx, cy) * 0.72;
  const n  = dedup.length;

  return (
    <svg width={svgW} height={svgH} style={{ display: "block", background: "#f7f9fc", borderRadius: 10, border: "1.5px dashed #c7d6e8" }}>
      {/* Solo mode badge */}
      <rect x={8} y={8} width={180} height={18} rx={4} fill="#fef3c7" stroke="#fcd34d" strokeWidth={1}/>
      <text x={14} y={20} fontSize={9.5} fill="#92400e" fontFamily={FONT}>Solo visits · no co-access network</text>

      {/* Orbit ring */}
      <circle cx={cx} cy={cy} r={R} fill="none" stroke="#e2e8f0" strokeWidth={1} strokeDasharray="4 4"/>

      {/* Patient center */}
      <circle cx={cx} cy={cy} r={26} fill="#1e293b" stroke="#334155" strokeWidth={2}/>
      <text x={cx} y={cy} textAnchor="middle" dominantBaseline="middle"
        fontSize={9} fontWeight={700} fill="white" fontFamily={FONT}>PT</text>
      <text x={cx} y={cy + 36} textAnchor="middle" fontSize={9} fill="#64748b" fontFamily={FONT}>{patientId}</text>

      {/* HCP orbit nodes */}
      {dedup.map((h, i) => {
        const rawN   = normaliseNode({ id: `s${i}`, specialty: h.specialty, providerType: h.providerType, clinicianTitle: h.clinicianTitle });
        const g      = primaryGroup(classifyNode(rawN));
        const col    = g.color;
        const angle  = (2 * Math.PI * i / n) - Math.PI / 2;
        const x      = cx + R * Math.cos(angle);
        const y      = cy + R * Math.sin(angle);
        const label  = specName(rawN);
        const short  = label.length > 18 ? label.slice(0, 16) + "…" : label;
        const initials = label.split(/[\s/]+/).filter(Boolean).slice(0, 2).map(w => w[0]).join("");
        return (
          <g key={i}>
            <line x1={cx} y1={cy} x2={x} y2={y} stroke={col} strokeWidth={1} strokeDasharray="3 4" opacity={0.35}/>
            <circle cx={x} cy={y} r={22} fill={col} fillOpacity={0.15} stroke={col} strokeWidth={1.5} strokeDasharray="4 3"/>
            <text x={x} y={y + 1} textAnchor="middle" dominantBaseline="middle"
              fontSize={11} fontWeight={700} fill={col} fontFamily={FONT} pointerEvents="none">{initials}</text>
            <text x={x} y={y + 30} textAnchor="middle" fontSize={9.5} fill="#475569" fontFamily="sans-serif" pointerEvents="none">{short}</text>
          </g>
        );
      })}
    </svg>
  );
}

// ── Legend bar ────────────────────────────────────────────────────────────────
function LegendBar({ groupKeys }: { groupKeys: Set<string> }) {
  const items = [...groupKeys]
    .map(k => GROUP_BY_KEY[k] ?? FALLBACK_GROUP)
    .sort((a, b) => a.label.localeCompare(b.label));

  if (!items.length) {
    return (
      <div style={{ color: "#94a3b8", fontSize: 10, fontFamily: FONT }}>
        No specialties this week
      </div>
    );
  }
  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: "5px 14px" }}>
      {items.map(g => (
        <div key={g.key} style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 10,
          color: "#334155", fontFamily: FONT, whiteSpace: "nowrap" }}>
          <span style={{ display: "inline-block", width: 10, height: 10, borderRadius: "50%",
            background: g.color, flexShrink: 0 }}/>
          {g.label}
        </div>
      ))}
    </div>
  );
}

// ── Week dot row ──────────────────────────────────────────────────────────────
function WeekDots({ allWeeks, activeIdx, snapshots, onClickIdx }: {
  allWeeks: number[];
  activeIdx: number;
  snapshots: Record<string, WeeklySnapshot>;
  onClickIdx: (i: number) => void;
}) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center",
      padding: "3px 0 0", width: "100%" }}>
      {allWeeks.map((wk, i) => {
        const nodeCount = snapshots[String(wk)]?.nodes?.length ?? 0;
        const hasData   = nodeCount > 0;
        const isCur     = i === activeIdx;
        return (
          <div key={wk}
            title={hasData ? `Week ${wk}: ${nodeCount} HCPs active` : `Week ${wk}: no data`}
            onClick={() => hasData && onClickIdx(i)}
            style={{
              width:        hasData ? 10 : 6,
              height:       hasData ? 10 : 6,
              borderRadius: "50%",
              background:   isCur ? "#f59e0b" : hasData ? "#0284c7" : "#e2e8f0",
              border:       isCur ? "2px solid #b45309" : hasData ? "1.5px solid #0369a1" : "1px solid #cbd5e1",
              cursor:       hasData ? "pointer" : "default",
              flexShrink:   0,
              transition:   "all 0.15s",
              opacity:      hasData ? 1 : 0.5,
            }}
          />
        );
      })}
    </div>
  );
}

// ── Ego data access helpers (need to be in realData) ──────────────────────────
// These are imported from realData — see realData.ts updates below.

// ─────────────────────────────────────────────────────────────────────────────
// MAIN COMPONENT
// ─────────────────────────────────────────────────────────────────────────────
interface Props {
  patientId: string;
  accentColor?: string;
  initialWeek?: number | null;
}

export function EgoNetwork({ patientId, accentColor = "#2B6CB0", initialWeek }: Props) {
  const [egoMode,    setEgoMode]    = useState<"weekly" | "cumulative">("weekly");
  const [weekIdx,    setWeekIdx]    = useState(0);
  const [selectedHCP, setSelectedHCP] = useState<string | null>(null);
  const [tt,         setTt]         = useState<TooltipState>({ visible: false, x: 0, y: 0, node: null, isCumulative: false });
  const [playing,    setPlaying]    = useState(false);
  const playTimer                   = useRef<ReturnType<typeof setInterval> | null>(null);

  // Load raw ego record (merged: linear data + ego_network weeklySnapshots)
  const egoRecord: MergedEgoRecord | null  = getEgoRecord(patientId);
  void getTemporalRecord(patientId); // available for future use

  const weeklySnapshots = egoRecord?.weeklySnapshots ?? {};

  const allWeeks = useMemo(() =>
    Object.keys(weeklySnapshots).map(Number).sort((a, b) => a - b),
    [weeklySnapshots]
  );

  // Weekly array (ego.weekly[]) for solo fallback — HCPs visited each week
  const patientWeekly: Array<{ week: number; weeklyHCPSnapshot: SoloHCP[] }> =
    egoRecord?.weekly ?? [];

  const riskDelta: number = egoRecord?.riskDelta ?? 0;

  // Reset state when patient changes
  useEffect(() => {
    setWeekIdx(0);
    setSelectedHCP(null);
    setEgoMode("weekly");
    if (playTimer.current) { clearInterval(playTimer.current); playTimer.current = null; }
    setPlaying(false);
  }, [patientId]);

  // Jump to initialWeek when it changes (sync from radial selection)
  useEffect(() => {
    if (initialWeek == null || !allWeeks.length) return;
    // find the closest week index
    const idx = allWeeks.findIndex(w => w >= initialWeek);
    if (idx >= 0) setWeekIdx(idx);
    else setWeekIdx(allWeeks.length - 1);
  }, [initialWeek, allWeeks]);

  // Play timer
  const stopPlay = useCallback(() => {
    if (playTimer.current) { clearInterval(playTimer.current); playTimer.current = null; }
    setPlaying(false);
  }, []);

  const startPlay = useCallback(() => {
    if (!allWeeks.length) return;
    setPlaying(true);
    playTimer.current = setInterval(() => {
      setWeekIdx(prev => {
        const next = prev + 1;
        if (next >= allWeeks.length) { stopPlay(); return prev; }
        return next;
      });
    }, 600);
  }, [allWeeks.length, stopPlay]);

  useEffect(() => () => { if (playTimer.current) clearInterval(playTimer.current); }, []);

  if (!egoRecord || !allWeeks.length) {
    return (
      <div style={{ height: "100%", display: "flex", flexDirection: "column", alignItems: "center",
        justifyContent: "center", gap: 10, color: "#94a3b8", fontFamily: FONT,
        background: T.bgCard, border: `1px solid ${T.border}`, borderRadius: 10 }}>
        <div style={{ fontSize: 32, opacity: 0.2 }}>◯</div>
        <div style={{ fontSize: 12, fontWeight: 600, letterSpacing: 1 }}>NO EGO NETWORK DATA</div>
        <div style={{ fontSize: 10, color: "#cbd5e1" }}>{patientId}</div>
      </div>
    );
  }

  const currentWeek    = allWeeks[weekIdx] ?? 0;
  const currentSnap    = weeklySnapshots[String(currentWeek)];
  const isWeeklyActive = egoMode === "weekly";
  const maxWeek        = allWeeks[allWeeks.length - 1];

  // ── Build cumulative stats ──
  const cumulNet       = useMemo(() => buildCumulativeNetwork(weeklySnapshots), [weeklySnapshots]);
  const totalUniqueHCPs = cumulNet.nodes.length;
  const totalNodes      = Object.values(weeklySnapshots)
    .reduce((mx, s) => Math.max(mx, s?.nodes?.length ?? 0), 0);
  const initCount       = currentSnap?.nodes?.length ?? 0;
  const maxEdgeFreq     = Math.max(...(cumulNet.edges as Array<{freq:number}>).map(e => e.freq ?? 1), 1);

  // ── Build nodes for current view ──
  const { renderNodes, renderEdges, renderCacheKey, isCumulative } = useMemo(() => {
    if (egoMode === "cumulative") {
      const nodes: Node[] = cumulNet.nodes.map(n => ({ ...n, groupMatches: classifyNode(n), weekCount: n.weekCount }));
      return { renderNodes: nodes, renderEdges: cumulNet.edges, renderCacheKey: `${patientId}_cumulative`, isCumulative: true };
    }
    if (!currentSnap?.nodes?.length) {
      return { renderNodes: [], renderEdges: [], renderCacheKey: "", isCumulative: false };
    }
    const nodes: Node[] = (currentSnap.nodes as Record<string,unknown>[]).map(rawN => {
      const n = normaliseNode(rawN);
      return { ...n, groupMatches: classifyNode(n) };
    });
    const edges = (currentSnap.edges as Record<string,unknown>[]).map(normaliseEdge);
    return { renderNodes: nodes, renderEdges: edges, renderCacheKey: `${patientId}_week${currentWeek}`, isCumulative: false };
  }, [egoMode, currentWeek, currentSnap, cumulNet, patientId]);

  // ── Solo fallback: no co-access network but HCPs visited ──
  const soloHCPs: SoloHCP[] = useMemo(() => {
    if (egoMode !== "weekly" || currentSnap?.nodes?.length) return [];
    const entry = patientWeekly.reduce<{ week: number; weeklyHCPSnapshot: SoloHCP[] } | null>((best, w) => {
      if (!best) return w;
      return Math.abs(w.week - currentWeek) < Math.abs(best.week - currentWeek) ? w : best;
    }, null);
    return entry?.weeklyHCPSnapshot ?? [];
  }, [egoMode, currentWeek, currentSnap, patientWeekly]);

  // ── Legend groups for current week ──
  const legendGroupKeys = useMemo(() => {
    const keys = new Set<string>();
    const srcNodes = currentSnap?.nodes?.length
      ? (currentSnap.nodes as Record<string,unknown>[]).map(normaliseNode)
      : soloHCPs.map((h, i) => normaliseNode({ id: `s${i}`, specialty: h.specialty, providerType: h.providerType, clinicianTitle: h.clinicianTitle }));
    srcNodes.forEach(n => classifyNode(n).filter(g => g.key !== "other").forEach(g => keys.add(g.key)));
    return keys;
  }, [currentSnap, soloHCPs]);

  // ── Tooltip handler ──
  const handleHover = useCallback((node: Node | null, clientX: number, clientY: number) => {
    if (!node) { setTt(t => ({ ...t, visible: false, node: null })); return; }
    setTt({ visible: true, x: clientX + 16, y: clientY + 16, node, isCumulative });
  }, [isCumulative]);

  const dCol = riskDelta < -0.04 ? "#0f766e" : "#b45309";
  const dStr = (riskDelta >= 0 ? "↑" : "↓") + Math.abs(riskDelta).toFixed(3);

  const btnStyle = (active: boolean) => ({
    border: "none", borderRadius: 6, padding: "6px 16px", fontSize: 12,
    fontFamily: FONT, cursor: "pointer" as const, fontWeight: 700, letterSpacing: "0.03em",
    transition: "all 0.15s",
    background: active ? "#0f172a" : "#e2e8f0",
    color:      active ? "white"   : "#475569",
  });

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8,
      background: T.bgCard, border: `1px solid ${T.border}`, borderRadius: 10,
      padding: "12px 14px", boxSizing: "border-box", fontFamily: FONT }}>

      {/* ── TOP ROW: stats + mode toggle ── */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between",
        gap: 8, flexShrink: 0, flexWrap: "nowrap", minWidth: 0 }}>

        {/* Stats chips */}
        <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "nowrap", overflow: "hidden" }}>
          {[
            { id: "active-now", val: String(initCount),        label: "Active now",    col: "#0284c7", bg: "#f0f9ff", bdr: "#bae6fd" },
            { id: "unique",     val: String(totalUniqueHCPs),   label: "Unique HCPs",  col: "#0f172a", bg: "#f0f9ff", bdr: "#bae6fd" },
            { id: "peak",       val: String(totalNodes),        label: "Peak/week",    col: "#0f172a", bg: "#f0f9ff", bdr: "#bae6fd" },
            { id: "delta",      val: `GCN ${dStr}`,             label: "Risk delta",   col: dCol,       bg: "#fff7ed", bdr: "#fed7aa" },
          ].map(chip => (
            <div key={chip.id} style={{ background: chip.bg, border: `1px solid ${chip.bdr}`,
              borderRadius: 8, padding: "3px 8px", display: "flex", flexDirection: "column",
              alignItems: "center", flexShrink: 0 }}>
              <span style={{ fontSize: 15, fontWeight: 800, color: chip.col,
                fontFamily: FONT, lineHeight: 1.1, whiteSpace: "nowrap" }}>{chip.val}</span>
              <span style={{ fontSize: 8, color: "#64748b", fontFamily: FONT,
                textTransform: "uppercase", letterSpacing: "0.04em", whiteSpace: "nowrap" }}>{chip.label}</span>
            </div>
          ))}
        </div>

        {/* Mode toggle */}
        <div style={{ display: "flex", gap: 5, flexShrink: 0 }}>
          <button style={btnStyle(isWeeklyActive)} onClick={() => { stopPlay(); setEgoMode("weekly"); }}>
            📅 Weekly
          </button>
          <button style={btnStyle(!isWeeklyActive)} onClick={() => { stopPlay(); setEgoMode("cumulative"); }}>
            ∑ Cumulative
          </button>
        </div>
      </div>

      {/* ── WEEKLY CONTROLS ── */}
      {isWeeklyActive && (
        <div style={{ flexShrink: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 4 }}>
            <button
              onClick={() => { if (playing) stopPlay(); else { if (weekIdx >= allWeeks.length - 1) setWeekIdx(0); startPlay(); } }}
              style={{ border: "none", background: playing ? "#0284c7" : "#e2e8f0", borderRadius: 6,
                padding: "3px 10px", fontSize: 12, cursor: "pointer", fontWeight: 700,
                fontFamily: FONT, color: playing ? "white" : "#1e293b" }}>
              {playing ? "⏸ Pause" : "▶ Play"}
            </button>
            <span style={{ fontSize: 12, fontWeight: 700, color: "#1e293b", fontFamily: FONT }}>
              Week {currentWeek}
            </span>
            <span style={{ fontSize: 11, color: "#64748b", fontFamily: FONT }}>
              · {initCount} HCPs active
            </span>
          </div>
          <div style={{ position: "relative", paddingBottom: 18 }}>
            <input type="range" min={0} max={allWeeks.length - 1} value={weekIdx}
              onChange={e => { stopPlay(); setWeekIdx(parseInt(e.target.value)); }}
              style={{ width: "100%", accentColor: "#0284c7", cursor: "pointer", margin: 0, display: "block" }}/>
            <WeekDots allWeeks={allWeeks} activeIdx={weekIdx} snapshots={weeklySnapshots}
              onClickIdx={i => { stopPlay(); setWeekIdx(i); }}/>
            <div style={{ display: "flex", justifyContent: "space-between", marginTop: 1,
              fontSize: 9, color: "#94a3b8", fontFamily: FONT }}>
              <span>Wk 0</span><span>Wk {maxWeek}</span>
            </div>
          </div>
        </div>
      )}

      {/* ── CUMULATIVE INFO ── */}
      {!isWeeklyActive && (
        <div style={{ flexShrink: 0, background: "#f0fdf4", border: "1px solid #bbf7d0",
          borderRadius: 8, padding: "6px 14px", fontSize: 11, color: "#14532d", fontFamily: FONT }}>
          <strong>{totalUniqueHCPs}</strong> unique HCPs ·{" "}
          <strong>{cumulNet.edges.length}</strong> co-care relationships ·{" "}
          <strong>{allWeeks.length}</strong> weeks
        </div>
      )}

      {/* ── NETWORK SVG ── */}
      <div style={{ flexShrink: 0 }}>
        {isWeeklyActive && !currentSnap?.nodes?.length
          ? <SoloNetworkSVG hcps={soloHCPs} patientId={patientId} weekNum={currentWeek}/>
          : <NetworkSVG
              nodes={renderNodes} edges={renderEdges}
              cacheKey={renderCacheKey} isCumulative={isCumulative}
              maxEdgeFreq={maxEdgeFreq}
              selectedHCP={selectedHCP}
              onSelectHCP={name => setSelectedHCP(name)}
              onHover={handleHover}
            />}
      </div>

      {/* ── LEGEND ── */}
      <div style={{ flexShrink: 0, padding: "6px 10px", background: "#f8fafc",
        border: "1px solid #e8edf4", borderRadius: 7, minHeight: 24 }}>
        <LegendBar groupKeys={legendGroupKeys}/>
      </div>

      {/* ── TOOLTIP (portal-style fixed positioning) ── */}
      <EgoTooltip tt={tt}/>
    </div>
  );
}