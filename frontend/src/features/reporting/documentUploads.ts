import { useSyncExternalStore } from "react";
import contract from "../../shared/contracts/dispute.json";
import disputeSettings from "../../../dispute-settings.json";
import { callFunction, readableCallableError } from "./callables";
import { getDraftField, updateDraftField } from "./draftStore";
import type { UploadedDocument } from "./types";

const DOCS = contract.documents;
export const MAX_FILE_BYTES = DOCS.maxFileBytes;
export const MAX_FILES = DOCS.maxFiles;
export const PENDING_TTL_MINUTES = DOCS.pendingTtlMinutes;
// Treated as gone a little before the server deletes it, so a submit is not
// sent with a document that lapses on the way.
const EXPIRY_MARGIN_MS = 2 * 60_000;
// The server screens before replying (up to its 120 s timeout), longer than
// the SDK's 70 s default; a client timeout would orphan a stored upload.
const UPLOAD_TIMEOUT_MS = 180_000;
const UNAUTHENTICATED_MESSAGE = "Your phone verification expired. Verify your number again below the form, then select Retry.";

export type DocumentKind = (typeof DOCS.kinds)[number];
export interface CaseType { id: string; label: string; required: DocumentKind[]; optional: DocumentKind[] }

const KINDS = new Map<string, DocumentKind>(DOCS.kinds.map((kind) => [kind.id, kind]));
export const kindById = (id: string) => KINDS.get(id);
/** The upload button's id: the error summary links there. */
export const kindControlId = (kind: string) => `dispute-doc-${kind}`;
export const DOCUMENTS_SECTION_ID = "dispute-documents";

// Own keys only, as on the server: "toString" or "__proto__" would otherwise
// resolve to an inherited member and crash the form's render.
export function caseTypeFor(partyType: string): CaseType {
  const types = DOCS.caseTypes as Record<string, { label: string; required: string[]; optional: string[] }>;
  const mapped = Object.hasOwn(DOCS.caseTypeByPartyType, partyType) ? (DOCS.caseTypeByPartyType as Record<string, string>)[partyType] : "";
  const id = Object.hasOwn(types, mapped) ? mapped : "citizen_vs_government";
  const type = types[id];
  const resolve = (ids: string[]) => ids.flatMap((kind) => KINDS.get(kind) ?? []);
  return { id, label: type.label, required: resolve(type.required), optional: resolve(type.optional) };
}

export function isExpired(doc: UploadedDocument, now = Date.now()) {
  return now >= doc.uploadedAt + PENDING_TTL_MINUTES * 60_000 - EXPIRY_MARGIN_MS;
}

// Extensions too: some Android pickers grey out files the MIME list alone
// does not match, and some browsers leave File.type empty.
const EXTENSION_TYPES: Record<string, string> = { jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", webp: "image/webp", pdf: "application/pdf" };
export const ACCEPT = [...DOCS.acceptedTypes, ...Object.keys(EXTENSION_TYPES).map((ext) => `.${ext}`)].join(",");
// A non-standard MIME such as image/jpg or image/pjpeg also falls back to the
// extension; the server checks the magic bytes either way.
function contentTypeOf(file: File): string | null {
  const type = DOCS.acceptedTypes.includes(file.type) ? file.type : EXTENSION_TYPES[file.name.split(".").pop()?.toLowerCase() ?? ""] ?? "";
  return DOCS.acceptedTypes.includes(type) ? type : null;
}

export function formatSize(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  const mb = bytes / (1024 * 1024);
  return `${mb < 10 ? mb.toFixed(1).replace(/\.0$/, "") : Math.round(mb)} MB`;
}

export type UploadStatus = "queued" | "reading" | "uploading" | "screening" | "error";
export interface UploadItem {
  localId: string;
  submissionId: string;
  kind: string;
  file: File;
  fileName: string;
  sizeBytes: number;
  status: UploadStatus;
  error: string | null;
}
export interface UploadContext {
  submissionId: string;
  phone: string;
  verificationToken: string;
  reporterName: string;
  idNumber?: string;
  onUnauthenticated: () => void;
}

// Module state rather than component state, like the draft: an upload that
// finishes after the reporter navigates away still lands in the draft.
let items: UploadItem[] = [];
let sequence = 0;
let announcement = "";
const contexts = new Map<string, UploadContext>();
const listeners = new Set<() => void>();
const subscribe = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };
const notify = () => listeners.forEach((listener) => listener());
function setItems(next: UploadItem[]) { items = next; notify(); }
function patch(localId: string, change: Partial<UploadItem>) {
  setItems(items.map((item) => item.localId === localId ? { ...item, ...change } : item));
}
function drop(localId: string) {
  contexts.delete(localId);
  setItems(items.filter((item) => item.localId !== localId));
}
function announce(text: string) { announcement = text; notify(); }

