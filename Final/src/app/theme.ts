// ── Shared light theme tokens ─────────────────────────────────────
export const T = {
  // Backgrounds
  bg:         "#F8F9FB",   // page background
  bgCard:     "#FFFFFF",   // card/panel background
  bgHover:    "#F1F5F9",   // hover state
  bgInset:    "#F1F5F9",   // inset / secondary surface

  // Borders
  border:     "#E2E8F0",
  borderMid:  "#CBD5E1",

  // Text
  textPrimary:   "#0F172A",
  textSecondary: "#475569",
  textMuted:     "#3a4452",
  textFaint:     "#000000",

  // Accent palette — kept vivid so they pop on white
  red:     "#E53E3E",
  orange:  "#DD6B20",
  yellow:  "#D69E2E",
  green:   "#38A169",
  teal:    "#0694A2",
  blue:    "#2B6CB0",
  purple:  "#6B46C1",
  pink:    "#D53F8C",

  // Data colors (slightly adjusted for white bg)
  riskHigh:   "#E53E3E",
  riskMid:    "#D69E2E",
  riskLow:    "#38A169",
  teamColor:  "#2B6CB0",
  entropyClr: "#6B46C1",

  font: "'Space Mono', monospace",
};

// Cancer cohort colors on white bg
export const CANCER_COLORS = {
  breast: "#7c3aed",  
  colon:  "#714523", 
  lung:   "#32a4d8",
};


// ── Specialty group colors — single source of truth ──────────────────────────
// Matches EgoNetwork LEVEL1_GROUPS. Used by HCPBarChart, EgoNetwork, what-if view.
export const SPECIALTY_COLORS: Record<string, string> = {
  "Ancillary":                  "#7B8CDE",
  "Dietary":                    "#56C596",
  "Emergency Medicine":         "#e07b39",
  "Family Practice":            "#F4A261",
  "General Practice":           "#E9C46A",
  "Internal Medicine":          "#2A9D8F",
  "Int. Med. Specialty":        "#1a47c8",
  "Internal Medicine Specialty":"#1a47c8",
  "Medical Oncology":           "#be185d",
  "Mental Health":              "#d97706",
  "Nursing":                    "#0891b2",
  "Pathology":                  "#6D6875",
  "Patient Support":            "#92400e",
  "Patient Support Services":   "#92400e",
  "Pediatrics":                 "#FF9F1C",
  "Pharmacy":                   "#2EC4B6",
  "Radiation Oncology":         "#CB4335",
  "Radiology":                  "#0284c7",
  "Scribe":                     "#AAB7B8",
  "Specialty Other":            "#D4AC0D",
  "Surgery Other":              "#884EA0",
  "Surgical Oncology":          "#7c3aed",
  "Therapy":                    "#1ABC9C",
  "Urgent Care":                "#f97316",
  "Other":                      "#94a3b8",
  "Unknown":                    "#94a3b8",
};