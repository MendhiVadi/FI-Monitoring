// Milliseconds from the date shapes a ticket can hold: a number (ms), a
// Firestore Timestamp, its wire form `{ seconds, nanoseconds }`, or a Date.
// Anything else (missing, a pending server timestamp, garbage) is null.
export function toMillis(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (value instanceof Date) return Number.isFinite(value.getTime()) ? value.getTime() : null;
  if (value && typeof value === "object") {
    const date = value as { toMillis?: unknown; seconds?: unknown; nanoseconds?: unknown };
    if (typeof date.toMillis === "function") {
      const ms = (date.toMillis as () => unknown)();
      return typeof ms === "number" && Number.isFinite(ms) ? ms : null;
    }
    if (typeof date.seconds === "number" && Number.isFinite(date.seconds)) {
      const nanos = typeof date.nanoseconds === "number" && Number.isFinite(date.nanoseconds) ? date.nanoseconds : 0;
      return date.seconds * 1000 + Math.floor(nanos / 1e6);
    }
  }
  return null;
}
