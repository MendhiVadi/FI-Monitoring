// Client-side shape checks for the ID numbers typed next to an upload. They
// catch typos before a file is sent; the server repeats them and compares the
// number with the card, so these never decide anything on their own.

// Verhoeff dihedral-group tables (UIDAI uses this for the Aadhaar check digit).
const D = [
  [0, 1, 2, 3, 4, 5, 6, 7, 8, 9], [1, 2, 3, 4, 0, 6, 7, 8, 9, 5], [2, 3, 4, 0, 1, 7, 8, 9, 5, 6],
  [3, 4, 0, 1, 2, 8, 9, 5, 6, 7], [4, 0, 1, 2, 3, 9, 5, 6, 7, 8], [5, 9, 8, 7, 6, 0, 4, 3, 2, 1],
  [6, 5, 9, 8, 7, 1, 0, 4, 3, 2], [7, 6, 5, 9, 8, 2, 1, 0, 4, 3], [8, 7, 6, 5, 9, 3, 2, 1, 0, 4],
  [9, 8, 7, 6, 5, 4, 3, 2, 1, 0],
];
const P = [
  [0, 1, 2, 3, 4, 5, 6, 7, 8, 9], [1, 5, 7, 6, 2, 8, 3, 0, 9, 4], [5, 8, 0, 3, 7, 9, 6, 1, 4, 2],
  [8, 9, 1, 6, 0, 4, 3, 5, 2, 7], [9, 4, 5, 3, 1, 2, 6, 8, 7, 0], [4, 2, 8, 6, 5, 7, 3, 9, 0, 1],
  [2, 7, 9, 3, 8, 0, 6, 4, 1, 5], [7, 0, 4, 6, 9, 1, 3, 2, 5, 8],
];

export function verhoeffValid(digits: string): boolean {
  if (!/^\d+$/.test(digits)) return false;
  let c = 0;
  for (let i = 0; i < digits.length; i++) c = D[c][P[i % 8][Number(digits[digits.length - 1 - i])]];
  return c === 0;
}

export type IdNumberKind = "aadhaar" | "pan";

/** What the server receives: digits only for Aadhaar, upper case for PAN. */
export function normaliseIdNumber(kind: IdNumberKind, value: string): string {
  return kind === "aadhaar" ? value.replace(/\D/g, "").slice(0, 12) : value.replace(/[^a-z0-9]/gi, "").toUpperCase().slice(0, 10);
}

/** Aadhaar shown as 4-4-4, the way it is printed on the card. */
export function formatIdNumber(kind: IdNumberKind, value: string): string {
  const clean = normaliseIdNumber(kind, value);
  return kind === "aadhaar" ? clean.replace(/(\d{4})(?=\d)/g, "$1 ") : clean;
}

/** A reporter-facing problem with the typed number, or null when it is blank or well formed. */
export function idNumberError(kind: IdNumberKind, value: string): string | null {
  const clean = normaliseIdNumber(kind, value);
  if (!clean) return null;
  if (kind === "pan") {
    return /^[A-Z]{5}\d{4}[A-Z]$/.test(clean) ? null : "Enter the 10-character PAN as printed, for example ABCDE1234F.";
  }
  if (clean.length !== 12) return "An Aadhaar number has 12 digits.";
  if (!/^[2-9]/.test(clean)) return "An Aadhaar number does not start with 0 or 1. Check the digits on your card.";
  return verhoeffValid(clean) ? null : "This Aadhaar number does not pass the check-digit test. Check the digits on your card.";
}
