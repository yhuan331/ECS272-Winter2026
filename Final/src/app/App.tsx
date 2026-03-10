import { useState, useEffect, useState as useS, useRef as useR } from "react";
import { RadialGlyph } from "./components/RadialGlyph";
import type { ViewMode } from "./components/RadialGlyph";
import { HCPBarChart } from "./components/HCPBarChart";
import { EgoNetwork } from "./components/EgoNetwork";
import {
  initRealData, switchPatient, switchComparePatient, clearComparePatient,
  selectedPatientId, totalPatientHCP, compareWeeklyData, compareSurgeonEvents, compareTotalHCP,
  getPatientSummary, weeklyData, getPatientById, globalMaxWeeks, patients,
  getPatientSurrogateRanking, computePerturbedRisk,
} from "./realData";
import type { PatientDot, WeekData, SurrogateFeature } from "./realData";
import { T, CANCER_COLORS } from "./theme";

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

// ─────────────────────────────────────────────────────────────────────────────
// SCATTER — used in both overview (full) and compare (compact strip)
// ─────────────────────────────────────────────────────────────────────────────
function Scatter({selectedId,compareId,onSelect,onCompare,compact=false,filters,onFilterChange}:{
  selectedId:string;compareId?:string;
  onSelect:(id:string)=>void;onCompare?:(id:string)=>void;
  compact?:boolean;filters:Set<string>;onFilterChange:(f:Set<string>)=>void;
}){
  const [hov,setHov]=useState<string|null>(null);
  const W=compact?1200:520,H=compact?120:430;
  const pl=compact?36:48,pr=compact?12:16,pt=compact?14:30,pb=compact?16:42;
  const pw=W-pl-pr,ph=H-pt-pb;
  const maxTeam=Math.max(...patients.map(p=>p.maxTeam),1);
  const vis=patients.filter(p=>filters.has(p.cancer));
  const sorted=[
    ...vis.filter(p=>p.id!==selectedId&&p.id!==compareId),
    ...vis.filter(p=>p.id===compareId),
    ...vis.filter(p=>p.id===selectedId),
  ];
  const toSVG=(p:PatientDot)=>({cx:pl+p.x*pw,cy:pt+(1-p.y)*ph});

  return(
    <div style={{height:"100%",display:"flex",flexDirection:"column",
      background:"#fff",border:compact?"none":"2px solid #E2E8F0",
      borderRadius:compact?0:10,boxSizing:"border-box",
      padding:compact?"4px 8px":"12px 14px"}}>
      {/* filter row */}
      <div style={{display:"flex",alignItems:"center",gap:6,marginBottom:compact?3:8,flexShrink:0}}>
        {(["breast","colon","lung"] as const).map(c=>{
          const on=filters.has(c); const col=CANCER_COLORS[c];
          return(
            <button key={c} onClick={()=>onFilterChange((prev:Set<string>)=>{const n=new Set(prev);n.has(c)?(n.size>1&&n.delete(c)):n.add(c);return n;})}
              style={{display:"flex",alignItems:"center",gap:4,padding:"3px 8px",borderRadius:5,
                cursor:"pointer",border:`2px solid ${on?col:"#CBD5E1"}`,
                background:on?col+"14":"transparent",transition:"all .1s"}}>
              <span style={{width:7,height:7,borderRadius:"50%",background:on?col:"#CBD5E1",display:"inline-block"}}/>
              <span style={{color:on?col:"#94A3B8",fontSize:9,fontWeight:800,fontFamily:FONT}}>{c}</span>
            </button>
          );
        })}
        <span style={{marginLeft:"auto",color:"#94A3B8",fontSize:9,fontFamily:FONT}}>
          <strong style={{color:"#2B6CB0"}}>click</strong>=A &nbsp;·&nbsp;
          <strong style={{color:"#6B46C1"}}>right-click</strong>=B
        </span>
      </div>
      {/* svg */}
      <div style={{flex:1,overflow:"hidden",minHeight:0}}>
        <svg viewBox={`0 0 ${W} ${H}`} style={{width:"100%",height:"100%",display:"block"}}>
          {[.25,.5,.75].map(f=><g key={f}>
            <line x1={pl} y1={pt+ph*(1-f)} x2={pl+pw} y2={pt+ph*(1-f)} stroke="#E2E8F0" strokeWidth={1}/>
            {!compact&&<text x={pl-5} y={pt+ph*(1-f)+3} textAnchor="end" fill="#94A3B8" fontSize={9} fontFamily={FONT}>{Math.round(f*100)}%</text>}
          </g>)}
          {!compact&&<>
            <text x={pl+pw/2} y={H-4} textAnchor="middle" fill="#64748B" fontSize={10} fontFamily={FONT}>Network Size →</text>
            <text x={12} y={pt+ph/2} textAnchor="middle" fill="#64748B" fontSize={10} fontFamily={FONT} transform={`rotate(-90,12,${pt+ph/2})`}>Avg Risk ↑</text>
          </>}
          {sorted.map(p=>{
            const{cx,cy}=toSVG(p); const col=CANCER_COLORS[p.cancer];
            const isSel=p.id===selectedId,isCmp=p.id===compareId,isHov=p.id===hov;
            const r=isSel||isCmp?(compact?5:8):(compact?2:3)+(p.maxTeam/maxTeam)*(compact?2.5:5);
            return(<g key={p.id} style={{cursor:"pointer"}}
              onClick={()=>onSelect(p.id)}
              onContextMenu={e=>{e.preventDefault();onCompare&&onCompare(p.id);}}
              onMouseEnter={()=>setHov(p.id)} onMouseLeave={()=>setHov(null)}>
              {isSel&&<><circle cx={cx} cy={cy} r={r+7} fill="none" stroke="#2B6CB0" strokeWidth={2}/><circle cx={cx} cy={cy} r={r+12} fill="none" stroke={col} strokeWidth={.8} opacity={.25}/></>}
              {isCmp&&<circle cx={cx} cy={cy} r={r+7} fill="none" stroke="#6B46C1" strokeWidth={2.5} strokeDasharray="5,3"/>}
              {isHov&&!isSel&&!isCmp&&<circle cx={cx} cy={cy} r={r+5} fill="none" stroke={col} strokeWidth={1.5} opacity={.5}/>}
              {p.survived
                ?<circle cx={cx} cy={cy} r={r} fill={col} opacity={isSel||isCmp?1:isHov?.9:.3}/>
                :<circle cx={cx} cy={cy} r={r} fill="none" stroke={col} strokeWidth={2} opacity={isSel||isCmp?1:.6}/>}
              {(isSel||isCmp)&&<>
                <rect x={cx+r+2} y={cy-8} width={14} height={10} rx={2} fill={isSel?"#2B6CB0":"#6B46C1"}/>
                <text x={cx+r+9} y={cy} textAnchor="middle" fill="white" fontSize={7} fontFamily={FONT} fontWeight={800}>{isSel?"A":"B"}</text>
              </>}
              {isHov&&!isSel&&!isCmp&&!compact&&(()=>{
                const flip=cx>pl+pw*.65,tw=92;
                const tx=flip?cx-tw-5:cx+8,ty=Math.max(pt,Math.min(cy-14,pt+ph-28));
                return(<g style={{pointerEvents:"none"}}>
                  <rect x={tx} y={ty} width={tw} height={26} rx={3} fill="white" stroke="#E2E8F0" strokeWidth={1.5}/>
                  <text x={tx+5} y={ty+11} fill={col} fontSize={9} fontFamily={FONT} fontWeight={800}>{p.id}</text>
                  <text x={tx+5} y={ty+22} fill="#64748B" fontSize={8} fontFamily={FONT}>{p.cancer} · {p.avgRisk}% · team {p.maxTeam}</text>
                </g>);
              })()}
            </g>);
          })}
        </svg>
      </div>
      {/* legend */}
      {!compact&&(
        <div style={{display:"flex",gap:10,marginTop:5,flexShrink:0,flexWrap:"wrap"}}>
          {(["breast","colon","lung"] as const).map(c=>(
            <div key={c} style={{display:"flex",alignItems:"center",gap:3}}>
              <svg width={8} height={8}><circle cx={4} cy={4} r={3.5} fill={CANCER_COLORS[c]}/></svg>
              <span style={{color:"#64748B",fontSize:9,textTransform:"uppercase",fontFamily:FONT}}>{c}</span>
            </div>
          ))}
          <span style={{color:"#94A3B8",fontSize:9,fontFamily:FONT}}>filled=survived · hollow=deceased</span>
          <span style={{marginLeft:"auto",color:"#94A3B8",fontSize:9,fontFamily:FONT}}>{patients.length} pts</span>
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// WEEK DETAIL — attributes + SHAP for one selected week
// ─────────────────────────────────────────────────────────────────────────────
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
        <Stat label="HCP Types"      value={String(data.hcpNames?.filter(n=>n&&n!=="nan").length??0)} color={color}/>
      </div>
      <div style={{marginBottom:14}}>
        <div style={{color:"#0F172A",fontSize:11,fontWeight:800,letterSpacing:1,marginBottom:6,fontFamily:FONT}}>
          ACTIVE SPECIALTIES
        </div>
        <div style={{display:"flex",flexWrap:"wrap",gap:4}}>
          {(data.hcpNames?.filter(n=>n&&n!=="nan")??[]).map((n,i)=>(
            <span key={i} style={{background:color+"10",border:`2px solid ${color}22`,
              borderRadius:4,padding:"3px 9px",color,fontSize:10,fontFamily:FONT,fontWeight:700}}>{n}</span>
          ))}
          {(!data.hcpNames||data.hcpNames.filter(n=>n&&n!=="nan").length===0)&&
            <span style={{color:"#94A3B8",fontSize:10,fontFamily:FONT}}>No specialty data</span>}
        </div>
      </div>
      <div>
        <div style={{color:"#0F172A",fontSize:11,fontWeight:800,letterSpacing:1,marginBottom:4,fontFamily:FONT}}>
          SURROGATE MODEL WEIGHTS
        </div>
        <div style={{color:"#64748B",fontSize:10,marginBottom:8,fontFamily:FONT}}>
          Ranked by |weight| · Red = raises risk · Green = protective · w = surrogate coefficient
        </div>
        {(data.topContrib??[]).slice(0,8).map((s,si)=>{
          const isHarmful = s.weight > 0;
          const parts = s.feature.split("::");
          const prefix = parts[0] ?? "";
          const spec   = (parts[1] ?? "").replace(/^\*/,"").replace(/_/g," ")
            .replace(/\b\w/g,c=>c.toUpperCase()).trim();
          const suffix = (parts[2] ?? "").replace(/[_|]/g," ").trim();
          const lbl    = prefix.includes("SPECIALTY") || prefix.includes("PROV_TYPE")
            ? spec : `${spec}${suffix ? " · "+suffix : ""}`;
          const maxW   = Math.max(...(data.topContrib??[]).slice(0,8).map(x=>Math.abs(x.weight)),0.001);
          const barW   = Math.min(90, (Math.abs(s.weight)/maxW)*90);
          const col    = isHarmful ? "#E53E3E" : "#38A169";
          return(
            <div key={si} style={{display:"flex",alignItems:"center",gap:8,padding:"5px 0",
              borderBottom:"1px solid #F1F5F9"}}>
              <div style={{flex:1,minWidth:0}}>
                <div style={{color:"#0F172A",fontSize:11,fontFamily:FONT,lineHeight:1.3,
                  overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{lbl}</div>
                <div style={{color:"#94A3B8",fontSize:9,fontFamily:FONT,marginTop:1}}>
                  val={s.value.toFixed(2)} · contrib={s.contribution>=0?"+":""}{s.contribution.toFixed(3)}
                </div>
              </div>
              <div style={{width:90,height:7,background:"#F1F5F9",borderRadius:3,overflow:"hidden",flexShrink:0}}>
                <div style={{height:"100%",width:barW,background:col,borderRadius:3,
                  transition:"width .2s"}}/>
              </div>
              <span style={{color:col,fontSize:11,fontWeight:800,
                minWidth:52,textAlign:"right",fontFamily:FONT}}>
                {isHarmful?"+":""}{s.weight.toFixed(3)}
              </span>
            </div>
          );
        })}
        {(!data.topContrib||data.topContrib.length===0)&&
          <span style={{color:"#94A3B8",fontSize:11,fontFamily:FONT}}>No surrogate data for this week</span>}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// COMPARE GLYPH (patient B radial — standalone, no RadialGlyph dependency)
// ─────────────────────────────────────────────────────────────────────────────
interface CGProps{weeklySnap:WeekData[];surgeonSnap:number[];totalHCP:number;
  selectedWeek:number|null;onSelectWeek:(w:number|null)=>void;
  onHoverWeek:(d:WeekData|null)=>void;mode:ViewMode;}
function CompareGlyph({weeklySnap,surgeonSnap,totalHCP,selectedWeek,onSelectWeek,onHoverWeek,mode}:CGProps){
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
        <svg ref={svgRef} viewBox={`0 0 ${SIZE} ${SIZE}`} preserveAspectRatio="xMidYMid meet"
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
              onMouseEnter={()=>{setHovIdx(i);onHoverWeek(weeklySnap[i]);}}
              onMouseMove={()=>{setHovIdx(i);onHoverWeek(weeklySnap[i]);}}
              onMouseLeave={()=>{setHovIdx(null);onHoverWeek(null);}}
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
// APP
// ─────────────────────────────────────────────────────────────────────────────
export default function App(){
  const [ready,          setReady]          = useState(false);
  const [focusId,        setFocusId]        = useState("");
  const [cmpId,          setCmpId]          = useState("");
  const [tick,           setTick]           = useState(0);
  const [cmpTick,        setCmpTick]        = useState(0);
  const [mode,           setMode]           = useState<ViewMode>("delta");

  // single-view week
  const [selWeek,        setSelWeek]        = useState<number|null>(null);
  const [hovData,        setHovData]        = useState<WeekData|null>(null);

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
      setFocusId(selectedPatientId); setReady(true);
      Promise.all([nanSafe("/temporal_networks.json"),nanSafe("/full_va_export_with_linear.json")])
        .then(([t,e])=>{
          _temporal=t as Record<string,unknown>;
          if(Array.isArray(e)){const m:Record<string,unknown>={};for(const r of e as Array<{id:string}>) m[r.id]=r;_egoMap=m;}
          else _egoMap=e as Record<string,unknown>;
        });
    });
  },[]);

  const handleSelect=(id:string)=>{
    // Toggle: clicking the already-selected patient deselects
    if(id===focusId){
      setFocusId("");setSelWeek(null);setHovData(null);setTick(t=>t+1);
      return;
    }
    switchPatient(id,_temporal,_egoMap as never);
    setFocusId(id);setSelWeek(null);setHovData(null);setSharedWeek(null);setTick(t=>t+1);
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
      </div>
      <div style={{color:"#475569",fontFamily:FONT,fontSize:11,letterSpacing:2}}>LOADING PATIENT DATA…</div>
    </div>
  );

  const {avgRiskAll,peakWeek,avgNotes}=getPatientSummary();
  const peakDelta=weeklyData.length?weeklyData.reduce((b,d)=>Math.abs(d.probDelta)>Math.abs(b.probDelta)?d:b,weeklyData[0]):null;
  const cmpSum=getPatientSummary(cmpSnap);
  const focusPt=getPatientById(focusId);
  const cmpPt=getPatientById(cmpId);
  const hcpGroups=[...new Set(weeklyData.flatMap(w=>w.hcpNames))].filter(Boolean).slice(0,24);
  const selWeekDataA=sharedWeek!=null?weeklyData.find(w=>w.week===sharedWeek)??null:null;
  const selWeekDataB=sharedWeek!=null?cmpSnap.find(w=>w.week===sharedWeek)??null:null;
  const singleWeekData=hovData??(selWeek!=null?weeklyData.find(w=>w.week===selWeek)??null:null);

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
        {/* <div style={{display:"flex",gap:0,background:"#FFFFFF10",borderRadius:7,padding:2,marginLeft:6,flexShrink:0}}>
          {(["delta","prob"] as const).map(m=>(
            <button key={m} onClick={()=>setMode(m)} style={{
              padding:"4px 12px",borderRadius:5,cursor:"pointer",
              background:mode===m?"#FFFFFF":"transparent",border:"none",
              color:mode===m?"#0F172A":"#64748B",
              fontSize:10,fontFamily:FONT,fontWeight:800,letterSpacing:.8,transition:"all .1s",
            }}>{m==="delta"?"Δ PROB":"RISK %"}</button>
          ))}
        </div> */}

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
          {/* LEFT: Scatter
              - No patient selected → full width (100%)
              - Patient selected → 45% */}
          <div style={{
            flexShrink:0,
            width: patientSelected ? "45%" : "100%",
            transition:"width .25s ease",
            borderRight: patientSelected ? "3px solid #E2E8F0" : "none",
            display:"flex",flexDirection:"column",
            background:"#fff",overflow:"hidden",
          }}>
            {/* Scatter header */}
            <div style={{
              flexShrink:0,padding:"10px 16px 8px",
              borderBottom:"2px solid #E2E8F0",
              display:"flex",alignItems:"center",gap:10,
            }}>
              <span style={{color:"#0F172A",fontSize:12,fontWeight:800,fontFamily:FONT,letterSpacing:1}}>
                COHORT OVERVIEW
              </span>
              <span style={{color:"#64748B",fontSize:10,fontFamily:FONT}}>{patients.length} patients</span>
              {!patientSelected&&(
                <span style={{color:"#94A3B8",fontSize:10,fontFamily:FONT,marginLeft:8}}>
                  Click a patient to begin analysis
                </span>
              )}
              {patientSelected&&(
                <span style={{color:"#94A3B8",fontSize:10,fontFamily:FONT,marginLeft:8}}>
                  Click selected dot again to deselect
                </span>
              )}
            </div>
            {/* Scatter body */}
            <div style={{flex:1,minHeight:0,padding:"10px 12px"}}>
              <Scatter
                selectedId={focusId} compareId={cmpId}
                onSelect={handleSelect} onCompare={handleCompare}
                filters={filters} onFilterChange={setFilters}/>
            </div>
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
                      onSelectWeek={w=>{setSelWeek(w);if(w===null)setHovData(null);}}
                      onHoverWeek={setHovData}
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
                    <EgoNetwork key={focusId} patientId={focusId} accentColor="#2B6CB0"/>
                  </div>
                </div>

              </div>
            </div>
          )}
        </div>

      ) : view==="compare" ? (

        /* ── COMPARE VIEW ─────────────────────────────────────────────────── */
        <div style={{flex:1,minHeight:0,display:"flex",flexDirection:"column",overflow:"hidden"}}>

          {/* Two columns — no scatter strip */}
          <div style={{flex:1,minHeight:0,display:"flex",overflow:"hidden"}}>

            {/* ── COLUMN A ── */}
            <div style={{flex:1,minWidth:0,display:"flex",flexDirection:"column",
              overflow:"hidden",borderRight:"3px solid #E2E8F0"}}>
              <ColHeader
                label="A" color="#2B6CB0" id={focusId} pt={focusPt}
                avgRisk={avgRiskAll} totalHCP={totalPatientHCP}
                numWeeks={weeklyData.length}
                sharedWeek={sharedWeek} onClearWeek={()=>setSharedWeek(null)}/>
              <div style={{flex:1,overflowY:"auto",padding:"14px",
                display:"flex",flexDirection:"column",gap:14,background:"#F8FAFC"}}>

                {/* Radial */}
                <div style={{height:560,flexShrink:0}}>
                  <RadialGlyph key={focusId+tick+"cmp"}
                    selectedWeek={sharedWeek}
                    onSelectWeek={setSharedWeek}
                    onHoverWeek={()=>{}}
                    mode={mode} onModeChange={setMode}
                    accentColor="#2B6CB0"/>
                </div>

                {/* Summary stats */}
                <div style={{display:"grid",gridTemplateColumns:"repeat(2,1fr)",gap:10,flexShrink:0}}>
                  <Stat label="Avg Risk"   value={`${avgRiskAll}%`}         color="#D69E2E"/>
                  <Stat label="Total HCPs" value={String(totalPatientHCP)}  color="#2B6CB0"/>
                  <Stat label="Notes/Wk"   value={avgNotes}                  color="#38A169"/>
                  {peakWeek&&<Stat label="Peak Risk" value={`W${peakWeek.week} · ${(peakWeek.riskScore*100).toFixed(0)}%`} color="#E53E3E"/>}
                </div>

                {/* Week detail — appears when week is selected */}
                {selWeekDataA&&(
                  <WeekDetail data={selWeekDataA} color="#2B6CB0" mode={mode}/>
                )}
                {!selWeekDataA&&(
                  <div style={{padding:"12px 14px",background:"#fff",border:"2px solid #E2E8F0",
                    borderRadius:8,color:"#64748B",fontSize:11,fontFamily:FONT,lineHeight:1.6}}>
                    <strong style={{color:"#2B6CB0"}}>Click any spike</strong> on the radial above — both patients will sync to that week simultaneously.
                  </div>
                )}

                {/* HCP chart */}
                <div style={{flexShrink:0}}>
                  <BlockLabel text={`HCP SPECIALTY BREAKDOWN${sharedWeek!=null?` — Week ${sharedWeek}`:""}`}/>
                  <div style={{border:"2px solid #0F172A",borderTop:"none",borderRadius:"0 0 8px 8px",overflow:"hidden"}}>
                    <HCPBarChart key={focusId+tick+(sharedWeek??"all")} selectedWeek={sharedWeek}/>
                  </div>
                </div>

                {/* Ego network — syncs to sharedWeek, grows with content */}
                <div style={{flexShrink:0}}>
                  <BlockLabel
                    text="EGO CARE NETWORK"
                    right={sharedWeek!=null
                      ?<span style={{color:"#60A5FA",fontSize:10,fontFamily:FONT,fontWeight:700}}>WEEK {sharedWeek}</span>
                      :<span style={{color:"#94A3B8",fontSize:10,fontFamily:FONT}}>click a spike to jump to week</span>}/>
                  <div style={{border:"2px solid #0F172A",borderTop:"none",
                    borderRadius:"0 0 8px 8px"}}>
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
                sharedWeek={sharedWeek} onClearWeek={()=>setSharedWeek(null)}
                onRemove={handleClearCompare}/>
              <div style={{flex:1,overflowY:"auto",padding:"14px",
                display:"flex",flexDirection:"column",gap:14,background:"#F8FAFC"}}>

                {/* Radial */}
                <div style={{height:560,flexShrink:0}}>
                  <CompareGlyph key={cmpId+cmpTick}
                    weeklySnap={cmpSnap} surgeonSnap={cmpSurgSnap} totalHCP={cmpHCPSnap}
                    selectedWeek={sharedWeek} onSelectWeek={setSharedWeek}
                    onHoverWeek={()=>{}} mode={mode}/>
                </div>

                {/* Summary stats */}
                <div style={{display:"grid",gridTemplateColumns:"repeat(2,1fr)",gap:10,flexShrink:0}}>
                  <Stat label="Avg Risk"   value={`${cmpSum.avgRiskAll}%`}  color="#D69E2E"/>
                  <Stat label="Total HCPs" value={String(cmpHCPSnap)}       color="#6B46C1"/>
                  <Stat label="Notes/Wk"   value={cmpSum.avgNotes}          color="#38A169"/>
                  {cmpSum.peakWeek&&<Stat label="Peak Risk" value={`W${cmpSum.peakWeek.week} · ${(cmpSum.peakWeek.riskScore*100).toFixed(0)}%`} color="#E53E3E"/>}
                </div>

                {/* Week detail */}
                {selWeekDataB&&(
                  <WeekDetail data={selWeekDataB} color="#6B46C1" mode={mode}/>
                )}
                {!selWeekDataB&&(
                  <div style={{padding:"12px 14px",background:"#fff",border:"2px solid #E2E8F0",
                    borderRadius:8,color:"#64748B",fontSize:11,fontFamily:FONT,lineHeight:1.6}}>
                    Waiting for week selection — click any spike in either column.
                  </div>
                )}

                {/* HCP chart — patient B uses cmpSnap data */}
                <div style={{flexShrink:0}}>
                  <BlockLabel text={`HCP SPECIALTY BREAKDOWN${sharedWeek!=null?` — Week ${sharedWeek}`:""}`}/>
                  <div style={{border:"2px solid #0F172A",borderTop:"none",borderRadius:"0 0 8px 8px",overflow:"hidden"}}>
                    <HCPBarChart key={cmpId+cmpTick+(sharedWeek??"all")} selectedWeek={sharedWeek} data={cmpSnap}/>
                  </div>
                </div>

                {/* Ego network — same sharedWeek key = synced with column A */}
                <div style={{flexShrink:0}}>
                  <BlockLabel
                    text="EGO CARE NETWORK"
                    right={sharedWeek!=null
                      ?<span style={{color:"#C084FC",fontSize:10,fontFamily:FONT,fontWeight:700}}>WEEK {sharedWeek}</span>
                      :<span style={{color:"#94A3B8",fontSize:10,fontFamily:FONT}}>click a spike to jump to week</span>}/>
                  <div style={{border:"2px solid #0F172A",borderTop:"none",
                    borderRadius:"0 0 8px 8px"}}>
                    <EgoNetwork key={`${cmpId}-${sharedWeek??""}`} patientId={cmpId} accentColor="#6B46C1" initialWeek={sharedWeek??undefined}/>
                  </div>
                </div>

              </div>
            </div>
          </div>

        </div>

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

          const SPEC_COLORS: Record<string,string> = {
            "Surgical Oncology":"#7c3aed","Medical Oncology":"#be185d","Nursing":"#0891b2",
            "Internal Medicine":"#2A9D8F","Int Med Specialty":"#1a47c8","Radiology":"#0284c7",
            "Emergency Medicine":"#e07b39","Mental Health":"#d97706","Pharmacy":"#2EC4B6",
            "Pathology":"#6D6875","Surgery Other":"#884EA0","Therapy":"#1ABC9C",
            "Radiation Oncology":"#CB4335","Patient Support":"#92400e","Dietary":"#56C596",
            "General Practice":"#E9C46A","Family Practice":"#F4A261","Ancillary":"#7B8CDE",
            "Urgent Care":"#f97316","Pediatrics":"#FF9F1C","Specialty Other":"#D4AC0D",
            "Scribe":"#AAB7B8","Provider Type":"#64748b","Clinician Title":"#64748b",
            "Resident":"#64748b","Inpatient":"#64748b","Other":"#94a3b8",
          };
          function featGroupLabel(feat: string): string {
            const prefix = feat.split("::")[0];
            if (prefix==="ACCESS_USER_IS_RESIDENT") return "Resident";
            if (prefix==="ACCESS_USER_CLINICIAN_TITLE") return "Clinician Title";
            if (prefix==="INPATIENT_DEPT_YN") return "Inpatient";
            if (prefix==="ACCESS_USER_PROV_TYPE") return "Provider Type";
            const spec = (feat.split("::")[1]??"").toUpperCase();
            const surgOncTerms=["SURGERY","SURG","ANESTHES","UROLOGY","COLON/RECTAL","CARDIOTHORAC","GYNECOLOG"];
            if(surgOncTerms.some(t=>spec.includes(t))) return "Surgical Oncology";
            if(spec.includes("ONCOLOGY")||spec.includes("HEMATOL")||spec.includes("HOSPICE")||spec.includes("PALLIATIVE")) return "Medical Oncology";
            if(spec.includes("RADIATION")) return "Radiation Oncology";
            if(spec.includes("NURS")||spec.includes("NP ")||spec.includes("PHYSICIAN ASSIST")) return "Nursing";
            if(spec.includes("INTERNAL MED")||spec.includes("HOSPITALIST")) return "Internal Medicine";
            if(spec.includes("CARDIOLOGY")||spec.includes("PULMONARY")||spec.includes("GASTRO")||spec.includes("NEPHRO")||spec.includes("ENDOCRIN")) return "Int Med Specialty";
            if(spec.includes("RADIOL")||spec.includes("NUCLEAR")) return "Radiology";
            if(spec.includes("EMERGENCY")) return "Emergency Medicine";
            if(spec.includes("PSYCH")||spec.includes("MENTAL")||spec.includes("PSYCHOL")) return "Mental Health";
            if(spec.includes("PHARM")) return "Pharmacy";
            if(spec.includes("PATH")||spec.includes("LAB")) return "Pathology";
            if(spec.includes("THERAP")||spec.includes("REHAB")||spec.includes("SPEECH")||spec.includes("OCCUP")) return "Therapy";
            if(spec.includes("DIET")||spec.includes("NUTRI")) return "Dietary";
            if(spec.includes("URGENT")) return "Urgent Care";
            if(spec.includes("PATIENT SUPPORT")||spec.includes("SOCIAL WORK")||spec.includes("CASE MANAGE")) return "Patient Support";
            return "Other";
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
          // Taller chart for better readability
          const CW=640, CH=180, PL=48, PR=20, PT=16, PB=28;
          const pw=CW-PL-PR, ph=CH-PT-PB;
          const n=wiData.length;
          const toX=(i:number)=>PL+(i/(Math.max(n-1,1)))*pw;
          const toY=(v:number)=>PT+ph-(Math.max(0,Math.min(1,v)))*ph;

          // Original line: full span, always gray dashed
          const origPts = origRisks.map((v,i)=>`${toX(i).toFixed(1)},${toY(v).toFixed(1)}`).join(" L");

          // Perturbed line: drawn in two segments
          //   Segment 1 (before center): matches original exactly — draw as solid accent color
          //   Segment 2 (from center): the actual perturbed values — solid accent color
          // This way the perturbed line "splits off" visually at the center marker
          const beforeCenterPts = origRisks.slice(0, wiCenterIdx+1)
            .map((v,i)=>`${toX(i).toFixed(1)},${toY(v).toFixed(1)}`).join(" L");
          const afterCenterPts  = pertRisks.slice(wiCenterIdx)
            .map((v,j)=>`${toX(wiCenterIdx+j).toFixed(1)},${toY(v).toFixed(1)}`).join(" L");

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

                        {/* Y grid lines + labels */}
                        {[0,.25,.5,.75,1].map(v=>{
                          const y=toY(v).toFixed(1);
                          return(<g key={v}>
                            <line x1={PL} y1={y} x2={CW-PR} y2={y}
                              stroke={v===0.5?"#E2E8F0":"#F1F5F9"} strokeWidth={v===0.5?1.2:.7}
                              strokeDasharray={v===0.5?"4,3":""}/>
                            <text x={PL-5} y={parseFloat(y)+3.5} textAnchor="end"
                              fontSize={8} fill="#94A3B8" fontFamily={FONT}>
                              {(v*100).toFixed(0)}%
                            </text>
                          </g>);
                        })}

                        {/* X axis baseline */}
                        <line x1={PL} y1={PT+ph} x2={CW-PR} y2={PT+ph} stroke="#E2E8F0" strokeWidth={1}/>

                        {/* Shaded delta area between original and perturbed after center */}
                        {shadeArea&&<path d={shadeArea} fill={isGood?"#38A169":"#E53E3E"} opacity={.1}/>}

                        {/* ── ORIGINAL LINE — gray dashed, full span ── */}
                        <polyline points={origPts} fill="none"
                          stroke="#94A3B8" strokeWidth={2} strokeDasharray="7,4" opacity={.9}/>

                        {/* ── PROJECTED LINE — two segments ──
                            Before center: same as original (solid accent, slightly transparent)
                            After center:  diverged perturbed values (solid, full opacity) */}
                        {n > 1 && wiCenterIdx > 0 && (
                          <polyline points={beforeCenterPts} fill="none"
                            stroke={isGood?"#38A169":"#E53E3E"} strokeWidth={2.5} opacity={.35}/>
                        )}
                        <polyline points={afterCenterPts} fill="none"
                          stroke={isGood?"#38A169":"#E53E3E"} strokeWidth={2.5} opacity={1}/>

                        {/* Endpoint dot on original */}
                        <circle cx={toX(n-1).toFixed(1)} cy={toY(origRisks[n-1]??0).toFixed(1)}
                          r={4} fill="#94A3B8" opacity={.8}/>

                        {/* Endpoint dot on perturbed */}
                        <circle cx={toX(n-1).toFixed(1)} cy={toY(pertRisks[n-1]??0).toFixed(1)}
                          r={5} fill={isGood?"#38A169":"#E53E3E"} stroke="white" strokeWidth={1.5}/>

                        {/* Delta annotation at end */}
                        {Math.abs(delta)>0.001&&(()=>{
                          const xEnd=toX(n-1);
                          const yOrig=toY(origRisks[n-1]??0);
                          const yPert=toY(pertRisks[n-1]??0);
                          const midY=(yOrig+yPert)/2;
                          return(<g>
                            <line x1={xEnd+8} y1={yOrig} x2={xEnd+8} y2={yPert}
                              stroke={isGood?"#38A169":"#E53E3E"} strokeWidth={1.5}
                              markerStart="none" opacity={.7}/>
                            <text x={xEnd+12} y={midY+3} fontSize={8} fill={isGood?"#38A169":"#E53E3E"}
                              fontFamily={FONT} fontWeight={800}>
                              {isGood?"▼":"▲"}{(Math.abs(delta)*100).toFixed(1)}%
                            </text>
                          </g>);
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