import { TICKET_STATUSES } from "../tickets/status";
import { storedOverdue } from "./targets";
import { toMillis } from "./time";

// What a read-only "viewer" may see of a case (Wave 2 spec §1). Viewers have
// no raw Firestore reads; `getMaskedCase` and `listTickets` send them only
// these projections. Pure functions, unit-tested in tests/test-cases.cjs.

export const REDACTED = "•••";
const EMAIL = /[\p{L}\p{N}._%+-]+@[\p{L}\p{N}-]+(?:\.[\p{L}\p{N}-]+)+/gu;
// Ten or more digits with optional single separators: phone numbers in any
// common format and 12-digit (Aadhaar-style) numbers, spaced or not.
const LONG_NUMBER = /\+?\d(?:[\s().-]?\d){9,}/g;
const PAN = /\b[A-Z]{5}\d{4}[A-Z]\b/gi;
// \p{M} keeps Indic vowel signs inside their word ("कुमार" is one token, not five).
const NAME_TOKEN = /[\p{L}\p{M}\p{N}]+/gu;
const NOT_AFTER_WORD = "(?<![\\p{L}\\p{M}\\p{N}])", NOT_BEFORE_WORD = "(?![\\p{L}\\p{M}\\p{N}])";

// "Asha Rani Rao" → "A. R. R."; empty or missing → "".
export function initials(name: unknown): string {
  if (typeof name !== "string") return "";
  const tokens = name.match(NAME_TOKEN) ?? [];
  return tokens.slice(0, 4).map(token => Array.from(token)[0].toLocaleUpperCase("en-IN") + ".").join(" ");
}

// "+919876543210" → "+91•••••3210"; other numbers keep only the last four digits.
export function maskPhone(phone: unknown): string | null {
  if (typeof phone !== "string") return null;
  const digits = phone.replace(/\D/g, "");
  if (digits.length < 4) return null;
  const last4 = digits.slice(-4);
  if (/^\+91\d{10}$/.test(phone.trim())) return "+91•••••" + last4;
  return (phone.trim().startsWith("+") ? "+" : "") + "•••••" + last4;
}

const escapeRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
function nameReplacements(names: unknown[]): [RegExp, string][] {
  const rules: [RegExp, string][] = [];
  const tokens = new Map<string, string>();
  for (const name of names) {
    if (typeof name !== "string" || !name.trim()) continue;
    const full = name.trim();
    rules.push([new RegExp(NOT_AFTER_WORD + escapeRegExp(full) + NOT_BEFORE_WORD, "giu"), initials(full)]);
    // Each part of a name on its own ("Rao" later in the text); short parts
    // ("A", "of") are left alone so ordinary words survive.
    for (const token of full.match(NAME_TOKEN) ?? []) {
      if (Array.from(token).length >= 3) tokens.set(token.toLocaleLowerCase("en-IN"), initials(token));
    }
  }
  for (const [token, replacement] of tokens) {
    rules.push([new RegExp(NOT_AFTER_WORD + escapeRegExp(token) + NOT_BEFORE_WORD, "giu"), replacement]);
  }
  return rules;
}

// Free text for viewers: emails, phone numbers, 12-digit and PAN-style numbers
// become "•••"; the case's party names become initials.
export function redactText(text: unknown, names: unknown[] = []): string {
  if (typeof text !== "string") return "";
  let out = text.replace(EMAIL, REDACTED).replace(LONG_NUMBER, REDACTED).replace(PAN, REDACTED);
  for (const [pattern, replacement] of nameReplacements(names)) out = out.replace(pattern, replacement);
  return out;
}

export function roundLocation(location: unknown): { latitude: number; longitude: number } | null {
  const point = location as { latitude?: unknown; longitude?: unknown } | null | undefined;
  if (!point || typeof point.latitude !== "number" || typeof point.longitude !== "number" ||
      !Number.isFinite(point.latitude) || !Number.isFinite(point.longitude)) return null;
  const round = (value: number) => Math.round(value * 100) / 100;
  return { latitude: round(point.latitude), longitude: round(point.longitude) };
}

const text = (value: unknown, max = 200) => typeof value === "string" ? value.slice(0, max) : "";
const partyNames = (data: Record<string, any>) => [data.dispute?.reporterName, data.dispute?.otherPartyName];
const isAssigned = (assignedTo: unknown) => typeof assignedTo === "string" && assignedTo !== "";

// The stored subject is cut at 160 characters, which can split a name where
// redactText no longer matches it, so viewers get it rebuilt from its parts.
function maskedSubject(subject: unknown, dispute: Record<string, any> | null | undefined, names: unknown[]): string {
  const type = dispute?.disputeType, reporter = initials(dispute?.reporterName), other = initials(dispute?.otherPartyName);
  if (typeof type === "string" && type && reporter && other) return `${type.slice(0, 80)} — ${reporter} vs ${other}`;
  return redactText(subject, names);
}

export function statusLabel(status: unknown, stored?: unknown): string {
  if (typeof status === "string" && Object.prototype.hasOwnProperty.call(TICKET_STATUSES, status)) return TICKET_STATUSES[status as keyof typeof TICKET_STATUSES];
  return typeof stored === "string" ? stored : String(status ?? "");
}

export function documentsSummary(value: unknown) {
  const summary = value as { caseType?: unknown; count?: unknown; kinds?: unknown; flagged?: unknown } | null | undefined;
  if (!summary || typeof summary !== "object") return null;
  return { caseType: text(summary.caseType, 80), count: Number(summary.count) || 0,
    kinds: Array.isArray(summary.kinds) ? summary.kinds.filter((kind): kind is string => typeof kind === "string").slice(0, 40) : [],
    flagged: Number(summary.flagged) || 0 };
}