const readItems = () => items;
const readAnnouncement = () => announcement;
export const useUploadItems = () => useSyncExternalStore(subscribe, readItems, readItems);
export const useUploadAnnouncement = () => useSyncExternalStore(subscribe, readAnnouncement, readAnnouncement);

const auth = (ctx: Pick<UploadContext, "phone" | "verificationToken">) =>
  disputeSettings.otpRequired ? { phone: ctx.phone, verificationToken: ctx.verificationToken } : {};
const isUnauthenticated = (err: unknown) => (err as { code?: string })?.code === "functions/unauthenticated";
// Proofs the server refused: files still queued with one fail at once instead
// of each sending up to 8 MB over mobile data only to be refused the same way.
const refusedTokens = new Set<string>();
/** For a form mounted after the refusal: its own rejected-token state starts empty. */
export const tokenRefused = (token: string) => refusedTokens.has(token);

/** Files still in this draft or on their way: what counts towards MAX_FILES. */
export function usedSlots(submissionId: string, documents: UploadedDocument[]) {
  return documents.length + items.filter((item) => item.submissionId === submissionId && item.status !== "error").length;
}

/** Required kinds with no usable file, and uploads still running, for the error summary. */
export function documentProblems(caseType: CaseType, documents: UploadedDocument[], pending: UploadItem[], now = Date.now()) {
  const problems: { id: string; kind?: string; message: string }[] = [];
  for (const kind of caseType.required) {
    if (!documents.some((doc) => doc.kind === kind.id && !isExpired(doc, now))) {
      problems.push({ id: kindControlId(kind.id), kind: kind.id, message: `Upload a file for “${kind.label}”.` });
    }
  }
  const busy = pending.filter((item) => item.status !== "error").length;
  if (busy > 0) problems.push({ id: DOCUMENTS_SECTION_ID, message: `Wait for ${busy === 1 ? "1 upload" : `${busy} uploads`} to finish.` });
  return problems;
}

/** Checks and queues files; returns reporter-facing reasons for any not added. */
export function enqueueUploads(kind: string, files: File[], documents: UploadedDocument[], ctx: UploadContext): string[] {
  // Failed files from a cleared draft would otherwise keep their contents in memory.
  for (const item of items) if (item.submissionId !== ctx.submissionId && item.status === "error") drop(item.localId);
  const problems: string[] = [];
  let free = MAX_FILES - usedSlots(ctx.submissionId, documents);
  for (const file of files) {
    const contentType = contentTypeOf(file);
    if (!contentType) { problems.push(`“${file.name}” is not a JPEG, PNG, WebP or PDF file.`); continue; }
    if (file.size > MAX_FILE_BYTES) {
      // A size just over the limit rounds to the limit itself, which would read as allowed.
      const size = formatSize(file.size), limit = formatSize(MAX_FILE_BYTES);
      problems.push(`“${file.name}” is ${size === limit ? `just over ${size}` : size}. Each file must be ${limit} or smaller.`);
      continue;
    }
    if (file.size === 0) { problems.push(`“${file.name}” is empty.`); continue; }
    if (free <= 0) { problems.push(`“${file.name}” was not added: a report can have at most ${MAX_FILES} files. Remove one to add another.`); continue; }
    free -= 1;
    const localId = `upload-${++sequence}`;
    contexts.set(localId, ctx);
    setItems([...items, { localId, submissionId: ctx.submissionId, kind, file, fileName: file.name, sizeBytes: file.size, status: "queued", error: null }]);
    schedule(localId);
  }
  return problems;
}

export function retryUpload(localId: string, documents: UploadedDocument[], ctx: UploadContext): string | null {
  const item = items.find((i) => i.localId === localId);
  if (!item) return null;
  if (usedSlots(ctx.submissionId, documents) >= MAX_FILES) return `A report can have at most ${MAX_FILES} files. Remove one to retry this one.`;
  contexts.set(localId, ctx);
  patch(localId, { status: "queued", error: null });
  schedule(localId);
  return null;
}

export function discardUpload(localId: string) { drop(localId); }

// One file at a time: each is up to 8 MB of base64 and is screened before
// the server replies, so parallel sends only compete for the same link.
let queue: Promise<void> = Promise.resolve();
function schedule(localId: string) { queue = queue.then(() => run(localId)).catch(() => {}); }

