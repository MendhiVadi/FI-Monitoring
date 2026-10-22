// The small ring used on the sign-in button and the staff-session check, so
// both loading states look the same. Decorative: callers supply the text.
export function Spinner({ size = 14, color = "#fff" }: { size?: number; color?: string }) {
  return (
    <span
      aria-hidden="true"
      style={{
        display: "inline-block",
        flex: "none",
        width: size,
        height: size,
        borderRadius: "50%",
        border: `2px solid ${color}`,
        borderTopColor: "transparent",
        animation: "fw-spin 0.8s linear infinite",
      }}
    />
  );
}
