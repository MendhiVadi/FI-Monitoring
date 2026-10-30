// Staff access levels (contract.staffAccess), lowest first. Kept free of
// Firebase imports so the ordering can be unit-tested on its own.
export const STAFF_ACCESS = ["viewer", "officer", "admin"] as const;
export type StaffAccess = typeof STAFF_ACCESS[number];

// A missing field means an account allow-listed before access levels existed,
// which were all full officers. Any other unrecognised value (a typo, null)
// gets the least privilege, matching `firestore.rules`, which only lets a
// missing, "officer" or "admin" value read raw case data.
export function normalizeAccess(value: unknown): StaffAccess {
  if (value === undefined) return "officer";
  return (STAFF_ACCESS as readonly unknown[]).includes(value) ? value as StaffAccess : "viewer";
}

export function hasAccess(access: StaffAccess, min: StaffAccess): boolean {
  return STAFF_ACCESS.indexOf(access) >= STAFF_ACCESS.indexOf(min);
}

// Firebase Auth uids (and so `officers/{uid}` ids): no slashes, bounded length.
export const validStaffUid = (value: unknown): value is string => typeof value === "string" && /^[A-Za-z0-9_.:@-]{1,128}$/.test(value);
