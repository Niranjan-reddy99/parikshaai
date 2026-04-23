export const C = {
  bg:           "var(--c-bg)",
  surface:      "var(--c-surface)",
  surface2:     "var(--c-surface2)",
  surface3:     "var(--c-surface3)",
  surfaceHover: "var(--c-surface3)",
  border:       "var(--c-border)",
  borderLight:  "var(--c-border-l)",
  borderHover:  "var(--c-border-h)",
  accent:       "#0F766E",
  accentDim:    "var(--c-accent-dim)",
  accentText:   "#0E7490",
  success:      "#15803D",
  successDim:   "rgba(21,128,61,0.10)",
  warn:         "#CA8A04",
  warnDim:      "var(--c-warn-dim)",
  danger:       "#F43F5E",
  dangerDim:    "var(--c-danger-dim)",
  blue:         "#0369A1",
  blueDim:      "var(--c-blue-dim)",
  text:         "var(--c-text)",
  textSec:      "var(--c-text-sec)",
  textTert:     "var(--c-text-tert)",
  headingEm:    "var(--c-heading-em)",
};

export const diffColor: Record<string, string> = {
  Easy: "#34D399", Medium: "#FBBF24", Hard: "#F43F5E",
};
export const diffBg: Record<string, string> = {
  Easy: "var(--c-accent-dim)", Medium: "var(--c-warn-dim)", Hard: "var(--c-danger-dim)",
};
export const accuracyColor = (acc: number) =>
  acc >= 75 ? "#34D399" : acc >= 50 ? "#FBBF24" : "#F43F5E";
