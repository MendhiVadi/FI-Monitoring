import { useEffect, useState } from "react";

// Mirrors functions/src/features/otp/service.ts (OTP_TTL_MS, VERIFIED_WINDOW_MS).
// These only drive what the reporter is shown; the server still decides.
export const OTP_TTL_MS = 5 * 60 * 1000;
// The proof's clock starts on the server before the response reaches us, so
// the client treats it as expiring a little early rather than a little late.
export const VERIFIED_WINDOW_MS = 15 * 60 * 1000 - 30 * 1000;
export const VERIFY_WARN_MS = 3 * 60 * 1000;

/** Milliseconds left until `deadline` (null when there is none). Sleeps until
 *  the last `tickWithinMs`, then re-renders once a second until it reaches 0. */
export function useRemaining(deadline: number | null, tickWithinMs = Infinity): number | null {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (deadline === null) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const tick = () => {
      const t = Date.now();
      setNow(t);
      const left = deadline - t;
      if (left <= 0) return;
      timer = setTimeout(tick, left > tickWithinMs ? left - tickWithinMs : left % 1000 || 1000);
    };
    timer = setTimeout(tick, 0);
    return () => clearTimeout(timer);
  }, [deadline, tickWithinMs]);
  return deadline === null ? null : Math.max(0, deadline - now);
}

export function formatClock(ms: number): string {
  const total = Math.ceil(ms / 1000);
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
}

/** Whole minutes for screen-reader text, so a live region is not re-read every second. */
export function spokenMinutes(ms: number): string {
  const minutes = Math.max(1, Math.ceil(ms / 60_000));
  return `${minutes} minute${minutes === 1 ? "" : "s"}`;
}
