// Full government-portal-style timestamp, e.g. "Fri, 05 Sep 2026, 03:45:12 PM".
// The time zone is pinned to IST because both callers label the output "IST";
// without it the clock rendered the viewer's local time under an IST label,
// which misdates every action for an officer working outside India.
export function formatGovClock(date: Date): string {
  return date.toLocaleDateString("en-IN", {
    timeZone: "Asia/Kolkata",
    weekday: "short",
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: true,
  });
}
