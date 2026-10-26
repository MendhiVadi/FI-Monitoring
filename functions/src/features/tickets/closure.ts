import { RETENTION_MS } from "../documents/rules";
import { TERMINAL_STATUSES } from "./status";

// What a status change does to the retention clock: closing starts it,
// reopening clears it, and moving between closed states keeps the original
// closing time. Returns null when nothing changes.
export function closureUpdate(before: unknown, after: string, closedAt: unknown, now: number): { closedAt: number | null; purgeAt: number | null } | null {
  const wasClosed = TERMINAL_STATUSES.includes(String(before)), isClosed = TERMINAL_STATUSES.includes(after);
  if (isClosed) {
    if (wasClosed && typeof closedAt === "number") return null;
    return { closedAt: now, purgeAt: now + RETENTION_MS };
  }
  return wasClosed || closedAt != null ? { closedAt: null, purgeAt: null } : null;
}
