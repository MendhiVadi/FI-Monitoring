import type React from "react";

export const inputStyle: React.CSSProperties = {
  width: "100%",
  minHeight: 44,
  padding: "0.85rem",
  borderRadius: 10,
  border: "1px solid rgba(255,255,255,0.2)",
  background: "#071126",
  color: "white",
  font: "inherit",
};

export const labelStyle: React.CSSProperties = {
  display: "block",
  fontWeight: 600,
  marginBottom: "0.4rem",
};

// Dark text on the landing page's mint (10.6:1). White on the old #2f9e64 was
// 3.39:1, under WCAG AA, and the missing font made buttons render at ~13px.
// The report flow itself uses .report-btn (reporting.css), which matches this
// and adds hover, focus-visible and a disabled state that is not opacity alone.
export const primaryButtonStyle: React.CSSProperties = {
  background: "#8ae0b7",
  color: "#09231a",
  border: "1px solid transparent",
  padding: "0.8rem 1.4rem",
  minHeight: 44,
  borderRadius: 999,
  font: "inherit",
  fontSize: "1rem",
  fontWeight: 700,
  cursor: "pointer",
};

export const cardStyle: React.CSSProperties = {
  marginTop: "2.5rem",
  padding: "clamp(1rem, 4vw, 1.5rem)",
  border: "1px solid rgba(255,255,255,0.14)",
  borderRadius: 16,
  background: "rgba(255,255,255,0.04)",
};

export const errorStyle: React.CSSProperties = {
  color: "#fecaca",
  background: "rgba(239, 68, 68, 0.12)",
  border: "1px solid rgba(248, 113, 113, 0.35)",
  borderRadius: 10,
  padding: "0.75rem 0.9rem",
  marginBottom: 0,
  marginTop: "0.75rem",
};
