export const C = {
  bg:           "var(--bg-canvas)",
  surface:      "var(--bg)",
  surface2:     "var(--bg-alt)",
  surface3:     "var(--border)",
  surfaceHover: "var(--bg-alt)",
  border:       "var(--border)",
  borderLight:  "var(--border-h)",
  borderHover:  "var(--border-hh)",
  accent:       "var(--blue)",
  accentDim:    "var(--blue-soft)",
  accentText:   "var(--blue)",
  success:      "var(--green)",
  successDim:   "var(--green-soft)",
  warn:         "var(--warn)",
  warnDim:      "var(--warn-soft)",
  danger:       "var(--red)",
  dangerDim:    "var(--red-soft)",
  blue:         "var(--blue)",
  blueDim:      "var(--blue-soft)",
  text:         "var(--text)",
  textSec:      "var(--text-sec)",
  textTert:     "var(--text-tert)",
  headingEm:    "var(--text)",
};

export const diffColor: Record<string, string> = {
  Easy: "var(--green)", Medium: "var(--warn)", Hard: "var(--red)",
};
export const diffBg: Record<string, string> = {
  Easy: "var(--green-soft)", Medium: "var(--warn-soft)", Hard: "var(--red-soft)",
};
export const accuracyColor = (acc: number) =>
  acc >= 75 ? "#00af9b" : acc >= 50 ? "#ffa116" : "#ef4444";
