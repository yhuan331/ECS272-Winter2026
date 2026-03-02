import { useState } from "react";
import { patients, type PatientDot } from "../realData";
import { T, CANCER_COLORS } from "../theme";

const FONT = T.font;

interface Props { selectedId: string; onSelectPatient: (id:string)=>void; }

export function ScatterPlot({ selectedId, onSelectPatient }: Props) {
  const [hoverId, setHoverId] = useState<string|null>(null);
  const [activeFilters, setActiveFilters] = useState(new Set(["breast","colon","lung"]));

  const pad = { top:36, right:20, bottom:40, left:44 };
  const W=520, H=460, plotW=W-pad.left-pad.right, plotH=H-pad.top-pad.bottom;
  const maxTeam = Math.max(...patients.map(p=>p.maxTeam),1);
  const selected = patients.find(p=>p.id===selectedId) ?? patients[0];

  const toggle = (c:string) => setActiveFilters(prev => {
    const n = new Set(prev);
    if (n.has(c)) { if(n.size>1) n.delete(c); } else n.add(c);
    return n;
  });

  const visible = patients.filter(p=>activeFilters.has(p.cancer));

  return (
    <div style={{ background:T.bgCard, border:`1px solid ${T.border}`, borderRadius:10,
      padding:14, height:"100%", display:"flex", flexDirection:"column", fontFamily:FONT,
      boxShadow:"0 1px 4px rgba(0,0,0,0.06)" }}>

      <div style={{ color:T.textMuted, fontSize:10, letterSpacing:1.5, marginBottom:8, fontWeight:700 }}>
        PATIENT COHORT OVERVIEW
      </div>

      {/* Cohort toggles */}
      <div style={{ display:"flex", gap:6, marginBottom:8 }}>
        {(["breast","colon","lung"] as const).map(c => {
          const active = activeFilters.has(c);
          const color = CANCER_COLORS[c];
          return (
            <button key={c} onClick={()=>toggle(c)} style={{
              background: active ? color+"18" : "transparent",
              border: `1px solid ${active ? color : T.border}`,
              borderRadius:4, padding:"3px 10px",
              color: active ? color : T.textMuted,
              fontSize:9, fontFamily:FONT, cursor:"pointer",
              textTransform:"uppercase", letterSpacing:1, fontWeight:700,
            }}>{c}</button>
          );
        })}
      </div>

      <svg viewBox={`0 0 ${W} ${H}`} style={{ flex:1, width:"100%", cursor:"crosshair" }}>
        {/* Grid */}
        {[0.25,0.5,0.75].map(f=>(
          <g key={f}>
            <line x1={pad.left} y1={pad.top+plotH*(1-f)} x2={pad.left+plotW} y2={pad.top+plotH*(1-f)} stroke={T.border} strokeWidth={1}/>
            <line x1={pad.left+plotW*f} y1={pad.top} x2={pad.left+plotW*f} y2={pad.top+plotH} stroke={T.border} strokeWidth={1}/>
          </g>
        ))}

        {/* Render non-selected first, selected last (on top) */}
        {[...visible.filter(p=>p.id!==selectedId), ...visible.filter(p=>p.id===selectedId)].map(p => {
          const cx = pad.left + p.x*plotW;
          const cy = pad.top + (1-p.y)*plotH;
          const color = CANCER_COLORS[p.cancer];
          const isSel = p.id===selectedId;
          const isHov = p.id===hoverId;
          const opacity = 0.25 + (p.maxTeam/maxTeam)*0.7;

          return (
            <g key={p.id} style={{cursor:"pointer"}}
              onClick={()=>onSelectPatient(p.id)}
              onMouseEnter={()=>setHoverId(p.id)}
              onMouseLeave={()=>setHoverId(null)}>

              {/* Selection rings */}
              {isSel && <>
                <circle cx={cx} cy={cy} r={15} fill="none"
                  stroke={p.survived ? "#0F172A" : T.red}
                  strokeWidth={2} strokeDasharray={p.survived?"none":"4,2"}/>
                <circle cx={cx} cy={cy} r={20} fill="none" stroke={color} strokeWidth={1} opacity={0.25}/>
              </>}
              {isHov && !isSel && <circle cx={cx} cy={cy} r={10} fill="none" stroke={color} strokeWidth={1} opacity={0.4}/>}

              {p.survived
                ? <circle cx={cx} cy={cy} r={isSel?6:4.5} fill={color}
                    opacity={isSel?1:isHov?0.95:opacity}/>
                : <circle cx={cx} cy={cy} r={isSel?5.5:4} fill="none" stroke={color} strokeWidth={1.5}
                    opacity={isSel?1:isHov?0.9:opacity*0.75}/>
              }
            </g>
          );
        })}

        {/* Axes */}
        <text x={pad.left+plotW/2} y={H-4} textAnchor="middle" fill={T.textFaint} fontSize={9} fontFamily={FONT}>Network Density →</text>
        <text x={12} y={pad.top+plotH/2} textAnchor="middle" fill={T.textFaint} fontSize={9} fontFamily={FONT} transform={`rotate(-90,12,${pad.top+plotH/2})`}>Avg Risk Score ↑</text>
      </svg>

      {selected && <InfoCard patient={selected}/>}

      {/* Legend */}
      <div style={{ display:"flex", gap:12, marginTop:8, flexWrap:"wrap", alignItems:"center" }}>
        {(["breast","colon","lung"] as const).map(c=>(
          <div key={c} style={{ display:"flex", alignItems:"center", gap:4 }}>
            <svg width={8} height={8}><circle cx={4} cy={4} r={3.5} fill={CANCER_COLORS[c]}/></svg>
            <span style={{ color:T.textMuted, fontSize:9, fontFamily:FONT, textTransform:"uppercase" }}>{c}</span>
          </div>
        ))}
        <div style={{ display:"flex", alignItems:"center", gap:4 }}>
          <svg width={8} height={8}><circle cx={4} cy={4} r={3} fill="none" stroke={T.textMuted} strokeWidth={1.2}/></svg>
          <span style={{ color:T.textMuted, fontSize:9 }}>Deceased</span>
        </div>
        <span style={{ color:T.textFaint, fontSize:8 }}>opacity = team size</span>
      </div>
    </div>
  );
}

function InfoCard({ patient }: { patient: PatientDot }) {
  const color = CANCER_COLORS[patient.cancer];
  return (
    <div style={{ background:T.bgInset, border:`1px solid ${T.border}`, borderRadius:8,
      padding:"8px 12px", marginTop:6 }}>
      <div style={{ color, fontSize:12, fontWeight:700, marginBottom:3 }}>{patient.id}</div>
      <div style={{ color:T.textSecondary, fontSize:10, lineHeight:1.7 }}>
        SURVIVED: {patient.survived?"YES":"NO"} | WEEKS: {patient.weeks}<br/>
        AVG RISK: {patient.avgRisk}% | MAX TEAM: {patient.maxTeam} | DENSITY: {patient.density}%
      </div>
    </div>
  );
}