// getMaskedCase → ticket.
export function maskedTicket(id: string, data: Record<string, any>) {
  const dispute = data.dispute ?? {}, names = partyNames(data);
  return {
    id, status: String(data.status ?? ""), statusLabel: statusLabel(data.status, data.statusLabel),
    subject: maskedSubject(data.subject, dispute, names),
    dispute: {
      reporterType: text(dispute.reporterType, 80), otherPartyType: text(dispute.otherPartyType, 80),
      disputeType: text(dispute.disputeType, 80), state: text(dispute.state, 80), district: text(dispute.district, 80),
      village: text(dispute.village, 120), description: redactText(dispute.description, names),
      location: roundLocation(dispute.location),
      immediateRisk: dispute.immediateRisk === "yes" || dispute.immediateRisk === "no" ? dispute.immediateRisk : "unknown",
    },
    reporterName: initials(dispute.reporterName), otherPartyName: initials(dispute.otherPartyName),
    phone: maskPhone(data.waFrom),
    createdAt: toMillis(data.createdAt), updatedAt: toMillis(data.updatedAt),
    // Viewers see names as initials, staff included; `assigned` still says a
    // case is taken when the assignee has no display name.
    assignedName: initials(data.assignedName) || null, assigned: isAssigned(data.assignedTo),
    overdue: storedOverdue(data.overdue),
    documents: documentsSummary(data.documents),
  };
}

// listTickets for a viewer: the registry projection with the same masking.
// Staff identifiers (assignee uid/email, last editor) and the reporter key
// (a hash of their phone) are dropped; the assignee's name becomes initials
// and `assigned` says whether anyone has the case.
export function maskedListTicket<T extends Record<string, any>>(ticket: T): T {
  const names = partyNames(ticket);
  const { assignedTo, assignedEmail: _assignedEmail, assignedName, lastUpdatedBy: _lastUpdatedBy, notificationPhone: _phone,
    reporterUid: _reporterUid, ...rest } = ticket;
  const dispute = ticket.dispute && typeof ticket.dispute === "object"
    ? { ...ticket.dispute, reporterName: initials(ticket.dispute.reporterName), otherPartyName: initials(ticket.dispute.otherPartyName),
      ...("description" in ticket.dispute ? { description: redactText(ticket.dispute.description, names) } : {}),
      ...("location" in ticket.dispute ? { location: roundLocation(ticket.dispute.location) } : {}) }
    : ticket.dispute;
  return { ...rest, subject: maskedSubject(ticket.subject, ticket.dispute, names), waFrom: maskPhone(ticket.waFrom) ?? "", dispute,
    // Older projections without assignment fields stay without them.
    ...(assignedName !== undefined || assignedTo !== undefined ? { assignedName: initials(assignedName) || null, assigned: isAssigned(assignedTo) } : {}),
  } as unknown as T;
}

// Staff appear to viewers by role label only (never a name, email or uid);
// legacy entries without a stored role read "Staff". Escalations the hourly
// job wrote read "System", replacements "Reporter".
export function actorLabel(entry: Record<string, any>): string | null {
  if (typeof entry.officerUid === "string" || typeof entry.actorUid === "string") {
    // Older document reviews name the role as actorRole.
    const role = [entry.officerRole, entry.actorRole].find(value => typeof value === "string" && value.trim());
    return typeof role === "string" ? role.trim().slice(0, 80) : "Staff";
  }
  if (entry.type === "escalation") return "System";
  if (entry.type === "document_replaced") return "Reporter";
  return null;
}

const EVENT_FIELDS = ["kind", "type", "before", "after", "decision", "overdue", "documentId", "noteId", "requestId", "revision"] as const;
export function maskedEvent(id: string, entry: Record<string, any>, names: unknown[]) {
  const out: Record<string, unknown> = { id };
  for (const key of EVENT_FIELDS) {
    const value = entry[key];
    if (typeof value === "string" || typeof value === "number" || value === null) out[key] = typeof value === "string" ? value.slice(0, 120) : value;
  }
  if (typeof entry.reason === "string") out.reason = redactText(entry.reason, names);
  // Whether someone was assigned, and their initials (as on the masked ticket);
  // never the assignee's uid or email.
  if (entry.type === "assignment") { out.assigned = isAssigned(entry.to); out.toName = initials(entry.toName) || null; }
  out.actor = actorLabel(entry);
  out.at = toMillis(entry.at);
  return out;
}

export function maskedNote(id: string, entry: Record<string, any>, names: unknown[]) {
  return { id, text: redactText(entry.text, names), actor: actorLabel(entry), at: toMillis(entry.at) };
}

// No files, ID numbers or extracted fields: kind, side, risk and the staff
// summary line (which names checks, never values) plus the review decision.
export function maskedDocument(id: string, entry: Record<string, any>, names: unknown[]) {
  const review = entry.review && typeof entry.review === "object" && typeof entry.review.decision === "string"
    ? { decision: entry.review.decision, at: toMillis(entry.review.at) } : null;
  const risk = entry.screening?.risk;
  return { id, kind: text(entry.kind, 80), side: entry.side === "other_party" ? "other_party" : "reporter",
    risk: risk === "low" || risk === "medium" || risk === "high" || risk === "altered" ? risk : null,
    summary: redactText(entry.screening?.summary, names).slice(0, 300), review };
}

export { partyNames };
