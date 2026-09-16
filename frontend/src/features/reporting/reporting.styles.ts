import type React from "react";

export const inputStyle: React.CSSProperties = {
  width: "100%",
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

export const primaryButtonStyle: React.CSSProperties = {
  background: "#2f9e64",
  color: "white",
  border: "none",
  padding: "0.8rem 1.4rem",
  borderRadius: 999,
  fontWeight: 700,
  cursor: "pointer",
};

export const cardStyle: React.CSSProperties = {
  marginTop: "2.5rem",
  padding: "1.5rem",
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
