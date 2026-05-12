export const C = {
  bg:           "var(--bg-canvas)",
  surface:      "var(--bg)",
  surface2:     "var(--bg-alt)",
  surface3:     "var(--border)",
  surfaceHover: "var(--bg-alt)",
  border:       "var(--border)",
  borderLight:  "var(--border-h)",
  borderHover:  "var(--border-hh)",
  accent:       "#2563eb",
  accentDim:    "#dbeafe",
  accentText:   "#1d4ed8",
  success:      "#00af9b",
  successDim:   "#d1fae5",
  warn:         "#ffb800",
  warnDim:      "#fef3c7",
  danger:       "#ef4444",
  dangerDim:    "#fee2e2",
  blue:         "#2563eb",
  blueDim:      "#dbeafe",
  text:         "var(--text)",
  textSec:      "var(--text-sec)",
  textTert:     "var(--text-tert)",
  headingEm:    "var(--text)",
};

export const diffColor: Record<string, string> = {
  Easy: "#00af9b", Medium: "#ffa116", Hard: "#ef4444",
};
export const diffBg: Record<string, string> = {
  Easy: "#d1fae5", Medium: "#fff7e6", Hard: "#fee2e2",
};
export const accuracyColor = (acc: number) =>
  acc >= 75 ? "#00af9b" : acc >= 50 ? "#ffa116" : "#ef4444";