async function run(localId: string) {
  const item = items.find((i) => i.localId === localId);
  const ctx = contexts.get(localId);
  if (!item || !ctx || item.status !== "queued") return;
  // The draft was cleared or replaced while this waited.
  if (getDraftField("submissionId") !== item.submissionId) { drop(localId); return; }
  if (disputeSettings.otpRequired && refusedTokens.has(ctx.verificationToken)) {
    patch(localId, { status: "error", error: UNAUTHENTICATED_MESSAGE });
    return;
  }
  patch(localId, { status: "reading" });
  let dataBase64: string;
  try {
    dataBase64 = await readBase64(item.file);
  } catch {
    patch(localId, { status: "error", error: "Couldn't read this file. Choose it again, or try another copy." });
    return;
  }
  // Cancelled, or the draft cleared, while it was being read: a file for a
  // discarded draft is not sent at all.
  if (!items.some((i) => i.localId === localId)) return;
  if (getDraftField("submissionId") !== item.submissionId) { drop(localId); return; }
  patch(localId, { status: "uploading" });
  // A callable reports no transfer progress and the server screens before it
  // replies, so after a rough transfer time the label says it is being checked.
  const checking = setTimeout(() => {
    if (items.find((i) => i.localId === localId)?.status === "uploading") patch(localId, { status: "screening" });
  }, Math.min(20_000, Math.max(1_500, item.sizeBytes / 150)));
  // Taken before sending: the server starts its TTL after the body arrives and
  // screens before replying, so the reply time would overstate what is left.
  const sentAt = Date.now();
  try {
    const result = await callFunction<Record<string, unknown>, { documentId: string; screening?: { userMessages?: unknown } }>("uploadDisputeDocument", {
      submissionId: item.submissionId, ...auth(ctx), kind: item.kind,
      fileName: item.fileName.slice(0, 120), contentType: contentTypeOf(item.file), dataBase64,
      ...(ctx.idNumber ? { idNumber: ctx.idNumber } : {}),
      ...(ctx.reporterName ? { reporterName: ctx.reporterName } : {}),
    }, { timeout: UPLOAD_TIMEOUT_MS });
    const messages = Array.isArray(result.screening?.userMessages) ? result.screening.userMessages : [];
    const doc: UploadedDocument = {
      documentId: result.documentId, kind: item.kind, fileName: item.fileName, sizeBytes: item.sizeBytes, uploadedAt: sentAt,
      userMessages: messages.filter((m): m is string => typeof m === "string" && m.length <= 300).slice(0, 5),
    };
    drop(localId);
    if (getDraftField("submissionId") === item.submissionId) {
      updateDraftField("documents", (docs) => [...docs, doc]);
      announce(`${item.fileName} uploaded.`);
    } else {
      void callFunction("removeDisputeDocument", { submissionId: item.submissionId, ...auth(ctx), documentId: doc.documentId }).catch(() => {});
    }
  } catch (err: unknown) {
    if (isUnauthenticated(err)) { refusedTokens.add(ctx.verificationToken); ctx.onUnauthenticated(); }
    patch(localId, {
      status: "error",
      error: isUnauthenticated(err) ? UNAUTHENTICATED_MESSAGE : readableCallableError(err, "Couldn't upload this file. Try again."),
    });
  } finally {
    clearTimeout(checking);
  }
}

/** Removes an uploaded document; returns a reporter-facing error, or null once it is gone. */
export async function removeDocument(doc: UploadedDocument, ctx: Pick<UploadContext, "submissionId" | "phone" | "verificationToken" | "onUnauthenticated">): Promise<string | null> {
  // Asked even once expired: the daily purge could keep the copy for up to a
  // day more. An expired one is dropped here whatever the reply, since it can
  // no longer be sent and the purge removes it if this call could not.
  const expired = isExpired(doc);
  try {
    await callFunction("removeDisputeDocument", { submissionId: ctx.submissionId, ...auth(ctx), documentId: doc.documentId });
  } catch (err: unknown) {
    const code = (err as { code?: string })?.code;
    if (!expired && isUnauthenticated(err)) {
      refusedTokens.add(ctx.verificationToken);
      ctx.onUnauthenticated();
      return "Your phone verification expired. Verify your number again below the form, then remove this file.";
    }
    if (!expired && code !== "functions/not-found") return readableCallableError(err, "Couldn't remove this file. Try again.");
  }
  updateDraftField("documents", (docs) => docs.filter((d) => d.documentId !== doc.documentId));
  announce(`${doc.fileName} removed.`);
  return null;
}

/** submitDispute rejections about documents, reworded; null for anything else. */
export function documentSubmitError(err: unknown): string | null {
  const { code, message = "" } = (err ?? {}) as { code?: string; message?: string };
  if (!/document|upload|file/i.test(message)) return null;
  if (code === "functions/not-found" || /expired|no longer|not found|deleted|removed/i.test(message)) {
    return `Some uploaded files have expired or are no longer available (uploads not sent with a report expire after ${PENDING_TTL_MINUTES / 60} hours). Remove them in the Documents section, upload them again, then submit. Your other answers are kept.`;
  }
  // A missing-kinds refusal is left as sent: the server names the documents,
  // and the form already blocks the kinds it knows are missing.
  return null;
}

function readBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const url = String(reader.result);
      resolve(url.slice(url.indexOf(",") + 1));
    };
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}
