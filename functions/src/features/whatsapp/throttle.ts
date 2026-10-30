// Per-destination ceiling for case notifications (OTP codes are sent by the
// OTP flow and never pass through here). The record lives in the server-only
// `notificationLimits/{hashId(phone)}` collection and is charged inside the
// delivery transaction, so concurrent triggers for one phone cannot overshoot.
export const NOTIFICATIONS_PER_HOUR = 6;
export const NOTIFICATIONS_PER_DAY = 20;
const HOUR_MS = 3_600_000;
const DAY_MS = 86_400_000;
// Tolerates small clock differences between instances; anything further in
// the future is not a real send time and is dropped.
const CLOCK_SKEW_MS = 60_000;

export interface NotificationLimit { sentAt: number[]; expiresAt: number }

// Rolling windows: the last hour and the last 24 hours before `now`. Returns
// the record to store after charging one send, or null when either window is
// full (the caller records the delivery as throttled and sends nothing).
export function chargeNotificationLimit(previous: { sentAt?: unknown } | undefined, now: number): NotificationLimit | null {
  const recent = (Array.isArray(previous?.sentAt) ? previous!.sentAt : [])
    .filter((at): at is number => typeof at === "number" && Number.isFinite(at) && at > now - DAY_MS && at <= now + CLOCK_SKEW_MS);
  const lastHour = recent.filter(at => at > now - HOUR_MS).length;
  if (lastHour >= NOTIFICATIONS_PER_HOUR || recent.length >= NOTIFICATIONS_PER_DAY) return null;
  const sentAt = [...recent, now].sort((a, b) => a - b).slice(-NOTIFICATIONS_PER_DAY);
  // Nothing in the record matters once its newest send is a day old; the
  // hourly cleanup can delete it from then on.
  return { sentAt, expiresAt: sentAt[sentAt.length - 1] + DAY_MS };
}
