import { useState, useEffect, useState as useS, useRef as useR, useRef, useCallback } from "react";
import { RadialGlyph } from "./components/RadialGlyph";
import type { ViewMode } from "./components/RadialGlyph";
import { HCPBarChart } from "./components/HCPBarChart";
import { EgoNetwork } from "./components/EgoNetwork";
import { ScatterPlot } from "./components/ScatterPlot";
import {
  initRealData, switchPatient, switchComparePatient, clearComparePatient,
  selectedPatientId, totalPatientHCP, compareWeeklyData, compareSurgeonEvents, compareTotalHCP,
  getPatientSummary, weeklyData, getPatientById, globalMaxWeeks, patients,
  getPatientSurrogateRanking, computePerturbedRisk,
} from "./realData";
import type { PatientDot, WeekData, SurrogateFeature } from "./realData";
import { classifyHCP } from "./realData";
import { T, CANCER_COLORS, SPECIALTY_COLORS } from "./theme";

let _temporal: Record<string,unknown> = {};
let _egoMap:   Record<string,unknown> = {};
const nanSafe = (p:string) =>
  fetch(p).then(r=>r.text()).then(t=>
    JSON.parse(t.replace(/\bNaN\b/g,"null").replace(/-Infinity\b/g,"null").replace(/\bInfinity\b/g,"null"))
  );

// ── color helpers ─────────────────────────────────────────────────────────────
function lerpHex(a:string,b:string,t:number){
  const p=(h:string,o:number)=>parseInt(h.slice(o,o+2),16);
  const ch=(v:number)=>Math.max(0,Math.min(255,v)).toString(16).padStart(2,"0");
  return`#${ch(Math.round(p(a,1)+(p(b,1)-p(a,1))*t))}${ch(Math.round(p(a,3)+(p(b,3)-p(a,3))*t))}${ch(Math.round(p(a,5)+(p(b,5)-p(a,5))*t))}`;
}
function survivalColor(prob:number){
  const s=[{t:0,c:"#276749"},{t:.25,c:"#68D391"},{t:.45,c:"#DD6B20"},{t:.55,c:"#D69E2E"},{t:.75,c:"#E53E3E"},{t:1,c:"#9B2335"}];
  const p=Math.min(1,Math.max(0,prob));
  for(let i=0;i<s.length-1;i++) if(p>=s[i].t&&p<=s[i+1].t) return lerpHex(s[i].c,s[i+1].c,(p-s[i].t)/(s[i+1].t-s[i].t));
  return p<=0?s[0].c:s[s.length-1].c;
}
function riskGrad(t:number){
  const s=[{t:0,c:"#38A169"},{t:.3,c:"#D69E2E"},{t:.5,c:"#DD6B20"},{t:.75,c:"#E53E3E"},{t:1,c:"#9B2335"}];
  for(let i=0;i<s.length-1;i++) if(t>=s[i].t&&t<=s[i+1].t) return lerpHex(s[i].c,s[i+1].c,(t-s[i].t)/(s[i+1].t-s[i].t));
  return t<=0?s[0].c:s[s.length-1].c;
}
function spkColor(d:number){
  if(d>.005) return riskGrad(.6+Math.min(.4,d*10));
  if(d<-.005) return riskGrad(Math.max(0,.3-Math.abs(d)*8));
  return riskGrad(.45);
}
function polarToCart(cx:number,cy:number,r:number,a:number){
  const rad=((a-90)*Math.PI)/180; return{x:cx+r*Math.cos(rad),y:cy+r*Math.sin(rad)};
}
function arcStr(cx:number,cy:number,r:number,s:number,e:number){
  const sp=polarToCart(cx,cy,r,s),ep=polarToCart(cx,cy,r,e);
  return`M${sp.x},${sp.y} A${r},${r} 0 ${e-s>180?1:0} 1 ${ep.x},${ep.y}`;
}

const FONT = T.font;

// ── atoms ─────────────────────────────────────────────────────────────────────
function Stat({label,value,color,xl}:{label:string;value:string;color:string;xl?:boolean}){
  return(
    <div style={{background:"#F8FAFC",border:`2px solid ${color}28`,borderRadius:9,padding:"11px 14px"}}>
      <div style={{color:"#64748B",fontSize:10,fontWeight:700,letterSpacing:1.2,marginBottom:4,
        textTransform:"uppercase",fontFamily:FONT}}>{label}</div>
      <div style={{color,fontSize:xl?28:20,fontWeight:800,fontFamily:FONT,lineHeight:1}}>{value}</div>
    </div>
  );
}

function PatientBadge({pt,label,color,onRemove}:{pt:PatientDot;label:string;color:string;onRemove?:()=>void}){
  return(
    <div style={{display:"flex",alignItems:"center",gap:8,
      background:color+"12",border:`2px solid ${color}`,
      borderRadius:8,padding:"5px 12px",flexShrink:0}}>
      <span style={{background:color,color:"#fff",fontSize:9,fontWeight:800,
        fontFamily:FONT,borderRadius:4,padding:"2px 8px",letterSpacing:.8}}>{label}</span>
      <span style={{color,fontSize:12,fontWeight:800,fontFamily:FONT}}>{pt.id}</span>
      <span style={{color:"#475569",fontSize:10,fontFamily:FONT}}>
        {pt.cancer} · {pt.survived?"survived":"deceased"} · {pt.avgRisk}%
      </span>
      {onRemove&&(
        <button onClick={onRemove} style={{marginLeft:2,width:20,height:20,borderRadius:4,border:"none",
          background:color+"22",cursor:"pointer",color,fontSize:14,fontWeight:800,lineHeight:1,
          display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0}}>×</button>
      )}
    </div>
  );
}

// ── black section label bar ───────────────────────────────────────────────────
function BlockLabel({text,right}:{text:string;right?:React.ReactNode}){
  return(
    <div style={{background:"#0F172A",borderRadius:"8px 8px 0 0",
      padding:"9px 16px",display:"flex",alignItems:"center",gap:10}}>
      <span style={{color:"white",fontSize:11,fontWeight:800,fontFamily:FONT,letterSpacing:1.2,flex:1}}>
        {text}
      </span>
      {right}
    </div>
  );
}

