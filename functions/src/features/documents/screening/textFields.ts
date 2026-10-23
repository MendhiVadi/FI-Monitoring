import { isValidAadhaar, isValidPan } from "./idNumbers";

// Identifiers and dates found in OCR or PDF text. Only numbers that pass their
// format and check-digit rules are kept, so OCR noise rarely produces matches.
export function digitsOnly(text: string): string { return text.replace(/\D/g, ""); }

export function extractIdentifiers(text: string): { aadhaarNumbers: string[]; maskedLast4: string[]; panNumbers: string[]; dates: string[]; dobs: string[] } {
  const aadhaar = new Set<string>(), masked = new Set<string>(), pan = new Set<string>(), dates = new Set<string>(), dobs = new Set<string>();
  // A 16-digit VID ("9134 5678 9012 3456") is printed beside the number; its
  // first or last 12 digits must not pass as a second Aadhaar number.
  for (const match of text.matchAll(/(?<!\d)(?<!\d{4}[ -])([2-9]\d{3})[ -]?(\d{4})[ -]?(\d{4})(?!\d)(?![ -]\d{4}(?!\d))/g)) {
    const value = match[1] + match[2] + match[3];
    if (isValidAadhaar(value)) aadhaar.add(value);
  }
  for (const match of text.matchAll(/[X*x]{4}[ -]?[X*x]{4}[ -]?(\d{4})(?!\d)/g)) masked.add(match[1]);
  for (const match of text.toUpperCase().matchAll(/(?<![A-Z0-9])([A-Z]{5}\d{4}[A-Z])(?![A-Z0-9])/g)) if (isValidPan(match[1])) pan.add(match[1]);
  for (const match of text.matchAll(/(?<!\d)(\d{2})[/.-](\d{2})[/.-](\d{4})(?!\d)/g)) dates.add(`${match[1]}/${match[2]}/${match[3]}`);
  for (const match of text.matchAll(/(?:DOB|Date of Birth|Birth)\s*[:-]?\s*(\d{2})[/.-](\d{2})[/.-](\d{4})/gi)) dobs.add(`${match[1]}/${match[2]}/${match[3]}`);
  for (const match of text.matchAll(/Year of Birth\s*[:-]?\s*(\d{4})/gi)) dobs.add(match[1]);
  return { aadhaarNumbers: [...aadhaar], maskedLast4: [...masked], panNumbers: [...pan], dates: [...dates], dobs: [...dobs] };
}
