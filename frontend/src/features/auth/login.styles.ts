import type React from "react";

export const inputStyle: React.CSSProperties = {
  width: "100%",
  boxSizing: "border-box",
  padding: "0.75rem 1rem",
  background: "rgba(15, 23, 42, 0.75)",
  border: "1px solid rgba(255, 255, 255, 0.12)",
  borderRadius: 8,
  color: "#ffffff",
  fontSize: "0.92rem",
  outline: "none",
  transition: "border-color 0.2s, box-shadow 0.2s",
};

export const submitBtnStyle: React.CSSProperties = {
  padding: "0.85rem 1.5rem",
  borderRadius: 8,
  background: "linear-gradient(135deg, #10b981, #059669)",
  border: "1px solid rgba(123, 216, 159, 0.3)",
  color: "#ffffff",
  fontWeight: 600,
  fontSize: "0.95rem",
  cursor: "pointer",
  boxShadow: "0 4px 14px rgba(16, 185, 129, 0.35)",
  transition: "transform 0.15s, box-shadow 0.15s",
};

export const iconBtnStyle: React.CSSProperties = {
  background: "rgba(255, 255, 255, 0.05)",
  border: "1px solid rgba(255, 255, 255, 0.12)",
  borderRadius: 6,
  padding: "0.25rem 0.55rem",
  color: "rgba(255, 255, 255, 0.75)",
  fontSize: "0.74rem",
  cursor: "pointer",
};
