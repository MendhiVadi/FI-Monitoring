// Verhoeff tables: UIDAI makes the 12th Aadhaar digit a Verhoeff check digit,
// which catches every single-digit typo and adjacent transposition.
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
  let check = 0;
  const reversed = digits.split("").reverse();
  for (let i = 0; i < reversed.length; i++) check = D[check][P[i % 8][Number(reversed[i])]];
  return check === 0;
}

export function isValidAadhaar(v: string): boolean {
  const digits = normaliseIdNumber("aadhaar", v);
  return /^[2-9]\d{11}$/.test(digits) && verhoeffValid(digits);
}

// 4th character is the holder type: P person, C company, H HUF, F firm, A AOP,
// T trust, B BOI, L local authority, J artificial juridical person, G government.
export const PAN_HOLDER_TYPES = "ABCFGHJLPT";

export function isValidPan(v: string): boolean {
  return new RegExp(`^[A-Z]{3}[${PAN_HOLDER_TYPES}][A-Z]\\d{4}[A-Z]$`).test(normaliseIdNumber("pan", v));
}

export function normaliseIdNumber(kind: string, v: string): string {
  const value = String(v ?? "");
  if (kind === "aadhaar") return value.replace(/\D/g, "");
  return value.toUpperCase().replace(/[^A-Z0-9]/g, "");
}

export function maskIdNumber(kind: string, v: string): string {
  const value = normaliseIdNumber(kind, v);
  if (kind === "aadhaar") return `XXXX XXXX ${value.slice(-4).padStart(4, "X")}`;
  if (kind === "pan" && value.length === 10) return `${value.slice(0, 5)}****${value.slice(-1)}`;
  return value.length <= 4 ? "X".repeat(value.length) : "X".repeat(value.length - 4) + value.slice(-4);
}

// Only Latin combining accents are stripped: Indic vowel signs are combining
// marks too, and removing them would change the name.
export function normaliseName(v: string): string {
  return String(v ?? "")
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{M}\p{N}]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function editDistance(a: string, b: string): number {
  const row = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let previous = row[0];
    row[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const saved = row[j];
      row[j] = Math.min(row[j] + 1, row[j - 1] + 1, previous + (a[i - 1] === b[j - 1] ? 0 : 1));
      previous = saved;
    }
  }
  return row[b.length];
}

function tokenSimilar(a: string, b: string, candidateInitials: boolean): boolean {
  if (a === b) return true;
  // Initials ("R Kumar" vs "Ramesh Kumar") count as a match.
  if (a.length === 1) return a[0] === b[0];
  if (b.length === 1) return candidateInitials && a[0] === b[0];
  // The edit distance is at least the length gap, so skip hopeless pairs.
  const longest = Math.max(a.length, b.length);
  if (Math.abs(a.length - b.length) > longest * 0.25) return false;
  return 1 - editDistance(a, b) / longest >= 0.75;
}

// Bounds the synchronous work when the candidate is a page of PDF or OCR text.
const MAX_NAME_TOKENS = 12;
const MAX_POOL_TOKENS = 6000;
// Larger candidates are free text, where stray OCR letters must not pass as initials.
const NAME_SIZED_POOL = 6;

// Share of the expected name's tokens found (fuzzily) among the candidate's
// tokens; word order is ignored because surname-first spellings are common.
export function nameMatchScore(expected: string, candidate: string): number {
  const wanted = normaliseName(expected).split(" ").filter(Boolean).slice(0, MAX_NAME_TOKENS);
  const pool = normaliseName(candidate).split(" ").filter(Boolean).slice(0, MAX_POOL_TOKENS);
  if (!wanted.length || !pool.length) return 0;
  const candidateInitials = pool.length <= NAME_SIZED_POOL;
  const used = new Set<number>();
  let matched = 0;
  for (const token of wanted) {
    const index = pool.findIndex((other, i) => !used.has(i) && tokenSimilar(token, other, candidateInitials));
    if (index >= 0) {
      used.add(index);
      matched += 1;
    }
  }
  return matched / wanted.length;
}

export function surnameInitial(name: string): string | null {
  const tokens = normaliseName(name).split(" ").filter(token => /^[a-z]/.test(token));
  return tokens.length ? tokens[tokens.length - 1][0].toUpperCase() : null;
}