// ── colored column header ─────────────────────────────────────────────────────
function ColHeader({label,color,id,pt,avgRisk,totalHCP,numWeeks,sharedWeek,onClearWeek,onRemove}:{
  label:string;color:string;id:string;pt?:PatientDot|null;
  avgRisk:string;totalHCP:number;numWeeks:number;
  sharedWeek:number|null;onClearWeek:()=>void;onRemove?:()=>void;
}){
  const pct=globalMaxWeeks>0?Math.round((numWeeks/globalMaxWeeks)*100):0;
  return(
    <div style={{background:color,padding:"10px 16px",
      display:"flex",alignItems:"center",gap:10,flexWrap:"wrap",flexShrink:0}}>
      <span style={{background:"rgba(255,255,255,.22)",color:"#fff",fontSize:11,fontWeight:800,
        fontFamily:FONT,borderRadius:5,padding:"3px 10px",letterSpacing:1}}>{label}</span>
      <span style={{color:"#fff",fontSize:16,fontWeight:800,fontFamily:FONT}}>{id}</span>
      {pt&&<>
        <span style={{color:"rgba(255,255,255,.75)",fontSize:11,fontFamily:FONT,textTransform:"uppercase"}}>{pt.cancer}</span>
        <span style={{fontSize:11,fontWeight:800,fontFamily:FONT,
          color:pt.survived?"#86EFAC":"#FCA5A5"}}>{pt.survived?"SURVIVED":"DECEASED"}</span>
        <span style={{color:"rgba(255,255,255,.85)",fontSize:11,fontFamily:FONT}}>
          Risk <strong>{avgRisk}%</strong>
        </span>
        <span style={{color:"rgba(255,255,255,.85)",fontSize:11,fontFamily:FONT}}>{totalHCP} HCPs</span>
      </>}
      <div style={{marginLeft:"auto",display:"flex",alignItems:"center",gap:6,flexShrink:0}}>
        {sharedWeek!=null?(
          <>
            <span style={{background:"rgba(255,255,255,.25)",color:"#fff",fontSize:11,fontWeight:800,
              fontFamily:FONT,borderRadius:5,padding:"3px 10px"}}>WEEK {sharedWeek}</span>
            <button onClick={onClearWeek} style={{background:"rgba(255,255,255,.15)",border:"none",
              borderRadius:5,padding:"3px 10px",cursor:"pointer",color:"#fff",fontSize:10,fontFamily:FONT}}>
              ✕ clear
            </button>
          </>
        ):(
          <>
            <div style={{width:52,height:5,background:"rgba(255,255,255,.25)",borderRadius:3,overflow:"hidden"}}>
              <div style={{height:"100%",width:`${pct}%`,background:"rgba(255,255,255,.9)",borderRadius:3}}/>
            </div>
            <span style={{color:"rgba(255,255,255,.85)",fontSize:11,fontWeight:700,fontFamily:FONT}}>{numWeeks}w</span>
          </>
        )}
        {onRemove&&(
          <button onClick={onRemove} style={{
            marginLeft:4,background:"rgba(255,255,255,.15)",border:"2px solid rgba(255,255,255,.4)",
            borderRadius:6,padding:"4px 12px",cursor:"pointer",
            color:"#fff",fontSize:10,fontFamily:FONT,fontWeight:800,letterSpacing:.8}}>
            ✕ REMOVE
          </button>
        )}
      </div>
    </div>
  );
}
function WeekDetail({data,color,mode}:{data:WeekData;color:string;mode:ViewMode}){
  return(
    <div style={{background:"#fff",border:`2px solid ${color}33`,borderRadius:10,padding:"16px 18px"}}>
      <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:12,flexWrap:"wrap"}}>
        <span style={{color:"#0F172A",fontSize:24,fontWeight:800,fontFamily:FONT,letterSpacing:.5}}>
          WEEK {data.week}
        </span>
        <span style={{color,fontSize:13,fontWeight:800,background:color+"14",
          border:`2px solid ${color}33`,borderRadius:6,padding:"3px 11px",fontFamily:FONT}}>
          {mode==="prob"
            ?`RISK ${(data.riskScore*100).toFixed(1)}%`
            :`Δ ${data.probDelta>=0?"+":""}${(data.probDelta*100).toFixed(2)}%`}
        </span>
        <span style={{marginLeft:"auto",color:data.spikeColor,fontSize:12,fontWeight:800,fontFamily:FONT}}>
          {data.probDelta>.005?"↑ RISING":data.probDelta<-.005?"↓ FALLING":"→ STABLE"}
        </span>
      </div>
      <div style={{display:"grid",gridTemplateColumns:"repeat(3,1fr)",gap:8,marginBottom:14}}>
        <Stat label="Team Size"      value={String(data.teamSize)}  color="#6B9FFF"/>
        <Stat label="Care Diversity" value={data.entropy==null?"—":`${data.entropy.toFixed(2)}`} color="#A78BFA"/>
        <Stat label="HCP Types"      value={String((data.hcpNames??[]).length)} color={color}/>
      </div>
      <div style={{marginBottom:14}}>
        <div style={{color:"#0F172A",fontSize:11,fontWeight:800,letterSpacing:1,marginBottom:6,fontFamily:FONT}}>
          ACTIVE SPECIALTIES
        </div>
        <div style={{display:"flex",flexWrap:"wrap",gap:4}}>
          {(data.hcpNames??[]).filter(n=>n&&n!=="nan"&&n!=="null"&&n!=="UNKNOWN"&&n!=="NONE").slice(0,12).map((n,i)=>(
            <span key={i} style={{background:color+"10",border:`2px solid ${color}22`,
              borderRadius:4,padding:"3px 9px",color,fontSize:10,fontFamily:FONT,fontWeight:700}}>{n}</span>
          ))}
          {(!(data.hcpNames??[]).length)&&
            <span style={{color:"#94A3B8",fontSize:10,fontFamily:FONT}}>No specialty data</span>}
        </div>
      </div>
      <div>
        <div style={{color:"#0F172A",fontSize:11,fontWeight:800,letterSpacing:1,marginBottom:4,fontFamily:FONT}}>
          SURROGATE MODEL WEIGHTS
        </div>
        <div style={{color:"#64748B",fontSize:10,marginBottom:8,fontFamily:FONT}}>
          Features active this week · bar = |contribution| this week · red raises risk · green protective
        </div>
        {(()=>{
          // ── Provider type code → human label ──────────────────────────────
          const PROV_TYPE_LABELS: Record<string,string> = {
            "N":"Nursing / NP", "MD":"Physician (MD)", "RN":"Registered Nurse",
            "NP":"Nurse Practitioner", "PA":"Physician Assistant", "LVN":"LVN / LPN",
            "DO":"Physician (DO)", "PHD":"Psychologist (PhD)", "PHARMD":"Pharmacist",
            "RPH":"Pharmacist (RPh)", "PT":"Physical Therapist", "OT":"Occupational Therapist",
            "SLP":"Speech-Language Pathologist", "RT":"Respiratory Therapist",
            "RD":"Registered Dietitian", "SW":"Social Worker", "LCSW":"Social Worker (LCSW)",
            "MSW":"Social Worker (MSW)", "TECH":"Technician", "CNA":"Nursing Assistant",
            "MA":"Medical Assistant", "SCRIBE":"Scribe",
          };

          // ── Decode a raw feature string into a clean display label ────────
          function decodeFeature(feat: string): string {
            const parts  = feat.split("::");
            const prefix = parts[0] ?? "";
            const value  = (parts[1] ?? "").replace(/^\*/,"").trim();
            // Provider type: look up in label map, else humanize
            if (prefix === "ACCESS_USER_PROV_TYPE") {
              const upper = value.toUpperCase().replace(/[^A-Z0-9]/g," ").trim();
              // Try exact key first
              for (const [k,v] of Object.entries(PROV_TYPE_LABELS)) {
                if (upper === k) return v;
              }
              // Strip leading dots/punctuation and title-case
              return value.replace(/^[^a-zA-Z0-9]+/,"").replace(/_/g," ")
                .replace(/\b\w/g,c=>c.toUpperCase()).trim() || "Provider Type";
            }
            if (prefix === "ACCESS_USER_PROV_SPECIALTY") {
              return value.replace(/_/g," ").replace(/\b\w/g,c=>c.toUpperCase()).trim();
            }
            if (prefix === "ACCESS_USER_CLINICIAN_TITLE") {
              return value.replace(/^[^a-zA-Z0-9]+/,"").replace(/_/g," ")
                .replace(/\b\w/g,c=>c.toUpperCase()).trim() || "Clinician Title";
            }
            if (prefix === "ACCESS_USER_IS_RESIDENT")  return "Resident";
            if (prefix === "INPATIENT_DEPT_YN")         return "Inpatient Dept";
            return value.replace(/^[^a-zA-Z0-9]+/,"").replace(/_/g," ")
              .replace(/\b\w/g,c=>c.toUpperCase()).trim() || feat;
          }

          // ── Merge freq + present rows for the same entity ─────────────────
          // Key = prefix::value (strip the ::freq / ::present suffix)
          const mergedMap: Record<string, {
            label: string;
            totalContrib: number;
            totalValue: number;
            weight: number;
            active: boolean;
            feat: string;
          }> = {};

          for (const s of (data.topContrib ?? [])) {
            const parts  = s.feature.split("::");
            const key    = `${parts[0]}::${parts[1] ?? ""}`;
            const label  = decodeFeature(s.feature);
            if (!mergedMap[key]) {
              mergedMap[key] = {
                label, feat: s.feature,
                totalContrib: 0, totalValue: 0,
                weight: s.weight, active: false,
              };
            }
            mergedMap[key].totalContrib += s.contribution;
            mergedMap[key].totalValue   += s.value;
            if (s.value !== 0) mergedMap[key].active = true;
          }

          const merged = Object.values(mergedMap)
            .sort((a,b) => Math.abs(b.totalContrib) - Math.abs(a.totalContrib));

          const active   = merged.filter(m => m.active);
          const inactive = merged.filter(m => !m.active).slice(0, 3);
          const display  = [...active, ...inactive];

          if (display.length === 0) return (
            <span style={{color:"#94A3B8",fontSize:11,fontFamily:FONT}}>No surrogate data for this week</span>
          );

          const maxC = Math.max(...display.map(m => Math.abs(m.totalContrib)), 0.001);

          return display.map((m, si) => {
            const isHarmful = m.totalContrib > 0;
            const barW = Math.min(88, (Math.abs(m.totalContrib) / maxC) * 88);
            const col  = m.active ? (isHarmful ? "#E53E3E" : "#38A169") : "#CBD5E1";
            return (
              <div key={si} style={{display:"flex",alignItems:"center",gap:8,padding:"6px 0",
                borderBottom:"1px solid #F1F5F9", opacity: m.active ? 1 : 0.38}}>
                <div style={{flex:1,minWidth:0}}>
                  <div style={{color: m.active ? "#0F172A" : "#94A3B8",
                    fontSize:11,fontFamily:FONT,fontWeight: m.active ? 600 : 400,
                    overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>
                    {m.label}
                  </div>
                  <div style={{color:"#94A3B8",fontSize:9,fontFamily:FONT,marginTop:1}}>
                    {m.active
                      ? `val=${m.totalValue.toFixed(1)} · w=${m.weight > 0 ? "+" : ""}${m.weight.toFixed(3)}`
                      : "not active this week"
                    }
                  </div>
                </div>
                <div style={{width:88,height:7,background:"#F1F5F9",borderRadius:3,overflow:"hidden",flexShrink:0}}>
                  <div style={{height:"100%",width: m.active ? barW : 0,
                    background:col,borderRadius:3,transition:"width .2s"}}/>
                </div>
                <span style={{color:col,fontSize:11,fontWeight:800,
                  minWidth:52,textAlign:"right",fontFamily:FONT}}>
                  {m.active
                    ? `${m.totalContrib >= 0 ? "+" : ""}${m.totalContrib.toFixed(3)}`
                    : <span style={{color:"#CBD5E1",fontWeight:400,fontSize:10}}>—</span>
                  }
                </span>
              </div>
            );
          });
        })()}
        {data.topContrib?.length > 0 &&
          (data.topContrib.filter(s => s.value !== 0).length === 0) && (
          <div style={{padding:"8px 0",color:"#94A3B8",fontSize:11,fontFamily:FONT}}>
            No features active this week — minimal care contact.
          </div>
        )}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// COMPARE GLYPH (patient B radial — standalone, no RadialGlyph dependency)
// ─────────────────────────────────────────────────────────────────────────────
interface CGProps{weeklySnap:WeekData[];surgeonSnap:number[];totalHCP:number;
  selectedWeek:number|null;onSelectWeek:(w:number|null)=>void;
  mode:ViewMode;}
function CompareGlyph({weeklySnap,surgeonSnap,totalHCP,selectedWeek,onSelectWeek,mode}:CGProps){
  const [hovIdx,setHovIdx]=useS<number|null>(null);
  const svgRef=useR<SVGSVGElement>(null);
  const CX=350,CY=280,BASE_R=130,CENTER_R=110,SIZE=700;
  const accent="#6B46C1";
  if(!weeklySnap.length) return(
    <div style={{height:"100%",display:"flex",alignItems:"center",justifyContent:"center",
      color:"#94A3B8",fontFamily:FONT,fontSize:14,letterSpacing:1.5,
      background:"#fff",border:"2px solid #E2E8F0",borderRadius:10}}>NO DATA</div>
  );
  const n=weeklySnap.length;
  const safeMax=Math.max(globalMaxWeeks,n,1);
  const arcFrac=n/safeMax;const usedArc=arcFrac*360;const apw=usedArc/Math.max(n,1);
  const maxP=Math.max(...weeklySnap.map(d=>d.riskScore),.001);
  const minP=Math.min(...weeklySnap.map(d=>d.riskScore),0);
  const pRng=maxP-minP||.001;
  const maxD=Math.max(...weeklySnap.map(d=>Math.abs(d.probDelta)),.001);
  const maxT=Math.max(...weeklySnap.map(d=>d.teamSize),1);
  const minT=Math.min(...weeklySnap.map(d=>d.teamSize),0);
  const tRng=maxT-minT||1;
  const avgRisk=((weeklySnap.reduce((s,d)=>s+d.riskScore,0)/n)*100).toFixed(1);
  const avgDelta=n>1?(weeklySnap.slice(1).reduce((s,d,i)=>s+Math.abs((d?.teamSize??0)-(weeklySnap[i]?.teamSize??0)),0)/(n-1)).toFixed(1):"0.0";
  const spikes=weeklySnap.map((d,i)=>{
    const ca=i*apw;let h:number,c:string;
    if(mode==="prob"){h=10+((d.riskScore-minP)/pRng)*95;c=survivalColor(d.riskScore);}
    else{h=10+(Math.abs(d.probDelta)/maxD)*95;c=spkColor(d.probDelta);}
    const oR=BASE_R+h;const wn=(d.teamSize-minT)/tRng;const sw=apw*(.35+wn*.55);
    const a1=ca-sw/2,a2=ca+sw/2;
    const p1=polarToCart(CX,CY,BASE_R,a1),p2=polarToCart(CX,CY,BASE_R,a2);
    const p3=polarToCart(CX,CY,oR,a2),p4=polarToCart(CX,CY,oR,a1);
    const ha1=ca-apw/2,ha2=ca+apw/2;
    const h1=polarToCart(CX,CY,BASE_R-4,ha1),h2=polarToCart(CX,CY,BASE_R-4,ha2);
    const h3=polarToCart(CX,CY,oR+6,ha2),h4=polarToCart(CX,CY,oR+6,ha1);
    return{d,i,c,oR,ca,
      path:`M${p1.x},${p1.y} L${p4.x},${p4.y} L${p3.x},${p3.y} L${p2.x},${p2.y} Z`,
      hit:`M${h1.x},${h1.y} L${h4.x},${h4.y} L${h3.x},${h3.y} L${h2.x},${h2.y} Z`};
  });
  const oPts=spikes.map(s=>({...polarToCart(CX,CY,s.oR,s.ca),color:s.c}));
  const oPath=oPts.map((p,i)=>i===0?`M${p.x},${p.y}`:`L${p.x},${p.y}`).join(" ");
  const segs=[{f:"#EEF2FF",sa:-90,ea:30},{f:"#F0FFF4",sa:30,ea:150},{f:"#FFFBEB",sa:150,ea:270}];
  const arcPct=Math.round(arcFrac*100);
  return(
    <div style={{height:"100%",background:"#fff",border:"2px solid #E2E8F0",borderRadius:10,display:"flex",flexDirection:"column"}}>
      <div style={{display:"flex",alignItems:"center",padding:"7px 14px",borderBottom:"2px solid #E2E8F0",flexShrink:0}}>
        <span style={{color:accent,fontSize:11,fontWeight:800,fontFamily:FONT,letterSpacing:1}}>
          {mode==="prob"?"GNN DEATH PROB":"Δ PROBABILITY"}
        </span>
        <span style={{marginLeft:"auto",color:"#94A3B8",fontSize:10,fontFamily:FONT}}>
          {n}w / {safeMax}w ({arcPct}%)
        </span>
      </div>
      <div style={{flex:1,display:"flex",alignItems:"center",justifyContent:"center",overflow:"hidden",minHeight:0}}>
        <svg ref={svgRef} viewBox={`0 0 ${SIZE} 560`} preserveAspectRatio="xMidYMid meet"
          style={{width:"100%",height:"100%",maxWidth:"100%",maxHeight:"100%",display:"block"}}>
          <defs>
            {spikes.map((_,i)=>(
              <radialGradient key={`cg${i}`} id={`cG_b_${i}`} cx="50%" cy="50%" r="50%">
                <stop offset="0%" stopColor={spikes[i].c} stopOpacity={.38}/>
                <stop offset="100%" stopColor={spikes[i].c} stopOpacity={1}/>
              </radialGradient>
            ))}
            <filter id="cGlw"><feGaussianBlur in="SourceGraphic" stdDeviation="3"/></filter>
            <filter id="cHvr"><feGaussianBlur in="SourceGraphic" stdDeviation="4"/></filter>
          </defs>
          {arcFrac<.99&&<path d={arcStr(CX,CY,BASE_R,usedArc,360)} fill="none" stroke="#E2E8F0" strokeWidth={1.5} strokeDasharray="4,4" opacity={.5}/>}
          {segs.map((sg,si)=>{const sw=sg.ea-sg.sa;const p1=polarToCart(CX,CY,CENTER_R,sg.sa);const p2=polarToCart(CX,CY,CENTER_R,sg.ea);return(
            <path key={si} d={`M${CX},${CY} L${p1.x},${p1.y} A${CENTER_R},${CENTER_R} 0 ${sw>180?1:0} 1 ${p2.x},${p2.y} Z`} fill={sg.f}/>);})}
          {[-90,30,150,270].map(a=>{const p=polarToCart(CX,CY,CENTER_R,a);return<line key={a} x1={CX} y1={CY} x2={p.x} y2={p.y} stroke="#E2E8F0" strokeWidth={1}/>;}) }
          {(()=>{const lp=polarToCart(CX,CY,CENTER_R*.45,-30);const vp=polarToCart(CX,CY,CENTER_R*.62,-30);return(<g>
            <text x={lp.x} y={lp.y-3} textAnchor="middle" dominantBaseline="central" fill="#94A3B8" fontSize={10} fontFamily={FONT}>UNIQUE HCP</text>
            <text x={vp.x} y={vp.y+3} textAnchor="middle" dominantBaseline="central" fill={accent} fontSize={18} fontFamily={FONT} fontWeight={800}>{totalHCP}</text>
          </g>);})()}
          {(()=>{const lp=polarToCart(CX,CY,CENTER_R*.45,90);const vp=polarToCart(CX,CY,CENTER_R*.62,90);return(<g>
            <text x={lp.x} y={lp.y-3} textAnchor="middle" dominantBaseline="central" fill="#94A3B8" fontSize={10} fontFamily={FONT}>VOLATILITY</text>
            <text x={vp.x} y={vp.y+3} textAnchor="middle" dominantBaseline="central" fill="#38A169" fontSize={14} fontFamily={FONT} fontWeight={800}>{avgDelta}/wk</text>
          </g>);})()}
          {(()=>{const lp=polarToCart(CX,CY,CENTER_R*.32,210);return(<g>
            <text x={lp.x} y={lp.y+1} textAnchor="middle" dominantBaseline="central" fill="#D69E2E" fontSize={12} fontFamily={FONT} fontWeight={700}>{avgRisk}% avg</text>
          </g>);})()}
          <circle cx={CX} cy={CY} r={BASE_R} fill="none" stroke="#CBD5E1" strokeWidth={1.5}/>
          {spikes.map((s,i)=>{
            const ih=hovIdx===i;const iw=selectedWeek!==null&&weeklySnap[i]?.week===selectedWeek;
            return(<g key={i}>
              {(ih||iw)&&<path d={s.path} fill={s.c} opacity={iw?.5:.35} filter="url(#cHvr)"/>}
              <path d={s.path} fill={`url(#cG_b_${i})`} stroke={s.c}
                strokeWidth={ih||iw?2:.4} strokeOpacity={ih||iw?1:.4}
                opacity={selectedWeek!==null&&!iw?.35:1}/>
            </g>);
          })}
          {spikes.map((s,i)=>(
            <path key={`ch${i}`} d={s.hit} fill="transparent" stroke="none" style={{cursor:"pointer"}}
              onMouseEnter={()=>{setHovIdx(i);}}
              onMouseMove={()=>{setHovIdx(i);}}
              onMouseLeave={()=>{setHovIdx(null);}}
              onClick={()=>{const w=weeklySnap[i];if(!w)return;onSelectWeek(selectedWeek===w.week?null:w.week);}}
            />
          ))}
          <path d={oPath} fill="none" stroke={accent} strokeWidth={6} opacity={.12} filter="url(#cGlw)"/>
          {oPts.map((p,i)=>{if(i===0)return null;const prev=oPts[i-1];return<line key={i} x1={prev.x} y1={prev.y} x2={p.x} y2={p.y} stroke={p.color} strokeWidth={2} strokeLinecap="round"/>;}) }
          <path d={oPath} fill="none" stroke="rgba(0,0,0,.06)" strokeWidth={.8}/>
          {hovIdx!==null&&hovIdx>0&&<line x1={oPts[hovIdx-1].x} y1={oPts[hovIdx-1].y} x2={oPts[hovIdx].x} y2={oPts[hovIdx].y} stroke="#0F172A" strokeWidth={2} strokeLinecap="round" opacity={.5}/>}
          {(()=>{const s=polarToCart(CX,CY,BASE_R,0);const l=polarToCart(CX,CY,BASE_R+142,0);return(<g>
            <line x1={s.x} y1={s.y} x2={l.x} y2={l.y} stroke="#94A3B8" strokeWidth={1} strokeDasharray="4,4"/>
            <text x={l.x} y={l.y} textAnchor="middle" fill="#94A3B8" fontSize={10} fontFamily={FONT}>week 0</text>
          </g>);})()}
          {n>1&&(()=>{const la=(n-1)*apw;const s=polarToCart(CX,CY,BASE_R,la);const l=polarToCart(CX,CY,BASE_R+144,la);return(<g>
            <line x1={s.x} y1={s.y} x2={l.x} y2={l.y} stroke="#CBD5E1" strokeWidth={1} strokeDasharray="4,4"/>
            <text x={l.x} y={l.y} textAnchor="middle" fill="#94A3B8" fontSize={10} fontFamily={FONT} dominantBaseline="central">last w{n-1}</text>
          </g>);})()}
          {surgeonSnap.map(wn=>{
            const idx=weeklySnap.findIndex(w=>w.week===wn);if(idx<0)return null;
            const d=weeklySnap[idx];
            const h=mode==="prob"?10+((d.riskScore-minP)/pRng)*95:10+(Math.abs(d.probDelta)/maxD)*95;
            const o=polarToCart(CX,CY,BASE_R+h+10,idx*apw);
            return<circle key={wn} cx={o.x} cy={o.y} r={4} fill="#FFD166" opacity={.9}/>;
          })}
        </svg>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// WHAT-IF PANEL
// ─────────────────────────────────────────────────────────────────────────────
function WhatIfPanel({groups,removed,onToggle,baseRisk}:{
  groups:string[];removed:Set<string>;onToggle:(g:string)=>void;baseRisk:string;
}){
  const delta=removed.size?(removed.size*1.2).toFixed(1):null;
  return(
    <div style={{padding:"16px 20px"}}>
      <div style={{display:"flex",gap:14,marginBottom:16,flexWrap:"wrap"}}>
        <div style={{background:"#FFFBEB",border:"2px solid #D69E2E44",borderRadius:10,padding:"12px 18px",minWidth:140}}>
          <div style={{color:"#D69E2E",fontSize:10,fontWeight:800,letterSpacing:1.5,marginBottom:4,fontFamily:FONT}}>BASE RISK</div>
          <div style={{color:"#D69E2E",fontSize:28,fontWeight:800,fontFamily:FONT}}>{baseRisk}%</div>
        </div>
        <div style={{background:"#FFF5F5",border:`2px solid ${delta?"#E53E3E44":"#E2E8F0"}`,borderRadius:10,padding:"12px 18px",minWidth:140}}>
          <div style={{color:delta?"#E53E3E":"#94A3B8",fontSize:10,fontWeight:800,letterSpacing:1.5,marginBottom:4,fontFamily:FONT}}>EST. CHANGE</div>
          <div style={{color:delta?"#E53E3E":"#94A3B8",fontSize:28,fontWeight:800,fontFamily:FONT}}>{delta?`+${delta}%`:"—"}</div>
        </div>
        <div style={{flex:1,display:"flex",alignItems:"center",minWidth:180}}>
          <p style={{color:"#64748B",fontSize:12,fontFamily:FONT,lineHeight:1.7,margin:0}}>
            Toggle specialty groups below to simulate removing that care type.
            Each removed group estimates a <strong style={{color:"#E53E3E"}}>+1.2% risk increase</strong>.
          </p>
        </div>
      </div>
      <div style={{display:"flex",flexWrap:"wrap",gap:6}}>
        {groups.map(g=>{const rm=removed.has(g);return(
          <button key={g} onClick={()=>onToggle(g)} style={{
            padding:"6px 12px",borderRadius:6,cursor:"pointer",
            background:rm?"#FED7D7":"#F8FAFC",
            border:`2px solid ${rm?"#E53E3E":"#CBD5E1"}`,
            color:rm?"#E53E3E":"#334155",
            fontSize:11,fontFamily:FONT,fontWeight:rm?800:500,
            textDecoration:rm?"line-through":"none",transition:"all .12s"}}>
            {g.length>26?g.slice(0,24)+"…":g}
          </button>);})}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// COMPARE VIEW — synchronized scrolling columns
// Extracted as its own component so hooks (useRef/useCallback) work correctly
// ─────────────────────────────────────────────────────────────────────────────
function CompareView({
  focusId, cmpId, focusPt, cmpPt,
  avgRiskAll, totalPatientHCP, avgNotes, peakWeek,
  cmpSum, cmpHCPSnap, cmpSnap, cmpSurgSnap,
  tick, cmpTick, mode, onModeChange,
  sharedWeek, onSharedWeek,
  selWeekDataA, selWeekDataB,
  onClearCompare,
}: {
  focusId: string; cmpId: string;
  focusPt: PatientDot | undefined; cmpPt: PatientDot | undefined;
  avgRiskAll: string; totalPatientHCP: number; avgNotes: string;
  peakWeek: WeekData | null | undefined;
  cmpSum: { avgRiskAll: string; avgNotes: string; peakWeek: WeekData | null | undefined };
  cmpHCPSnap: number; cmpSnap: WeekData[]; cmpSurgSnap: number[];
  tick: number; cmpTick: number; mode: ViewMode; onModeChange: (m: ViewMode) => void;
  sharedWeek: number | null; onSharedWeek: (w: number | null) => void;
  selWeekDataA: WeekData | null; selWeekDataB: WeekData | null;
  onClearCompare: () => void;
}) {
  const colARef = useRef<HTMLDivElement>(null);
  const colBRef = useRef<HTMLDivElement>(null);
  const syncing  = useRef(false);

  const onScrollA = useCallback((e: React.UIEvent<HTMLDivElement>) => {
    if (syncing.current) return;
    syncing.current = true;
    const top = (e.currentTarget as HTMLDivElement).scrollTop;
    if (colBRef.current) colBRef.current.scrollTop = top;
    requestAnimationFrame(() => { syncing.current = false; });
  }, []);

  const onScrollB = useCallback((e: React.UIEvent<HTMLDivElement>) => {
    if (syncing.current) return;
    syncing.current = true;
    const top = (e.currentTarget as HTMLDivElement).scrollTop;
    if (colARef.current) colARef.current.scrollTop = top;
    requestAnimationFrame(() => { syncing.current = false; });
  }, []);

  return (
    <div style={{flex:1,minHeight:0,display:"flex",flexDirection:"column",overflow:"hidden"}}>
      <div style={{flex:1,minHeight:0,display:"flex",overflow:"hidden"}}>

        {/* ── COLUMN A ── */}
        <div style={{flex:1,minWidth:0,display:"flex",flexDirection:"column",
          overflow:"hidden",borderRight:"3px solid #E2E8F0"}}>
          <ColHeader
            label="A" color="#2B6CB0" id={focusId} pt={focusPt}
            avgRisk={avgRiskAll} totalHCP={totalPatientHCP}
            numWeeks={weeklyData.length}
            sharedWeek={sharedWeek} onClearWeek={()=>onSharedWeek(null)}/>
          <div ref={colARef} onScroll={onScrollA}
            style={{flex:1,overflowY:"auto",padding:"14px",
            display:"flex",flexDirection:"column",gap:14,background:"#F8FAFC"}}>

            {/* Radial — 85vh so spiral fills most of the viewport */}
            <div style={{height:"78vh",flexShrink:0}}>
              <RadialGlyph key={focusId+tick+"cmp"}
                selectedWeek={sharedWeek} onSelectWeek={onSharedWeek}
                mode={mode} onModeChange={onModeChange} accentColor="#2B6CB0"/>
            </div>

            {/* Summary stats */}
            <div style={{display:"grid",gridTemplateColumns:"repeat(2,1fr)",gap:10,flexShrink:0}}>
              <Stat label="Avg Risk"   value={`${avgRiskAll}%`}        color="#D69E2E"/>
              <Stat label="Total HCPs" value={String(totalPatientHCP)} color="#2B6CB0"/>
              <Stat label="Notes/Wk"   value={avgNotes}                color="#38A169"/>
              {peakWeek&&<Stat label="Peak Risk" value={`W${peakWeek.week} · ${(peakWeek.riskScore*100).toFixed(0)}%`} color="#E53E3E"/>}
            </div>

            {/* Week detail */}
            {selWeekDataA
              ? <WeekDetail data={selWeekDataA} color="#2B6CB0" mode={mode}/>
              : <div style={{padding:"12px 14px",background:"#fff",border:"2px solid #E2E8F0",
                  borderRadius:8,color:"#64748B",fontSize:11,fontFamily:FONT,lineHeight:1.6}}>
                  <strong style={{color:"#2B6CB0"}}>Click any spike</strong> on the radial above — both patients will sync to that week simultaneously.
                </div>
            }

            {/* HCP chart */}
            <div style={{flexShrink:0}}>
              <BlockLabel text={`HCP SPECIALTY BREAKDOWN${sharedWeek!=null?` — Week ${sharedWeek}`:""}`}/>
              <div style={{border:"2px solid #0F172A",borderTop:"none",borderRadius:"0 0 8px 8px",overflow:"hidden"}}>
                <HCPBarChart key={focusId+tick+(sharedWeek??"all")} selectedWeek={sharedWeek}/>
              </div>
            </div>

            {/* Ego network */}
            <div style={{flexShrink:0}}>
              <BlockLabel text="EGO CARE NETWORK"
                right={sharedWeek!=null
                  ?<span style={{color:"#60A5FA",fontSize:10,fontFamily:FONT,fontWeight:700}}>WEEK {sharedWeek}</span>
                  :<span style={{color:"#94A3B8",fontSize:10,fontFamily:FONT}}>click a spike to jump to week</span>}/>
              <div style={{border:"2px solid #0F172A",borderTop:"none",borderRadius:"0 0 8px 8px"}}>
                <EgoNetwork key={`${focusId}-${sharedWeek??""}`} patientId={focusId} accentColor="#2B6CB0" initialWeek={sharedWeek??undefined}/>
              </div>
            </div>

          </div>
        </div>

        {/* ── COLUMN B ── */}
        <div style={{flex:1,minWidth:0,display:"flex",flexDirection:"column",overflow:"hidden"}}>
          <ColHeader
            label="B" color="#6B46C1" id={cmpId} pt={cmpPt}
            avgRisk={cmpSum.avgRiskAll} totalHCP={cmpHCPSnap}
            numWeeks={cmpSnap.length}
            sharedWeek={sharedWeek} onClearWeek={()=>onSharedWeek(null)}
            onRemove={onClearCompare}/>
          <div ref={colBRef} onScroll={onScrollB}
            style={{flex:1,overflowY:"auto",padding:"14px",
            display:"flex",flexDirection:"column",gap:14,background:"#F8FAFC"}}>

            {/* Radial — 85vh so spiral fills most of the viewport */}
            <div style={{height:"78vh",flexShrink:0}}>
              <CompareGlyph key={cmpId+cmpTick}
                weeklySnap={cmpSnap} surgeonSnap={cmpSurgSnap} totalHCP={cmpHCPSnap}
                selectedWeek={sharedWeek} onSelectWeek={onSharedWeek} mode={mode}/>
            </div>

            {/* Summary stats */}
            <div style={{display:"grid",gridTemplateColumns:"repeat(2,1fr)",gap:10,flexShrink:0}}>
              <Stat label="Avg Risk"   value={`${cmpSum.avgRiskAll}%`} color="#D69E2E"/>
              <Stat label="Total HCPs" value={String(cmpHCPSnap)}      color="#6B46C1"/>
              <Stat label="Notes/Wk"   value={cmpSum.avgNotes}         color="#38A169"/>
              {cmpSum.peakWeek&&<Stat label="Peak Risk" value={`W${cmpSum.peakWeek.week} · ${(cmpSum.peakWeek.riskScore*100).toFixed(0)}%`} color="#E53E3E"/>}
            </div>

            {/* Week detail */}
            {selWeekDataB
              ? <WeekDetail data={selWeekDataB} color="#6B46C1" mode={mode}/>
              : <div style={{padding:"12px 14px",background:"#fff",border:"2px solid #E2E8F0",
                  borderRadius:8,color:"#64748B",fontSize:11,fontFamily:FONT,lineHeight:1.6}}>
                  Waiting for week selection — click any spike in either column.
                </div>
            }

            {/* HCP chart */}
            <div style={{flexShrink:0}}>
              <BlockLabel text={`HCP SPECIALTY BREAKDOWN${sharedWeek!=null?` — Week ${sharedWeek}`:""}`}/>
              <div style={{border:"2px solid #0F172A",borderTop:"none",borderRadius:"0 0 8px 8px",overflow:"hidden"}}>
                <HCPBarChart key={cmpId+cmpTick+(sharedWeek??"all")} selectedWeek={sharedWeek} data={cmpSnap}/>
              </div>
            </div>

            {/* Ego network */}
            <div style={{flexShrink:0}}>
              <BlockLabel text="EGO CARE NETWORK"
                right={sharedWeek!=null
                  ?<span style={{color:"#C084FC",fontSize:10,fontFamily:FONT,fontWeight:700}}>WEEK {sharedWeek}</span>
                  :<span style={{color:"#94A3B8",fontSize:10,fontFamily:FONT}}>click a spike to jump to week</span>}/>
              <div style={{border:"2px solid #0F172A",borderTop:"none",borderRadius:"0 0 8px 8px"}}>
                <EgoNetwork key={`${cmpId}-${sharedWeek??""}`} patientId={cmpId} accentColor="#6B46C1" initialWeek={sharedWeek??undefined}/>
              </div>
            </div>

          </div>
        </div>

      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// APP
// ─────────────────────────────────────────────────────────────────────────────
export default function App(){
  const [ready,          setReady]          = useState(false);
  const [focusId,        setFocusId]        = useState("");
  const [cmpId,          setCmpId]          = useState("");
  const [tick,           setTick]           = useState(0);
  const [cmpTick,        setCmpTick]        = useState(0);
  const [mode,           setMode]           = useState<ViewMode>("delta");

  // single-view week (click only — no hover)
  const [selWeek,        setSelWeek]        = useState<number|null>(null);

  // compare shared week
  const [sharedWeek,     setSharedWeek]     = useState<number|null>(null);

  // compare snapshots
  const [cmpSnap,        setCmpSnap]        = useState<WeekData[]>([]);
  const [cmpSurgSnap,    setCmpSurgSnap]    = useState<number[]>([]);
  const [cmpHCPSnap,     setCmpHCPSnap]     = useState(0);

  // what-if (old specialty-toggle, kept for backward compat)
  const [removedGroups,  setRemovedGroups]  = useState<Set<string>>(new Set());

  // surrogate what-if state
  const [wiFeature,      setWiFeature]      = useState<string|null>(null);   // selected feature name
  const [wiPerturbPct,   setWiPerturbPct]   = useState(0);                   // 0-100% reduction
  const [wiCenterIdx,    setWiCenterIdx]    = useState(0);                   // center week index
  const [wiOpenGroups,   setWiOpenGroups]   = useState<Record<string,boolean>>({});
  const [wiPatientId,    setWiPatientId]    = useState<"A"|"B">("A");        // which patient to simulate

  // scatter filters
  const [filters,        setFilters]        = useState(new Set(["breast","colon","lung"]));

  // VIEW: "overview" | "compare" | "whatif"
  const [view,           setView]           = useState<"overview"|"compare"|"whatif">("overview");

  useEffect(()=>{
    initRealData("/temporal_networks.json","/full_va_export_with_linear.json","/ego_network.json").then(()=>{
      setReady(true);
      Promise.all([nanSafe("/temporal_networks.json"),nanSafe("/full_va_export_with_linear.json")])
        .then(([t,e])=>{
          _temporal=t as Record<string,unknown>;
          if(Array.isArray(e)){const m:Record<string,unknown>={};for(const r of e as Array<{id:string}>) m[r.id]=r;_egoMap=m;}
          else _egoMap=e as Record<string,unknown>;
        });
    });
  },[]);

  const handleSelect=(id:string)=>{
    if(id===focusId){
      setFocusId("");setSelWeek(null);setTick(t=>t+1);
      return;
    }
    switchPatient(id,_temporal,_egoMap as never);
    setFocusId(id);setSelWeek(null);setSharedWeek(null);setTick(t=>t+1);
  };
  const handleCompare=(id:string)=>{
    if(id===focusId) return;
    switchComparePatient(id,_temporal,_egoMap as never);
    setCmpId(id);setSharedWeek(null);
    setCmpSnap([...compareWeeklyData]);
    setCmpSurgSnap([...compareSurgeonEvents]);
    setCmpHCPSnap(compareTotalHCP);
    setCmpTick(t=>t+1);
    setView("compare");
  };
  const handleClearCompare=()=>{
    clearComparePatient();setCmpId("");setCmpSnap([]);setCmpSurgSnap([]);setCmpHCPSnap(0);
    setSharedWeek(null);setView("overview");
  };

  if(!ready) return(
    <div style={{width:"100%",height:"100vh",background:"#0F172A",display:"flex",
      flexDirection:"column",alignItems:"center",justifyContent:"center",gap:16}}>
      <div style={{color:"white",fontFamily:FONT,fontSize:20,fontWeight:800,letterSpacing:3}}>
        ONCO<span style={{color:"#60A5FA"}}>NET</span>
      </div>
      <div style={{color:"#475569",fontFamily:FONT,fontSize:11,letterSpacing:2}}>LOADING PATIENT DATA…</div>
    </div>
  );

  const {avgRiskAll,peakWeek,avgNotes}=getPatientSummary();
  const peakDelta=weeklyData.length?weeklyData.reduce((b,d)=>Math.abs(d.probDelta)>Math.abs(b.probDelta)?d:b,weeklyData[0]):null;
  const cmpSum=getPatientSummary(cmpSnap);
  const focusPt=getPatientById(focusId);
  const cmpPt=getPatientById(cmpId);
  const hcpGroups=[...new Set(weeklyData.flatMap(w=>(w.hcpNames??[])))].filter(Boolean).slice(0,24);
  const selWeekDataA=sharedWeek!=null?weeklyData.find(w=>w.week===sharedWeek)??null:null;
  const selWeekDataB=sharedWeek!=null?cmpSnap.find(w=>w.week===sharedWeek)??null:null;
  const singleWeekData = selWeek!=null ? (weeklyData.find(w=>w.week===selWeek)??null) : null;

  // Has a patient been selected yet?
  const patientSelected = !!focusId;

  return(
    <div style={{width:"100%",height:"100vh",background:"#F1F5F9",fontFamily:FONT,
      display:"flex",flexDirection:"column",overflow:"hidden"}}>

      {/* ══ TOPBAR ════════════════════════════════════════════════════════════ */}
      <div style={{
        flexShrink:0,background:"#0F172A",height:52,
        display:"flex",alignItems:"center",padding:"0 20px",gap:12,
        boxShadow:"0 2px 12px rgba(0,0,0,.35)",zIndex:100,
      }}>
        {/* Navigation buttons — compare mode */}
        {(view==="compare"||view==="whatif")&&(
          <button onClick={()=>setView("overview")} style={{
            display:"flex",alignItems:"center",gap:8,marginLeft:10,
            padding:"8px 20px",borderRadius:8,cursor:"pointer",
            background:"#FFFFFF",border:"2px solid #FFFFFF",
            color:"#0F172A",fontSize:12,fontFamily:FONT,fontWeight:800,letterSpacing:.8,
            boxShadow:"0 2px 8px rgba(0,0,0,.25)",
            transition:"all .12s",flexShrink:0,
          }}>
            ← OVERVIEW
          </button>
        )}
        {view==="compare"&&(
          <button onClick={()=>setView("whatif")} style={{
            display:"flex",alignItems:"center",gap:8,marginLeft:4,
            padding:"8px 20px",borderRadius:8,cursor:"pointer",
            background:"#D69E2E",border:"2px solid #D69E2E",
            color:"#fff",fontSize:12,fontFamily:FONT,fontWeight:800,letterSpacing:.8,
            boxShadow:"0 2px 8px rgba(214,158,46,.4)",
            transition:"all .12s",flexShrink:0,
          }}>
            ⚡ WHAT-IF →
          </button>
        )}
        {view==="whatif"&&(
          <button onClick={()=>setView("compare")} style={{
            display:"flex",alignItems:"center",gap:8,marginLeft:4,
            padding:"8px 20px",borderRadius:8,cursor:"pointer",
            background:"#6B46C1",border:"2px solid #6B46C1",
            color:"#fff",fontSize:12,fontFamily:FONT,fontWeight:800,letterSpacing:.8,
            boxShadow:"0 2px 8px rgba(107,70,193,.4)",
            transition:"all .12s",flexShrink:0,
          }}>
            ← COMPARE
          </button>
        )}

        {/* Mode toggle */}
        <div style={{display:"flex",gap:0,background:"#FFFFFF10",borderRadius:7,padding:2,marginLeft:6,flexShrink:0}}>
          {(["delta","prob"] as const).map(m=>(
            <button key={m} onClick={()=>setMode(m)} style={{
              padding:"4px 12px",borderRadius:5,cursor:"pointer",
              background:mode===m?"#FFFFFF":"transparent",border:"none",
              color:mode===m?"#0F172A":"#64748B",
              fontSize:10,fontFamily:FONT,fontWeight:800,letterSpacing:.8,transition:"all .1s",
            }}>{m==="delta"?"Δ PROB":"RISK %"}</button>
          ))}
        </div>

        {/* Patient chips — right side */}
        <div style={{marginLeft:"auto",display:"flex",gap:8,alignItems:"center"}}>
          {focusPt&&<PatientBadge pt={focusPt} label="A" color="#2B6CB0"/>}
          {cmpPt&&<PatientBadge pt={cmpPt} label="B" color="#6B46C1" onRemove={handleClearCompare}/>}
        </div>
      </div>

      {/* ══ BODY ════════════════════════════════════════════════════════════ */}

      {view==="overview" ? (
        /* ── OVERVIEW ────────────────────────────────────────────────────── */
        <div style={{
          flex:1,minHeight:0,display:"flex",
          transition:"all .2s",
        }}>
          {/* LEFT: Scatter — full width before patient, 45% after */}
          <div style={{
            flexShrink:0,
            width: patientSelected ? "45%" : "100%",
            transition:"width .25s ease",
            borderRight: patientSelected ? "3px solid #E2E8F0" : "none",
            display:"flex",flexDirection:"column",
            background:"#F8FAFC",overflow:"hidden",
            padding:"10px 12px",
          }}>
            <ScatterPlot
              selectedId={focusId} compareId={cmpId}
              onSelectPatient={handleSelect}
              onComparePatient={handleCompare}
              filters={filters} onFilterChange={setFilters}/>
          </div>

          {/* RIGHT: Single patient detail — only shows when patient selected, 55% */}
          {patientSelected&&(
            <div style={{
              flex:1,minWidth:0,
              display:"flex",flexDirection:"column",
              overflow:"hidden",
            }}>

              {/* Patient header — colored bar */}
              <div style={{
                flexShrink:0,background:"#2B6CB0",padding:"10px 20px",
                display:"flex",alignItems:"center",gap:12,flexWrap:"wrap",
              }}>
                <span style={{background:"rgba(255,255,255,.22)",color:"#fff",fontSize:10,
                  fontWeight:800,fontFamily:FONT,borderRadius:5,padding:"3px 10px",letterSpacing:.8}}>
                  PATIENT A
                </span>
                <span style={{color:"#fff",fontSize:18,fontWeight:800,fontFamily:FONT}}>{focusId}</span>
                {focusPt&&<>
                  <span style={{background:"rgba(255,255,255,.15)",color:"rgba(255,255,255,.9)",fontSize:10,
                    fontWeight:800,fontFamily:FONT,borderRadius:4,padding:"2px 8px",letterSpacing:.5}}>
                    {focusPt.cancer.toUpperCase()}
                  </span>
                  <span style={{fontSize:11,fontWeight:800,fontFamily:FONT,
                    color:focusPt.survived?"#86EFAC":"#FCA5A5"}}>
                    {focusPt.survived?"SURVIVED":"DECEASED"}
                  </span>
                  <span style={{color:"rgba(255,255,255,.8)",fontSize:11,fontFamily:FONT}}>
                    Avg Risk <strong>{avgRiskAll}%</strong>
                    &nbsp;·&nbsp;{totalPatientHCP} HCPs
                    &nbsp;·&nbsp;{weeklyData.length}w
                  </span>
                </>}
                <div style={{marginLeft:"auto",flexShrink:0}}>
                  {cmpId
                    ?<button onClick={()=>setView("compare")} style={{
                        padding:"5px 14px",borderRadius:6,cursor:"pointer",
                        background:"rgba(255,255,255,.2)",border:"2px solid rgba(255,255,255,.5)",
                        color:"#fff",fontSize:10,fontFamily:FONT,fontWeight:800,letterSpacing:.8}}>
                        VIEW COMPARISON →
                      </button>
                    :<span style={{color:"rgba(255,255,255,.45)",fontSize:10,fontFamily:FONT}}>
                        Right-click any dot to compare
                      </span>
                  }
                </div>
              </div>

              {/* Scrollable patient detail */}
              <div style={{flex:1,minHeight:0,overflowY:"auto",
                padding:"16px",display:"flex",flexDirection:"column",gap:14,
                background:"#F8FAFC"}}>

                {/* Radial + week detail side by side */}
                <div style={{display:"flex",gap:14,flexShrink:0,minHeight:560}}>
                  <div style={{flex:"0 0 58%",minHeight:0}}>
                    <RadialGlyph key={focusId+tick}
                      selectedWeek={selWeek}
                      onSelectWeek={w=>setSelWeek(w)}
                      mode={mode} onModeChange={setMode}
                      accentColor="#2B6CB0"/>
                  </div>
                  <div style={{flex:1,minWidth:0,overflowY:"auto"}}>
                    {singleWeekData
                      ? <WeekDetail data={singleWeekData} color="#2B6CB0" mode={mode}/>
                      : (
                        <div style={{background:"#fff",border:"2px solid #E2E8F0",borderRadius:10,padding:"18px 20px",height:"100%",boxSizing:"border-box"}}>
                          <div style={{color:"#0F172A",fontSize:12,fontWeight:800,fontFamily:FONT,
                            letterSpacing:1,marginBottom:14}}>PATIENT SUMMARY</div>
                          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10,marginBottom:16}}>
                            <Stat label="Avg Predicted Risk" value={`${avgRiskAll}%`} color="#D69E2E"/>
                            <Stat label="Total Unique HCPs"  value={String(totalPatientHCP)} color="#2B6CB0"/>
                            <Stat label="Avg Notes / Week"   value={avgNotes} color="#38A169"/>
                            {peakWeek&&<Stat label="Peak Risk Week" value={`W${peakWeek.week} · ${(peakWeek.riskScore*100).toFixed(0)}%`} color="#E53E3E"/>}
                          </div>
                          {weeklyData.length>1&&(()=>{
                            const path=weeklyData.map((d,i)=>`${i===0?"M":"L"}${4+(i/(weeklyData.length-1))*392},${60-(d.riskScore*56)}`).join(" ");
                            return(
                              <div style={{marginBottom:14}}>
                                <div style={{color:"#0F172A",fontSize:10,fontWeight:800,letterSpacing:1,marginBottom:4,fontFamily:FONT}}>RISK TRAJECTORY</div>
                                <svg viewBox="0 0 400 64" style={{width:"100%",height:64}}>
                                  {weeklyData.map((d,i)=><circle key={i} cx={4+(i/(weeklyData.length-1||1))*392} cy={60-(d.riskScore*56)} r={2.5} fill={spkColor(d.probDelta)} opacity={.75}/>)}
                                  <path d={path} fill="none" stroke="#2B6CB0" strokeWidth={1.5} opacity={.5}/>
                                </svg>
                              </div>
                            );
                          })()}
                          <div style={{padding:"10px 14px",background:"#F8FAFC",borderRadius:8,
                            color:"#64748B",fontSize:11,fontFamily:FONT,lineHeight:1.7}}>
                            <strong style={{color:"#2B6CB0"}}>Click any spike</strong> on the radial chart to inspect that week's specialties and risk attributes.
                          </div>
                        </div>
                      )
                    }
                  </div>
                </div>

                {/* HCP bar chart */}
                <div style={{flexShrink:0}}>
                  <BlockLabel
                    text={`HCP SPECIALTY BREAKDOWN${selWeek!=null?` — Week ${selWeek}`:""}`}/>
                  <div style={{border:"2px solid #0F172A",borderTop:"none",borderRadius:"0 0 8px 8px",overflow:"hidden"}}>
                    <HCPBarChart key={focusId+tick+(selWeek??"all")} selectedWeek={selWeek}/>
                  </div>
                </div>

                {/* Ego network */}
                <div style={{flexShrink:0}}>
                  <BlockLabel
                    text="EGO CARE NETWORK"
                    right={<span style={{color:"#94A3B8",fontSize:10,fontFamily:FONT}}>HCP co-access graph</span>}/>
                  <div style={{border:"2px solid #0F172A",borderTop:"none",
                    borderRadius:"0 0 8px 8px"}}>
                    <EgoNetwork key={focusId} patientId={focusId} accentColor="#2B6CB0"
                      initialWeek={selWeek}/>
                  </div>
                </div>

              </div>
            </div>
          )}
        </div>

      ) : view==="compare" ? (

        /* ── COMPARE VIEW ─────────────────────────────────────────────────── */
        <CompareView
          focusId={focusId} cmpId={cmpId} focusPt={focusPt} cmpPt={cmpPt}
          avgRiskAll={avgRiskAll} totalPatientHCP={totalPatientHCP} avgNotes={avgNotes} peakWeek={peakWeek}
          cmpSum={cmpSum} cmpHCPSnap={cmpHCPSnap} cmpSnap={cmpSnap} cmpSurgSnap={cmpSurgSnap}
          tick={tick} cmpTick={cmpTick} mode={mode} onModeChange={setMode}
          sharedWeek={sharedWeek} onSharedWeek={setSharedWeek}
          selWeekDataA={selWeekDataA} selWeekDataB={selWeekDataB}
          onClearCompare={handleClearCompare}
        />

      ) : view==="whatif" ? (

        /* ── SURROGATE WHAT-IF VIEW ───────────────────────────────────────── */
        (()=>{
          // ── Which patient are we simulating? ────────────────────────────
          const effectivePatientId = (wiPatientId==="B" && cmpId) ? cmpId : focusId;
          const effectivePt        = (wiPatientId==="B" && cmpPt) ? cmpPt : focusPt;
          const wiData             = (wiPatientId==="B" && cmpSnap.length) ? cmpSnap : weeklyData;
          const wiAccent           = wiPatientId==="B" ? "#6B46C1" : "#2B6CB0";

          // Compute surrogate ranking from the active patient's weekly data
          const surrogateRanking: SurrogateFeature[] = getPatientSurrogateRanking(wiData, 60);

          // Canonical colors — match LEVEL1_GROUPS in EgoNetwork exactly
          const SPEC_COLORS: Record<string,string> = {
            ...SPECIALTY_COLORS,
            "Provider Type":"#64748b","Clinician Title":"#64748b",
            "Resident":"#64748b","Inpatient":"#64748b",
          };

          // featGroupLabel: uses same classifyHCP logic (canonical terms) for specialty features;
          // handles non-specialty prefixes separately
          function featGroupLabel(feat: string): string {
            const prefix = feat.split("::")[0];
            if (prefix==="ACCESS_USER_IS_RESIDENT") return "Resident";
            if (prefix==="ACCESS_USER_CLINICIAN_TITLE") return "Clinician Title";
            if (prefix==="INPATIENT_DEPT_YN") return "Inpatient";
            if (prefix==="ACCESS_USER_PROV_TYPE") return "Provider Type";
            // For specialty features, extract the raw specialty value and classify it
            const rawSpec = (feat.split("::")[1] ?? "").replace(/_/g, " ");
            const classified = classifyHCP(rawSpec, "", "");
            return classified === "Unknown" ? "Other" : classified;
          }

          const groupMap: Record<string,{color:string;features:SurrogateFeature[];totalImportance:number}> = {};
          for(const f of surrogateRanking){
            const grp = featGroupLabel(f.feature);
            if(!groupMap[grp]) groupMap[grp]={color:SPEC_COLORS[grp]??"#94a3b8",features:[],totalImportance:0};
            groupMap[grp].features.push(f);
            groupMap[grp].totalImportance += f.importance;
          }
          const groups = Object.entries(groupMap).sort((a,b)=>b[1].totalImportance-a[1].totalImportance);

          // ── Risk timelines ───────────────────────────────────────────────
          const origRisks = wiData.map(w=>w.riskScore);
          const pertRisks = wiFeature
            ? computePerturbedRisk(wiData, wiCenterIdx, wiPerturbPct, wiFeature)
            : origRisks;

          const origEnd = origRisks[origRisks.length-1] ?? 0;
          const pertEnd = pertRisks[pertRisks.length-1] ?? 0;
          const delta   = pertEnd - origEnd;
          const isGood  = delta < 0;
          const selFeat = wiFeature ? surrogateRanking.find(f=>f.feature===wiFeature) : null;
          const selGrp  = selFeat ? featGroupLabel(selFeat.feature) : null;
          const selCol  = selGrp ? (SPEC_COLORS[selGrp]??"#0284c7") : "#0284c7";

          // ── SVG chart geometry ───────────────────────────────────────────
          // Auto-scale Y to actual data range so trajectory variation is visible
          const CW=640, CH=180, PL=52, PR=20, PT=16, PB=28;
          const pw=CW-PL-PR, ph=CH-PT-PB;
          const n=wiData.length;
          // Auto-scale Y to show both trajectories clearly.
          // Use a minimum visible span so a perfectly flat original still renders readably.
          const allVals  = [...origRisks, ...pertRisks];
const dataMin  = Math.min(...allVals);
const dataMax  = Math.max(...allVals);
const dataSpan = dataMax - dataMin;

const minSpan = 0.08;
const pad = Math.max(dataSpan * 0.15, (minSpan - dataSpan) / 2, 0.02);

// keep some fixed breathing room so lines do not sit on the frame
const floorPad = 0.03;   // 3%
const ceilPad  = 0.03;   // 3%

let yMin = dataMin - pad;
let yMax = dataMax + pad;

// if line hits 0 or 1, still keep it visually inside chart
yMin = Math.min(yMin, dataMin - floorPad);
yMax = Math.max(yMax, dataMax + ceilPad);

// final clamp, but not exactly to the data
yMin = Math.max(-0.02, yMin);
yMax = Math.min(1.02, yMax);

const yRange = Math.max(yMax - yMin, minSpan);
          const toX=(i:number)=>PL+(i/(Math.max(n-1,1)))*pw;
          const toY=(v:number)=>PT+ph-((Math.max(yMin,Math.min(yMax,v))-yMin)/yRange)*ph;

         const origPts = origRisks
          .map((v, i) => `${toX(i).toFixed(1)},${toY(v).toFixed(1)}`)
          .join(" ");

        const beforeCenterPts = origRisks
          .slice(0, wiCenterIdx + 1)
          .map((v, i) => `${toX(i).toFixed(1)},${toY(v).toFixed(1)}`)
          .join(" ");

        const afterCenterPts = pertRisks
          .slice(wiCenterIdx)
          .map((v, j) => `${toX(wiCenterIdx + j).toFixed(1)},${toY(v).toFixed(1)}`)
          .join(" ");
          // Shaded fill between original and perturbed AFTER center
          const origAfterPts = origRisks.slice(wiCenterIdx)
            .map((v,j)=>`${toX(wiCenterIdx+j).toFixed(1)},${toY(v).toFixed(1)}`).join(" L");
          const shadeArea = wiFeature && wiPerturbPct>0 && wiCenterIdx<n-1
            ? `M${afterCenterPts} L${toX(n-1).toFixed(1)},${toY(origRisks[n-1]).toFixed(1)} ${
                origRisks.slice(wiCenterIdx).reverse().map((v,j)=>
                  `L${toX(n-1-j).toFixed(1)},${toY(v).toFixed(1)}`
                ).join(" ")} Z`
            : "";

          const cx  = toX(wiCenterIdx).toFixed(1);
          const cyo = toY(origRisks[wiCenterIdx]??0).toFixed(1);

          return(
          <div style={{flex:1,minHeight:0,overflowY:"auto",background:"#F8FAFC"}}>
            <div style={{maxWidth:1380,margin:"0 auto",padding:"20px 24px",display:"flex",flexDirection:"column",gap:14}}>

              {/* ── HEADER BAR ── */}
              <div style={{display:"flex",alignItems:"center",gap:14,flexWrap:"wrap",
                background:"#0F172A",borderRadius:12,padding:"14px 20px"}}>
                <div style={{background:"#D69E2E",borderRadius:8,width:36,height:36,
                  display:"flex",alignItems:"center",justifyContent:"center",fontSize:18,flexShrink:0}}>⚡</div>
                <div>
                  <div style={{color:"#fff",fontSize:16,fontWeight:800,fontFamily:FONT,letterSpacing:.5}}>
                    SURROGATE WHAT-IF SIMULATION
                  </div>
                  <div style={{color:"#94A3B8",fontSize:11,fontFamily:FONT,marginTop:1}}>
                    Simulating impact of reducing care contact · surrogate model approximation
                  </div>
                </div>

                {/* ── PATIENT SWITCHER ── */}
                <div style={{marginLeft:"auto",display:"flex",gap:8,alignItems:"center",flexShrink:0}}>
                  <span style={{color:"#64748B",fontSize:10,fontFamily:FONT,fontWeight:700,letterSpacing:1}}>
                    SIMULATING:
                  </span>
                  {/* Patient A chip */}
                  {focusPt&&(
                    <button onClick={()=>{
                        if(wiPatientId!=="A"){
                          setWiPatientId("A");
                          setWiFeature(null);setWiPerturbPct(0);setWiCenterIdx(0);
                          setWiOpenGroups({});
                        }
                      }}
                      style={{
                        display:"flex",alignItems:"center",gap:8,
                        padding:"7px 14px",borderRadius:8,cursor:"pointer",
                        background: wiPatientId==="A" ? "#2B6CB0" : "#1E293B",
                        border: `2px solid ${wiPatientId==="A" ? "#60A5FA" : "#334155"}`,
                        transition:"all .15s",
                      }}>
                      <span style={{background: wiPatientId==="A" ? "rgba(255,255,255,.3)" : "#334155",
                        color:"#fff",fontSize:9,fontWeight:800,fontFamily:FONT,
                        borderRadius:4,padding:"2px 7px",letterSpacing:.8}}>A</span>
                      <span style={{color:"#fff",fontSize:12,fontWeight:800,fontFamily:FONT}}>{focusId}</span>
                      <span style={{color: wiPatientId==="A" ? "rgba(255,255,255,.8)" : "#64748B",
                        fontSize:10,fontFamily:FONT}}>
                        {focusPt.cancer} · {focusPt.survived?"survived":"deceased"} · {focusPt.avgRisk}%
                      </span>
                      {wiPatientId==="A"&&<span style={{color:"#60A5FA",fontSize:10,fontWeight:800,fontFamily:FONT}}>✓</span>}
                    </button>
                  )}
                  {/* Patient B chip — only shown if compare patient exists */}
                  {cmpPt&&cmpId&&(
                    <button onClick={()=>{
                        if(wiPatientId!=="B"){
                          setWiPatientId("B");
                          setWiFeature(null);setWiPerturbPct(0);setWiCenterIdx(0);
                          setWiOpenGroups({});
                        }
                      }}
                      style={{
                        display:"flex",alignItems:"center",gap:8,
                        padding:"7px 14px",borderRadius:8,cursor:"pointer",
                        background: wiPatientId==="B" ? "#6B46C1" : "#1E293B",
                        border: `2px solid ${wiPatientId==="B" ? "#C084FC" : "#334155"}`,
                        transition:"all .15s",
                      }}>
                      <span style={{background: wiPatientId==="B" ? "rgba(255,255,255,.3)" : "#334155",
                        color:"#fff",fontSize:9,fontWeight:800,fontFamily:FONT,
                        borderRadius:4,padding:"2px 7px",letterSpacing:.8}}>B</span>
                      <span style={{color:"#fff",fontSize:12,fontWeight:800,fontFamily:FONT}}>{cmpId}</span>
                      <span style={{color: wiPatientId==="B" ? "rgba(255,255,255,.8)" : "#64748B",
                        fontSize:10,fontFamily:FONT}}>
                        {cmpPt.cancer} · {cmpPt.survived?"survived":"deceased"} · {cmpPt.avgRisk}%
                      </span>
                      {wiPatientId==="B"&&<span style={{color:"#C084FC",fontSize:10,fontWeight:800,fontFamily:FONT}}>✓</span>}
                    </button>
                  )}
                  {!cmpPt&&(
                    <div style={{padding:"7px 14px",borderRadius:8,border:"2px dashed #334155",
                      color:"#475569",fontSize:10,fontFamily:FONT}}>
                      Right-click a dot in Overview to add Patient B
                    </div>
                  )}
                </div>
              </div>

              {/* ── TWO COLUMNS ── */}
              <div style={{display:"flex",gap:16,alignItems:"flex-start"}}>

                {/* LEFT: Feature browser */}
                <div style={{width:320,flexShrink:0,display:"flex",flexDirection:"column",gap:6}}>
                  <div style={{color:"#0F172A",fontSize:11,fontWeight:800,letterSpacing:1,fontFamily:FONT}}>
                    SURROGATE FEATURE IMPORTANCE
                  </div>
                  <div style={{color:"#64748B",fontSize:10,fontFamily:FONT,marginBottom:2}}>
                    Ranked by avg |weight| · click a row to simulate
                  </div>
                  {groups.map(([grpName,grp])=>{
                    const open = wiOpenGroups[grpName] ?? (grpName===groups[0]?.[0]);
                    const toggleOpen = ()=>setWiOpenGroups(prev=>({...prev,[grpName]:!open}));
                    const maxFeat=grp.features[0]?.importance??1;
                    return(
                      <div key={grpName} style={{background:"#fff",border:"2px solid #E2E8F0",borderRadius:8,overflow:"hidden"}}>
                        <div onClick={toggleOpen} style={{
                          display:"flex",alignItems:"center",gap:8,padding:"8px 12px",cursor:"pointer",
                          background:open?`${grp.color}08`:"#fff",
                          borderBottom:open?"2px solid #E2E8F0":"none",
                        }}>
                          <div style={{width:10,height:10,borderRadius:"50%",background:grp.color,flexShrink:0}}/>
                          <span style={{color:grp.color,fontSize:12,fontWeight:800,fontFamily:FONT,flex:1}}>{grpName}</span>
                          <div style={{width:60,height:5,background:"#F1F5F9",borderRadius:3,overflow:"hidden"}}>
                            <div style={{height:"100%",borderRadius:3,background:grp.color,
                              width:`${((grp.totalImportance/groups[0][1].totalImportance)*100).toFixed(1)}%`}}/>
                          </div>
                          <span style={{color:grp.color,fontSize:11,fontWeight:700,fontFamily:FONT,minWidth:42,textAlign:"right"}}>
                            {grp.totalImportance.toFixed(3)}
                          </span>
                          <span style={{color:"#94A3B8",fontSize:11}}>{open?"▴":"▾"}</span>
                        </div>
                        {open&&grp.features.map(feat=>{
                          const isSel=wiFeature===feat.feature;
                          const barPct=((feat.importance/maxFeat)*100).toFixed(1);
                          return(
                            <div key={feat.feature}
                              onClick={()=>{setWiFeature(isSel?null:feat.feature);setWiPerturbPct(0);}}
                              style={{display:"flex",alignItems:"center",gap:8,padding:"7px 12px",
                                cursor:"pointer",borderBottom:"1px solid #F1F5F9",
                                background:isSel?`${grp.color}14`:"transparent",transition:"background .1s"}}>
                              <div style={{flex:1,minWidth:0}}>
                                <div style={{color:isSel?grp.color:"#334155",fontSize:11,fontFamily:FONT,
                                  fontWeight:isSel?800:500,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>
                                  {feat.displayLabel}
                                </div>
                                <div style={{color:"#94A3B8",fontSize:9,fontFamily:FONT}}>
                                  ×{feat.weekCount}w · val̄={feat.avgValue.toFixed(1)}
                                </div>
                              </div>
                              <div style={{width:52,height:5,background:"#F1F5F9",borderRadius:3,overflow:"hidden",flexShrink:0}}>
                                <div style={{height:"100%",borderRadius:3,background:grp.color,width:`${barPct}%`}}/>
                              </div>
                              <span style={{color:grp.color,fontSize:11,fontWeight:700,fontFamily:FONT,
                                minWidth:42,textAlign:"right"}}>{feat.importance.toFixed(3)}</span>
                              {isSel&&<span style={{color:grp.color,fontSize:11,fontWeight:800}}>✓</span>}
                            </div>
                          );
                        })}
                      </div>
                    );
                  })}
                  {surrogateRanking.length===0&&(
                    <div style={{padding:"24px",color:"#94A3B8",fontSize:12,fontFamily:FONT,textAlign:"center",
                      background:"#fff",border:"2px solid #E2E8F0",borderRadius:8}}>
                      No surrogate data for this patient
                    </div>
                  )}
                </div>

                {/* RIGHT: Cards + chart + slider */}
                <div style={{flex:1,minWidth:0,display:"flex",flexDirection:"column",gap:12}}>

                  {/* Risk summary cards */}
                  <div style={{display:"grid",gridTemplateColumns:"repeat(3,1fr)",gap:10}}>
                    <div style={{background:"#fff",border:"3px solid #D69E2E",borderRadius:10,padding:"12px 16px"}}>
                      <div style={{color:"#D69E2E",fontSize:9,fontWeight:800,letterSpacing:1.5,marginBottom:4,fontFamily:FONT}}>BASE RISK (end)</div>
                      <div style={{color:"#D69E2E",fontSize:34,fontWeight:800,fontFamily:FONT,lineHeight:1}}>
                        {(origEnd*100).toFixed(1)}%
                      </div>
                      <div style={{color:"#94A3B8",fontSize:9,fontFamily:FONT,marginTop:4}}>
                        {effectivePatientId} · original trajectory
                      </div>
                    </div>
                    <div style={{background:"#fff",border:`3px solid ${wiFeature?(isGood?"#38A169":"#E53E3E"):"#E2E8F0"}`,borderRadius:10,padding:"12px 16px"}}>
                      <div style={{color:wiFeature?(isGood?"#38A169":"#E53E3E"):"#94A3B8",fontSize:9,fontWeight:800,letterSpacing:1.5,marginBottom:4,fontFamily:FONT}}>
                        PROJECTED RISK (end)
                      </div>
                      <div style={{color:wiFeature?(isGood?"#38A169":"#E53E3E"):"#94A3B8",fontSize:34,fontWeight:800,fontFamily:FONT,lineHeight:1}}>
                        {wiFeature?(pertEnd*100).toFixed(1)+"%" : "—"}
                      </div>
                      <div style={{color:"#94A3B8",fontSize:9,fontFamily:FONT,marginTop:4}}>
                        {wiFeature?`after ↓${wiPerturbPct}% ${selFeat?.displayLabel??""}`:"select a feature"}
                      </div>
                    </div>
                    <div style={{background:"#fff",border:`3px solid ${wiFeature?(isGood?"#38A169":"#E53E3E"):"#E2E8F0"}`,borderRadius:10,padding:"12px 16px"}}>
                      <div style={{color:wiFeature?(isGood?"#38A169":"#E53E3E"):"#94A3B8",fontSize:9,fontWeight:800,letterSpacing:1.5,marginBottom:4,fontFamily:FONT}}>Δ RISK</div>
                      <div style={{color:wiFeature?(isGood?"#38A169":"#E53E3E"):"#94A3B8",fontSize:34,fontWeight:800,fontFamily:FONT,lineHeight:1}}>
                        {wiFeature?(delta>=0?"+":"")+(delta*100).toFixed(2)+"%" : "—"}
                      </div>
                      <div style={{color:"#94A3B8",fontSize:9,fontFamily:FONT,marginTop:4}}>
                        {wiFeature?(isGood?"risk reduction ↓":"risk increase ↑"):"awaiting feature selection"}
                      </div>
                    </div>
                  </div>

                  {/* Chart placeholder when no feature selected */}
                  {!wiFeature&&(
                    <div style={{background:"#fff",border:"2px solid #E2E8F0",borderRadius:10,
                      padding:"20px",display:"flex",alignItems:"center",justifyContent:"center",minHeight:200}}>
                      <div style={{textAlign:"center",color:"#94A3B8",fontFamily:FONT}}>
                        <div style={{fontSize:36,marginBottom:8}}>←</div>
                        <div style={{fontSize:13,fontWeight:700}}>Select a feature to simulate</div>
                        <div style={{fontSize:11,marginTop:4}}>Click any row in the feature browser on the left</div>
                      </div>
                    </div>
                  )}

                  {/* ── RISK TRAJECTORY CHART ── */}
                  {wiFeature&&(
                    <div style={{background:"#fff",border:"2px solid #E2E8F0",borderRadius:10,padding:"16px 20px"}}>

                      {/* Chart header + legend */}
                      <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:12,flexWrap:"wrap"}}>
                        <span style={{color:"#0F172A",fontSize:12,fontWeight:800,letterSpacing:.8,fontFamily:FONT}}>
                          RISK TRAJECTORY
                        </span>
                        {/* Legend */}
                        <div style={{display:"flex",alignItems:"center",gap:14,marginLeft:8}}>
                          <div style={{display:"flex",alignItems:"center",gap:5}}>
                            <svg width={28} height={8}>
                              <line x1={0} y1={4} x2={28} y2={4} stroke="#94A3B8" strokeWidth={2} strokeDasharray="5,3"/>
                            </svg>
                            <span style={{color:"#64748B",fontSize:10,fontFamily:FONT}}>Original predicted risk</span>
                          </div>
                          <div style={{display:"flex",alignItems:"center",gap:5}}>
                            <svg width={28} height={8}>
                              <line x1={0} y1={4} x2={28} y2={4} stroke={isGood?"#38A169":"#E53E3E"} strokeWidth={2.5}/>
                            </svg>
                            <span style={{color:"#64748B",fontSize:10,fontFamily:FONT}}>
                              Projected ({isGood?"reduced":"increased"}) risk
                            </span>
                          </div>
                          <div style={{display:"flex",alignItems:"center",gap:5}}>
                            <div style={{width:12,height:12,background:"#D69E2E",borderRadius:2}}/>
                            <span style={{color:"#64748B",fontSize:10,fontFamily:FONT}}>Center point</span>
                          </div>
                        </div>
                        <span style={{marginLeft:"auto",color:isGood?"#38A169":"#E53E3E",
                          fontSize:12,fontWeight:800,fontFamily:FONT}}>
                          {isGood?"↓":"↑"} end risk {isGood?"reduced by":"increased by"}{" "}
                          <strong>{Math.abs(delta*100).toFixed(2)}%</strong>
                        </span>
                      </div>

                      {/* SVG chart */}
                      <svg viewBox={`0 0 ${CW} ${CH}`} style={{width:"100%",display:"block",borderRadius:6,
                        border:"1px solid #F1F5F9",background:"#FAFBFC"}}>

                        {/* Y grid lines + labels — auto-scaled to data range */}
                        {[0,.25,.5,.75,1].map(t=>{
                          const v = yMin + t * yRange;
                          const y = toY(v).toFixed(1);
                          const isMid = t === 0.5;
                          return(<g key={t}>
                            <line x1={PL} y1={y} x2={CW-PR} y2={y}
                              stroke={isMid?"#E2E8F0":"#F1F5F9"} strokeWidth={isMid?1.2:.7}
                              strokeDasharray={isMid?"4,3":""}/>
                            <text x={PL-5} y={parseFloat(y)+3.5} textAnchor="end"
                              fontSize={8} fill="#94A3B8" fontFamily={FONT}>
                              {(v*100).toFixed(1)}%
                            </text>
                          </g>);
                        })}

                        {/* X axis baseline */}
                        <line x1={PL} y1={PT+ph} x2={CW-PR} y2={PT+ph} stroke="#E2E8F0" strokeWidth={1}/>

                       

                        {/* ── ORIGINAL LINE — gray dashed, full span ── */}
                        <polyline
                            points={origPts}
                            fill="none"
                            stroke="#7C8AA0"
                            strokeWidth={2.5}
                            strokeDasharray="7,4"
                            opacity={1}
                            strokeLinecap="round"
                            strokeLinejoin="round"
                          />

                        {/* ── PROJECTED LINE — two segments ──
                            Before center: same as original (solid accent, slightly transparent)
                            After center:  diverged perturbed values (solid, full opacity) */}
                        {n > 1 && wiCenterIdx > 0 && (
  <polyline
    points={beforeCenterPts}
    fill="none"
    stroke={isGood ? "#38A169" : "#E53E3E"}
    strokeWidth={2}
    opacity={0.22}
    strokeLinecap="round"
    strokeLinejoin="round"
  />
)}
<polyline
  points={afterCenterPts}
  fill="none"
  stroke={isGood ? "#38A169" : "#E53E3E"}
  strokeWidth={3}
  opacity={1}
  strokeLinecap="round"
  strokeLinejoin="round"
/>
                        {/* Endpoint dot on original */}
                        <circle cx={toX(n-1).toFixed(1)} cy={toY(origRisks[n-1]??0).toFixed(1)}
                          r={4} fill="#94A3B8" opacity={.8}/>

                        {/* Endpoint dot on perturbed */}
                        <circle cx={toX(n-1).toFixed(1)} cy={toY(pertRisks[n-1]??0).toFixed(1)}
                          r={5} fill={isGood?"#38A169":"#E53E3E"} stroke="white" strokeWidth={1.5}/>

                        {/* Delta annotation at end */}
                        {Math.abs(delta) > 0.001 && (() => {
  const xEnd = toX(n - 1);
  const yOrig = toY(origRisks[n - 1] ?? 0);
  const yPert = toY(pertRisks[n - 1] ?? 0);
  const midY = (yOrig + yPert) / 2;
  const lineColor = isGood ? "#38A169" : "#E53E3E";

  return (
    <g>
      {/* thin connector showing exact difference at end */}
      <line
        x1={xEnd}
        y1={yOrig}
        x2={xEnd}
        y2={yPert}
        stroke={lineColor}
        strokeWidth={2}
        opacity={0.85}
      />

      {/* little caps so it reads more like a measured gap */}
      <line
        x1={xEnd - 6}
        y1={yOrig}
        x2={xEnd + 6}
        y2={yOrig}
        stroke={lineColor}
        strokeWidth={1.5}
        opacity={0.85}
      />
      <line
        x1={xEnd - 6}
        y1={yPert}
        x2={xEnd + 6}
        y2={yPert}
        stroke={lineColor}
        strokeWidth={1.5}
        opacity={0.85}
      />

      <text
        x={xEnd + 10}
        y={midY + 3}
        fontSize={9}
        fill={lineColor}
        fontFamily={FONT}
        fontWeight={800}
      >
        {isGood ? "↓" : "↑"}{(Math.abs(delta) * 100).toFixed(1)}%
      </text>
    </g>
  );
})()}

                        {/* ── CENTER MARKER ── */}
                        <line x1={cx} y1={PT} x2={cx} y2={PT+ph}
                          stroke="#D69E2E" strokeWidth={2} strokeDasharray="4,3" opacity={.9}/>
                        <circle cx={cx} cy={cyo} r={6} fill="#D69E2E" stroke="white" strokeWidth={2}/>
                        <text x={parseFloat(cx)+(wiCenterIdx>n*0.7?-8:8)}
                          y={PT+16} fontSize={9} fill="#D69E2E"
                          fontFamily={FONT} fontWeight={800}
                          textAnchor={wiCenterIdx>n*0.7?"end":"start"}>
                          center w{wiData[wiCenterIdx]?.week??wiCenterIdx}
                        </text>
                        {wiFeature && wiPerturbPct > 0 && wiCenterIdx < n - 1 && (() => {
  const x = toX(wiCenterIdx);
  const y = toY(origRisks[wiCenterIdx] ?? 0);
  const lineColor = isGood ? "#38A169" : "#E53E3E";

  return (
    <g>
      <circle cx={x} cy={y} r={8} fill="white" stroke={lineColor} strokeWidth={2} />
      <circle cx={x} cy={y} r={3.5} fill={lineColor} />
    </g>
  );
})()}

                        {/* 50% risk threshold label */}
                        <text x={PL-5} y={toY(0.5)+3.5} textAnchor="end" fontSize={7}
                          fill="#CBD5E1" fontFamily={FONT}>50%</text>

                        {/* Clickable week hit areas */}
                        {wiData.map((_,i)=>(
                          <rect key={i} x={toX(i)-7} y={PT} width={14} height={ph}
                            fill="transparent" style={{cursor:"pointer"}}
                            onClick={()=>setWiCenterIdx(i)}/>
                        ))}

                        {/* X week labels */}
                        {[0,Math.floor(n/4),Math.floor(n/2),Math.floor(3*n/4),n-1]
                          .filter((v,i,a)=>a.indexOf(v)===i&&v<n).map(i=>(
                          <text key={i} x={toX(i).toFixed(1)} y={PT+ph+18} textAnchor="middle"
                            fontSize={8} fill="#94A3B8" fontFamily={FONT}>
                            w{wiData[i]?.week??i}
                          </text>
                        ))}
                      </svg>

                      <div style={{fontSize:10,color:"#94A3B8",fontFamily:FONT,marginTop:6,textAlign:"center"}}>
                        Click anywhere on chart to move the center point · perturbation applies from center onward
                      </div>

                      {/* ── SLIDER ── */}
                      <div style={{marginTop:12,background:"#F8FAFC",border:"2px solid #E2E8F0",
                        borderRadius:8,padding:"12px 16px"}}>
                        <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:8}}>
                          <span style={{color:"#0F172A",fontSize:11,fontWeight:800,fontFamily:FONT}}>
                            REDUCE{" "}
                            <span style={{color:selCol}}>{selFeat?.displayLabel??""}</span>
                            {" "}CONTACT BY:
                          </span>
                          <span style={{color:selCol,fontSize:22,fontWeight:800,fontFamily:FONT}}>↓{wiPerturbPct}%</span>
                        </div>
                        <input type="range" min={0} max={100} step={5} value={wiPerturbPct}
                          onChange={e=>setWiPerturbPct(parseInt(e.target.value))}
                          style={{width:"100%",accentColor:selCol,cursor:"pointer",height:6}}/>
                        <div style={{display:"flex",justifyContent:"space-between",marginTop:4}}>
                          <span style={{color:"#94A3B8",fontSize:10,fontFamily:FONT}}>0% — no change</span>
                          <span style={{color:"#94A3B8",fontSize:10,fontFamily:FONT}}>100% — remove entirely</span>
                        </div>
                      </div>

                      {/* ── INTERPRETATION ── */}
                      {selFeat&&(
                        <div style={{marginTop:10,padding:"10px 14px",
                          background:isGood?"#F0FFF4":"#FFF5F5",
                          border:`2px solid ${isGood?"#38A16933":"#E53E3E33"}`,borderRadius:8,
                          color:"#475569",fontSize:11,fontFamily:FONT,lineHeight:1.7}}>
                          Reducing <strong style={{color:selCol}}>{selFeat.displayLabel}</strong> by{" "}
                          <strong>{wiPerturbPct}%</strong> from week{" "}
                          <strong style={{color:"#D69E2E"}}>W{wiData[wiCenterIdx]?.week??wiCenterIdx}</strong> onward{" "}
                          {Math.abs(delta)>0.0005
                            ?<><span style={{color:isGood?"#38A169":"#E53E3E",fontWeight:800}}>
                              {isGood?"reduces":"increases"} end risk by{" "}
                              {Math.abs(delta*100).toFixed(2)}%
                            </span>{" "}(surrogate approximation)</>
                            :<span style={{color:"#94A3B8"}}>has minimal effect (Δ={delta.toFixed(5)})</span>
                          }
                        </div>
                      )}
                    </div>
                  )}

                  {/* Math note */}
                  <div style={{background:"#fff",border:"2px solid #E2E8F0",borderRadius:10,padding:"12px 16px"}}>
                    <div style={{color:"#0F172A",fontSize:10,fontWeight:800,letterSpacing:1,marginBottom:6,fontFamily:FONT}}>
                      HOW THE MATH WORKS
                    </div>
                    <div style={{color:"#64748B",fontSize:10,fontFamily:FONT,lineHeight:1.8}}>
                      Surrogate model coefficient (weight) used as linear proxy for GCN sensitivity.
                      For each week from center onward:{" "}
                      <code style={{background:"#F1F5F9",padding:"1px 6px",borderRadius:3,fontSize:10,color:"#0F172A"}}>
                        ΔLogit = −w × (reduction%) × |value|
                      </code>{" · "}
                      <code style={{background:"#F1F5F9",padding:"1px 6px",borderRadius:3,fontSize:10,color:"#0F172A"}}>
                        NewRisk = σ(logit(orig) + ΔLogit)
                      </code>
                    </div>
                  </div>

                </div>
              </div>
            </div>
          </div>
          );
        })()

      ) : null}
    </div>
  );
}