// Pure date and grouping helpers for `getInsights`, unit-tested in
// tests/test-cases.cjs.
export const DAY_MS = 86_400_000;
export const WEEK_MS = 7 * DAY_MS;
// India Standard Time has no daylight saving, so a fixed offset is exact.
export const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;

// Monday 00:00 IST of the week containing `ms`, as epoch milliseconds.
export function weekStartIst(ms: number): number {
  const istDay = Math.floor((ms + IST_OFFSET_MS) / DAY_MS);
  // 1970-01-01 was a Thursday: (day + 3) % 7 is 0 on Mondays.
  const monday = istDay - ((istDay % 7) + 7 + 3) % 7;
  return monday * DAY_MS - IST_OFFSET_MS;
}

// The last `count` week starts, oldest first, ending with the current week.
export function recentWeekStarts(now: number, count = 12): number[] {
  const current = weekStartIst(now);
  return Array.from({ length: count }, (_, index) => current - (count - 1 - index) * WEEK_MS);
}

// Open-case ageing from "created before now − N days" counts.
export function ageingBuckets(openTotal: number, olderThan7: number, olderThan30: number, olderThan90: number) {
  const clamp = (value: number) => Math.max(0, value);
  return { d0_7: clamp(openTotal - olderThan7), d8_30: clamp(olderThan7 - olderThan30),
    d31_90: clamp(olderThan30 - olderThan90), d90p: clamp(olderThan90) };
}

// Top `top` states by count; the rest, and any state with fewer than
// `minCount` cases (small counts can point to one household), are folded
// into "Other". States with no cases are left out.
export function foldStates(counts: { state: string; count: number }[], top = 10, minCount = 3): { state: string; count: number }[] {
  const ranked = counts.filter(entry => entry.count > 0)
    .sort((a, b) => b.count - a.count || a.state.localeCompare(b.state));
  const shown = ranked.filter(entry => entry.count >= minCount).slice(0, top);
  const other = ranked.filter(entry => !shown.includes(entry)).reduce((sum, entry) => sum + entry.count, 0);
  return other > 0 ? [...shown, { state: "Other", count: other }] : shown;
}

// Party types grouped by the case type they map to (contract
// documents.caseTypeByPartyType), so each case type is one `in` count.
export function partyTypesByCaseType(mapping: Record<string, string>, caseTypes: readonly string[]): Record<string, string[]> {
  const groups: Record<string, string[]> = Object.fromEntries(caseTypes.map(caseType => [caseType, []]));
  for (const [partyType, caseType] of Object.entries(mapping)) {
    if (Object.prototype.hasOwnProperty.call(groups, caseType)) groups[caseType].push(partyType);
  }
  return groups;
}

// A cached snapshot is served while it is younger than `ttlMs`; a record from
// the future (clock skew, a bad write) or without its payload is recomputed.
export function freshCache<T>(record: { generatedAt?: unknown; insights?: unknown } | undefined, now: number, ttlMs: number): T | null {
  const at = record?.generatedAt;
  if (typeof at !== "number" || !Number.isFinite(at) || at > now + 60_000 || now - at >= ttlMs) return null;
  return record!.insights && typeof record!.insights === "object" ? record!.insights as T : null;
}
