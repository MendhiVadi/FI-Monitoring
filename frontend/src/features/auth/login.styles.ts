import type React from "react";

// Focus rings, hover states and narrow-screen spacing live in ./login.css,
// because inline styles cannot express :focus-visible or media queries.
export const inputStyle: React.CSSProperties = {
  width: "100%",
  boxSizing: "border-box",
  minHeight: 44,
  padding: "0.75rem 1rem",
  background: "rgba(15, 23, 42, 0.75)",
  border: "1px solid rgba(255, 255, 255, 0.12)",
  borderRadius: 8,
  color: "#ffffff",
  fontSize: "1rem",
  transition: "border-color 0.2s, box-shadow 0.2s",
};

// The full `border` shorthand, not borderColor: React clears a removed longhand
// without re-applying inputStyle's unchanged shorthand, so clearing an error
// would leave the field with a bright currentColor border.
export const invalidInputStyle: React.CSSProperties = {
  border: "1px solid #f87171",
};

export const submitBtnStyle: React.CSSProperties = {
  minHeight: 48,
  padding: "0.85rem 1.5rem",
  borderRadius: 8,
  // Mint with dark text (10.6:1); the old emerald gradient with white text was 2.5:1.
  background: "#8ae0b7",
  border: "1px solid #8ae0b7",
  color: "#09231a",
  fontWeight: 600,
  fontSize: "0.95rem",
  cursor: "pointer",
  boxShadow: "0 4px 14px rgba(16, 185, 129, 0.35)",
  transition: "transform 0.15s, box-shadow 0.15s",
};

export const iconBtnStyle: React.CSSProperties = {
  minHeight: 44,
  minWidth: 44,
  background: "rgba(255, 255, 255, 0.05)",
  border: "1px solid rgba(255, 255, 255, 0.12)",
  borderRadius: 6,
  padding: "0.5rem 0.75rem",
  color: "rgba(255, 255, 255, 0.85)",
  fontSize: "0.82rem",
  cursor: "pointer",
};

export const secondaryBtnStyle: React.CSSProperties = {
  minHeight: 44,
  background: "rgba(255, 255, 255, 0.08)",
  border: "1px solid rgba(255, 255, 255, 0.2)",
  borderRadius: 6,
  padding: "0.5rem 1rem",
  color: "rgba(255, 255, 255, 0.9)",
  fontSize: "0.88rem",
  cursor: "pointer",
};

export const fieldErrorStyle: React.CSSProperties = {
  margin: "0.4rem 0 0",
  color: "#fca5a5",
  fontSize: "0.84rem",
};

export const hintStyle: React.CSSProperties = {
  margin: "0.4rem 0 0",
  color: "#94a3b8",
  fontSize: "0.8rem",
};
