// /**
//  * TimelineChart.tsx  — real data version
//  *
//  * Changes from mock:
//  *  - Imports weeklyData, surgeonEvents from realData
//  *  - team is normalized from careTeamSize (actual value, not /11)
//  *  - X axis ticks adapt to actual week count
//  *  - Shows entropy as a third subtle line
//  */

// import {
//   ResponsiveContainer,
//   ComposedChart,
//   Area,
//   Line,
//   XAxis,
//   YAxis,
//   CartesianGrid,
//   ReferenceLine,
//   Tooltip,
// } from "recharts";
// import { weeklyData, surgeonEvents } from "../realData";

// const FONT = "'Space Mono', monospace";

// export function TimelineChart() {
//   if (!weeklyData.length) return (
//     <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100%", color: "#2A3040", fontFamily: FONT, fontSize: 12, letterSpacing: 2 }}>
//       SELECT A PATIENT
//     </div>
//   );

//   const maxTeam = Math.max(...weeklyData.map((d) => d.teamSize), 1);

//   const chartData = weeklyData.map((d) => ({
//     week: d.week,
//     risk: Math.round(d.riskScore * 100),
//     // normalize team to 0-100 for same axis
//     team: Math.round((d.teamSize / maxTeam) * 100),
//     entropy: Math.round(d.entropy * 20), // scale entropy to visible range
//   }));

//   const numWeeks = weeklyData.length;
//   // Generate 6-8 evenly spaced tick marks
//   const tickCount = Math.min(8, numWeeks);
//   const tickStep = Math.floor(numWeeks / tickCount);
//   const xTicks = Array.from({ length: tickCount }, (_, i) =>
//     weeklyData[i * tickStep]?.week ?? 0
//   );

//   return (
//     <div
//       style={{
//         background: "#0D0F14",
//         padding: "12px 16px",
//         height: "100%",
//         fontFamily: FONT,
//         display: "flex",
//         flexDirection: "column",
//       }}
//     >
//       <div
//         style={{
//           color: "#64748B",
//           fontSize: 10,
//           letterSpacing: 1.5,
//           marginBottom: 6,
//         }}
//       >
//         WEEKLY ATTRIBUTE TIMELINE
//       </div>

//       <div style={{ flex: 1, minHeight: 0 }}>
//         <ResponsiveContainer width="100%" height="100%">
//           <ComposedChart
//             data={chartData}
//             margin={{ top: 5, right: 10, bottom: 5, left: 0 }}
//           >
//             <CartesianGrid
//               stroke="#1A2030"
//               strokeDasharray="3 3"
//               vertical={false}
//             />
//             <XAxis
//               dataKey="week"
//               tick={{ fill: "#475569", fontSize: 8, fontFamily: FONT }}
//               tickLine={false}
//               axisLine={false}
//               ticks={xTicks}
//               tickFormatter={(v: number) => `w${v}`}
//             />
//             <YAxis
//               tick={{ fill: "#334155", fontSize: 8, fontFamily: FONT }}
//               tickLine={false}
//               axisLine={false}
//               ticks={[0, 25, 50, 75, 100]}
//               tickFormatter={(v: number) => `${v}%`}
//               domain={[0, 100]}
//               width={32}
//             />

//             {/* Surgeon event reference lines */}
//             {surgeonEvents.map((w) => (
//               <ReferenceLine key={w} x={w} stroke="#FFD16655" strokeWidth={1} />
//             ))}

//             <defs>
//               <linearGradient id="riskFill" x1="0" y1="0" x2="0" y2="1">
//                 <stop offset="0%" stopColor="#FF6B6B" stopOpacity={0.2} />
//                 <stop offset="100%" stopColor="#FF6B6B" stopOpacity={0} />
//               </linearGradient>
//             </defs>

//             {/* Risk score area */}
//             <Area
//               type="monotone"
//               dataKey="risk"
//               stroke="#FF6B6B"
//               strokeWidth={1.5}
//               fill="url(#riskFill)"
//               dot={false}
//               isAnimationActive={false}
//             />

//             {/* Team size line (normalized) */}
//             <Line
//               type="monotone"
//               dataKey="team"
//               stroke="#4FFFB0"
//               strokeWidth={1.5}
//               strokeDasharray="5 3"
//               strokeOpacity={0.8}
//               dot={false}
//               isAnimationActive={false}
//             />

//             {/* Entropy line (subtle) */}
//             <Line
//               type="monotone"
//               dataKey="entropy"
//               stroke="#6B9FFF"
//               strokeWidth={1}
//               strokeDasharray="2 4"
//               strokeOpacity={0.4}
//               dot={false}
//               isAnimationActive={false}
//             />
//           </ComposedChart>
//         </ResponsiveContainer>
//       </div>

//       {/* Legend */}
//       <div style={{ display: "flex", gap: 20, marginTop: 4 }}>
//         <LegendItem color="#FF6B6B" label="RISK SCORE" dashed={false} />
//         <LegendItem color="#4FFFB0" label="TEAM SIZE" dashed={true} />
//         <LegendItem color="#FFD166" label="SURGEON EVENT" dashed={false} isLine />
//         <LegendItem color="#6B9FFF" label="ENTROPY" dashed={true} />
//       </div>
//     </div>
//   );
// }

// function LegendItem({
//   color,
//   label,
//   dashed,
//   isLine,
// }: {
//   color: string;
//   label: string;
//   dashed: boolean;
//   isLine?: boolean;
// }) {
//   return (
//     <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
//       <svg width={16} height={8}>
//         <line
//           x1={0}
//           y1={4}
//           x2={16}
//           y2={4}
//           stroke={color}
//           strokeWidth={isLine ? 1 : 1.5}
//           strokeDasharray={dashed ? "4,2" : undefined}
//           strokeOpacity={isLine ? 0.4 : 0.9}
//         />
//       </svg>
//       <span style={{ color: "#64748B", fontSize: 8, fontFamily: FONT }}>
//         {label}
//       </span>
//     </div>
//   );
// }