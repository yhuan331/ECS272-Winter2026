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
  textMuted:     "#94A3B8",
  textFaint:     "#CBD5E1",

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
  breast: "#0694A2",  // teal
  colon:  "#E53E3E",  // red
  lung:   "#2B6CB0",  // blue
};