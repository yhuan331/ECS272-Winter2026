// // Generate mock patient cohort data
// export interface PatientDot {
//   id: string;
//   x: number; // network density 0-1
//   y: number; // avg risk score 0-1
//   cancer: "breast" | "colon" | "lung";
//   survived: boolean;
//   weeks: number;
//   avgRisk: number;
//   maxTeam: number;
//   density: number;
// }

// function seededRandom(seed: number) {
//   let s = seed;
//   return () => {
//     s = (s * 16807 + 0) % 2147483647;
//     return s / 2147483647;
//   };
// }

// const rand = seededRandom(42);

// const cancerTypes: PatientDot["cancer"][] = [
//   "breast",
//   "colon",
//   "lung",
// ];

// export const patients: PatientDot[] = Array.from(
//   { length: 120 },
//   (_, i) => {
//     const cancer = cancerTypes[Math.floor(i / 40)];
//     const survived = rand() > 0.35;
//     return {
//       id: `P${String(i + 1).padStart(3, "0")}`,
//       x: 0.1 + rand() * 0.8,
//       y: 0.1 + rand() * 0.8,
//       cancer,
//       survived,
//       weeks: Math.floor(20 + rand() * 84),
//       avgRisk: Math.round((15 + rand() * 60) * 10) / 10,
//       maxTeam: Math.floor(4 + rand() * 10),
//       density: Math.round((30 + rand() * 55) * 10) / 10,
//     };
//   },
// );

// // Override P008 specifically
// const p008Index = patients.findIndex((_, i) => i === 7);
// patients[p008Index] = {
//   id: "P008",
//   x: 0.68,
//   y: 0.43,
//   cancer: "lung",
//   survived: true,
//   weeks: 52,
//   avgRisk: 43.2,
//   maxTeam: 11,
//   density: 68,
// };

// export const selectedPatientId = "P008";

// export const cancerColors: Record<
//   PatientDot["cancer"],
//   string
// > = {
//   breast: "#4FFFB0",
//   colon: "#FF6B6B",
//   lung: "#6B9FFF",
// };

// // Weekly data for P008
// export interface WeekData {
//   week: number;
//   riskScore: number;
//   teamSize: number;
//   spikeColor: string;
//   hcpCount: number;
//   noteFrequency: number;
//   attributeSummary: string;
//   hcpNames: string[];
// }

// function interpolateColor(
//   colors: { t: number; color: string }[],
//   t: number,
// ): string {
//   if (t <= colors[0].t) return colors[0].color;
//   if (t >= colors[colors.length - 1].t)
//     return colors[colors.length - 1].color;
//   for (let i = 0; i < colors.length - 1; i++) {
//     if (t >= colors[i].t && t <= colors[i + 1].t) {
//       const ratio =
//         (t - colors[i].t) / (colors[i + 1].t - colors[i].t);
//       return lerpColor(
//         colors[i].color,
//         colors[i + 1].color,
//         ratio,
//       );
//     }
//   }
//   return colors[0].color;
// }

// function lerpColor(a: string, b: string, t: number): string {
//   const ar = parseInt(a.slice(1, 3), 16);
//   const ag = parseInt(a.slice(3, 5), 16);
//   const ab = parseInt(a.slice(5, 7), 16);
//   const br = parseInt(b.slice(1, 3), 16);
//   const bg = parseInt(b.slice(3, 5), 16);
//   const bb = parseInt(b.slice(5, 7), 16);
//   const r = Math.round(ar + (br - ar) * t);
//   const g = Math.round(ag + (bg - ag) * t);
//   const bl = Math.round(ab + (bb - ab) * t);
//   return `#${r.toString(16).padStart(2, "0")}${g.toString(16).padStart(2, "0")}${bl.toString(16).padStart(2, "0")}`;
// }

// const riskGradient = [
//   { t: 0, color: "#6BC96B" },
//   { t: 10, color: "#6BC96B" },
//   { t: 15, color: "#C8D966" },
//   { t: 20, color: "#FFD166" },
//   { t: 25, color: "#FF9A3C" },
//   { t: 29, color: "#FF4757" },
//   { t: 36, color: "#FF4757" },
//   { t: 40, color: "#FF9A3C" },
//   { t: 44, color: "#FFD166" },
//   { t: 48, color: "#C8D966" },
//   { t: 52, color: "#6BC96B" },
// ];

// const hcpPool = [
//   " (Oncologist)",
//   "(Nurse)",
//   "(GP)",
//   "(Radiologist)",
//   "(Pharmacist)",
//   "(Surgeon)",
//   "(Surgical Nurse)",
//   "(Anesthesiologist)",
//   " (Dietitian)",
// ];

// const attributeSummaries = ["Surgery + 1.2%"];

// export const weeklyData: WeekData[] = Array.from(
//   { length: 52 },
//   (_, i) => {
//     const week = i + 1;
//     let riskScore: number;
//     if (week <= 10) riskScore = 0.28 + (week / 10) * 0.08;
//     else if (week <= 20)
//       riskScore = 0.36 + ((week - 10) / 10) * 0.15;
//     else if (week <= 28)
//       riskScore = 0.51 + ((week - 20) / 8) * 0.15;
//     else if (week <= 32)
//       riskScore = 0.66 + ((week - 28) / 4) * 0.06;
//     else if (week <= 36)
//       riskScore = 0.72 - ((week - 32) / 4) * 0.08;
//     else if (week <= 44)
//       riskScore = 0.64 - ((week - 36) / 8) * 0.15;
//     else riskScore = 0.49 - ((week - 44) / 8) * 0.08;

//     let teamSize: number;
//     if (week <= 8) teamSize = 3;
//     else if (week <= 20) teamSize = 3 + ((week - 8) / 12) * 5;
//     else if (week <= 28) teamSize = 8 + ((week - 20) / 8) * 3;
//     else if (week <= 36) teamSize = 11;
//     else if (week <= 44) teamSize = 11 - ((week - 36) / 8) * 2;
//     else teamSize = 9 - ((week - 44) / 8) * 1;

//     const hcpCount = Math.round(teamSize);
//     const noteFrequency = Math.max(
//       1,
//       Math.round(hcpCount * (0.8 + riskScore * 1.5)),
//     );

//     return {
//       week,
//       riskScore: Math.round(riskScore * 100) / 100,
//       teamSize: Math.round(teamSize * 10) / 10,
//       spikeColor: interpolateColor(riskGradient, week),
//       hcpCount,
//       noteFrequency,
//       attributeSummary:
//         attributeSummaries[
//           Math.floor(i / 2.7) % attributeSummaries.length
//         ],
//       hcpNames: hcpPool.slice(0, hcpCount),
//     };
//   },
// );

// export const totalPatientHCP = 12;

// export const surgeonEvents = [28, 31, 36];