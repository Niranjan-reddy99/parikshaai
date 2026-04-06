export const C = {
  bg:           "var(--c-bg)",
  surface:      "var(--c-surface)",
  surfaceHover: "var(--c-surface3)",
  border:       "var(--c-border)",
  borderLight:  "var(--c-border-l)",
  borderHover:  "var(--c-border-h)",
  accent:       "#2dd4bf",
  accentDim:    "var(--c-accent-dim)",
  accentText:   "#2dd4bf",
  warn:         "#fbbf24",
  warnDim:      "var(--c-warn-dim)",
  danger:       "#f87171",
  dangerDim:    "var(--c-danger-dim)",
  blue:         "#60a5fa",
  blueDim:      "var(--c-blue-dim)",
  text:         "var(--c-text)",
  textSec:      "var(--c-text-sec)",
  textTert:     "var(--c-text-tert)",
  headingEm:    "var(--c-heading-em)",
};

export const diffColor: Record<string, string> = {
  Easy: "#2dd4bf", Medium: "#fbbf24", Hard: "#f87171",
};
export const diffBg: Record<string, string> = {
  Easy: "var(--c-accent-dim)", Medium: "var(--c-warn-dim)", Hard: "var(--c-danger-dim)",
};
export const accuracyColor = (acc: number) =>
  acc >= 75 ? "#2dd4bf" : acc >= 50 ? "#fbbf24" : "#f87171";
