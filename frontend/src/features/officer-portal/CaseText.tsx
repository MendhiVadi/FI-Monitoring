import { formatEventTime, relativeTime } from "./presentation";

// Missing values are shown as missing — never replaced by a plausible-looking
// default that staff could mistake for something the reporter supplied.
export function NotProvided({ label = "Not provided" }: { label?: string }) {
  return <span style={{ color: "#94a3b8", fontStyle: "italic", fontWeight: 400 }}>{label}</span>;
}

// Relative time first; the exact IST time stays visible (and in print).
export function EventTime({ at }: { at: { seconds: number } | undefined }) {
  if (!at || !Number.isFinite(at.seconds)) return <span>Just now</span>;
  const date = new Date(at.seconds * 1000), absolute = formatEventTime(at);
  return (
    <time dateTime={date.toISOString()} title={absolute}>
      {relativeTime(date.getTime())} <span style={{ opacity: 0.75 }}>({absolute})</span>
    </time>
  );
}
