import { memo, useRef, useState, type ChangeEvent } from "react";
import { useDraftField } from "./draftStore";
import { useNow } from "./countdown";
import { inputStyle, labelStyle } from "./reporting.styles";
import {
  ACCEPT, DOCUMENTS_SECTION_ID, MAX_FILES, MAX_FILE_BYTES, PENDING_TTL_MINUTES,
  caseTypeFor, discardUpload, enqueueUploads, formatSize, isExpired, kindById, kindControlId,
  removeDocument, retryUpload, useUploadAnnouncement, useUploadItems,
  type DocumentKind, type UploadContext, type UploadItem, type UploadStatus,
} from "./documentUploads";
import { formatIdNumber, idNumberError, normaliseIdNumber, type IdNumberKind } from "./idNumbers";
import type { UploadedDocument } from "./types";
import { SelfieCapture } from "./SelfieCapture";

const STATUS_LABEL: Record<UploadStatus, string> = {
  queued: "Waiting to upload…",
  reading: "Preparing…",
  uploading: "Uploading…",
  screening: "Checking the file…",
  error: "Not uploaded",
};
const ID_LABEL: Record<IdNumberKind, string> = { aadhaar: "Aadhaar number", pan: "PAN" };
// The hologram check compares this photo with the straight Aadhaar upload.
const AADHAAR_ANGLE_HOWTO = "How to: lay the card flat in good light without flash, tilt it about 30° towards a window or lamp until the hologram changes colour, and keep the whole card sharp in the frame. A paper e-Aadhaar print has no hologram, so skip this for one.";
const BLOCKED_MESSAGE = "Verify your number again (below the form) before uploading.";

interface DocumentsSectionProps {
  otherPartyType: string;
  submissionId: string;
  phone: string;
  verificationToken: string;
  reporterName: string;
  /** The verification proof is known to be stale: uploads would be refused. */
  blocked: boolean;
  onUnauthenticated: () => void;
  /** Missing required kinds show inline once a submit has been attempted. */
  showErrors: boolean;
}

// memo: the form re-renders on every keystroke, and none of these props change with most of them.
export const DocumentsSection = memo(function DocumentsSection(props: DocumentsSectionProps) {
  const { otherPartyType, submissionId, showErrors } = props;
  const caseType = caseTypeFor(otherPartyType);
  const [documents] = useDraftField("documents");
  const allItems = useUploadItems();
  const announcement = useUploadAnnouncement();
  const items = allItems.filter((item) => item.submissionId === submissionId);
  // Expiry is 2 hours out, so a minute's precision is plenty.
  const now = useNow();

  // A kind the case type no longer lists (the other party changed) keeps its
  // files visible, so they can be removed or still sent.
  const listed = new Set([...caseType.required, ...caseType.optional].map((kind) => kind.id));
  const extra = [...new Set([...documents.map((d) => d.kind), ...items.map((i) => i.kind)])]
    .filter((id) => !listed.has(id)).flatMap((id) => kindById(id) ?? []);
  const optionalKinds = [...caseType.optional, ...extra];
  const optionalInUse = optionalKinds.some((kind) => documents.some((d) => d.kind === kind.id) || items.some((i) => i.kind === kind.id));
  // Starts open when returning to a draft with optional files, and stays open
  // after the last one is removed so focus is not lost in a collapsed list.
  const [optionalOpen, setOptionalOpen] = useState(optionalInUse);
  const optionalShown = optionalOpen || optionalInUse;
  const used = documents.length + items.filter((item) => item.status !== "error").length;
  const requiredCount = caseType.required.length;

  const row = (kind: DocumentKind, required: boolean) => (
    <DocumentKindRow key={kind.id} {...props} kind={kind} required={required} now={now}
      documents={documents.filter((d) => d.kind === kind.id)} allDocuments={documents}
      items={items.filter((i) => i.kind === kind.id)} showMissing={showErrors && required} />
  );

  return (
    <fieldset className="report-fieldset">
      <legend className="report-legend">Documents</legend>
      <div id={DOCUMENTS_SECTION_ID} tabIndex={-1} className="report-docs-intro">
        <p style={{ margin: 0 }}>
          Case type: <strong>{caseType.label}</strong>, because the other party is “{otherPartyType}”.{" "}
          {requiredCount === 1 ? "1 document is required." : `${requiredCount} documents are required.`}
        </p>
        <p className="report-hint" style={{ margin: ".4rem 0 0" }}>
          JPEG, PNG, WebP or PDF, up to {formatSize(MAX_FILE_BYTES)} each and {MAX_FILES} files in total ({used} used).
          Files are checked automatically so staff can review anything unusual; a check never rejects your report on its own.
          Uploads not sent with a report expire after {PENDING_TTL_MINUTES / 60} hours and are then deleted.
        </p>
      </div>
      <p role="status" className="report-sr-only">{announcement}</p>

      {caseType.required.map((kind) => row(kind, true))}

      {optionalKinds.length > 0 && (
        <>
          {!optionalInUse && (
            <button type="button" className="report-btn report-btn--secondary" aria-expanded={optionalShown} aria-controls="dispute-docs-optional"
              onClick={() => setOptionalOpen((open) => !open)} style={{ marginBottom: "1rem" }}>
              {optionalShown ? "Hide optional documents" : "Add optional documents"}
            </button>
          )}
          <div id="dispute-docs-optional" hidden={!optionalShown}>
            <p className="report-hint">Optional. Add anything that helps staff understand the dispute.</p>
            {optionalKinds.map((kind) => row(kind, false))}
          </div>
        </>
      )}
    </fieldset>
  );
});

function DocumentKindRow({ kind, required, now, documents, allDocuments, items, showMissing, submissionId, phone, verificationToken, reporterName, blocked, onUnauthenticated }: DocumentsSectionProps & {
  kind: DocumentKind; required: boolean; now: number; documents: UploadedDocument[]; allDocuments: UploadedDocument[]; items: UploadItem[]; showMissing: boolean;
}) {
  const controlId = kindControlId(kind.id);
  const labelId = `${controlId}-label`;
  const fileInput = useRef<HTMLInputElement>(null);
  const numberInput = useRef<HTMLInputElement>(null);
  const [kindError, setKindError] = useState<string | null>(null);
  const [removeErrors, setRemoveErrors] = useState<Readonly<Record<string, string>>>({});
  const [removing, setRemoving] = useState<ReadonlySet<string>>(() => new Set());
  const idKind = (kind.idNumber === "aadhaar" || kind.idNumber === "pan") ? kind.idNumber : null;
  const [idNumbers, setIdNumbers] = useDraftField("idNumbers");
  const [numberTouched, setNumberTouched] = useState(false);
  const typedNumber = idKind ? idNumbers[idKind] ?? "" : "";
  const numberError = idKind ? idNumberError(idKind, typedNumber) : null;
  const numberId = `${controlId}-number`;
  const usable = documents.some((doc) => !isExpired(doc, now));
  const missing = showMissing && !usable && !items.some((item) => item.status !== "error");
  const shownNumberError = numberTouched ? numberError : null;

  const context = (): UploadContext => ({
    submissionId, phone, verificationToken, onUnauthenticated,
    reporterName: reporterName.trim().length >= 2 ? reporterName.trim() : "",
    idNumber: idKind && typedNumber && !numberError ? normaliseIdNumber(idKind, typedNumber) : undefined,
  });

  function choose() {
    setKindError(null);
    if (blocked) { setKindError(BLOCKED_MESSAGE); return; }
    if (numberError) { setNumberTouched(true); numberInput.current?.focus(); return; }
    fileInput.current?.click();
  }

  function onFiles(event: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files ?? []);
    // Cleared so choosing the same file again (after a failure) fires change.
    event.target.value = "";
    if (files.length === 0) return;
    const problems = enqueueUploads(kind.id, files, allDocuments, context());
    setKindError(problems.length > 0 ? problems.join(" ") : null);
  }

  async function remove(doc: UploadedDocument) {
    if (removing.has(doc.documentId)) return;
    setRemoving((prev) => new Set(prev).add(doc.documentId));
    const failure = await removeDocument(doc, { submissionId, phone, verificationToken, onUnauthenticated });
    setRemoving((prev) => { const next = new Set(prev); next.delete(doc.documentId); return next; });
    setRemoveErrors((prev) => {
      const next = { ...prev };
      if (failure) next[doc.documentId] = failure; else delete next[doc.documentId];
      return next;
    });
    if (!failure) restoreFocus();
  }

  // The pressed button is gone (row removed, or Retry swapped for Cancel); keep
  // keyboard users in the same place. After the re-render, since a kind kept
  // only for its files disappears with the last one.
  function restoreFocus() {
    requestAnimationFrame(() => {
      (document.getElementById(controlId) ?? document.getElementById(DOCUMENTS_SECTION_ID))?.focus({ preventScroll: true });
    });
  }

  function discard(item: UploadItem) {
    discardUpload(item.localId);
    restoreFocus();
  }

  // The selfie panel opens only when an upload could go through.
  function canStartSelfie() {
    setKindError(null);
    if (blocked) { setKindError(BLOCKED_MESSAGE); return false; }
    return true;
  }

  function addSelfie(file: File) {
    if (blocked) { setKindError(BLOCKED_MESSAGE); return; }
    const problems = enqueueUploads(kind.id, [file], allDocuments, context());
    setKindError(problems.length > 0 ? problems.join(" ") : null);
  }

  function retry(item: UploadItem) {
    if (blocked) { setKindError(BLOCKED_MESSAGE); return; }
    // As for a new file: an invalid number would otherwise be dropped silently.
    if (numberError) { setNumberTouched(true); numberInput.current?.focus(); return; }
    const problem = retryUpload(item.localId, allDocuments, context());
    setKindError(problem);
    if (!problem) restoreFocus();
  }

  const errorText = kindError ?? (missing ? "Required: upload at least one file." : null);
  const howTo = kind.id === "aadhaar_angle" ? AADHAAR_ANGLE_HOWTO : null;
  const describedBy = [kind.hint && `${controlId}-hint`, howTo && `${controlId}-howto`, errorText && `${controlId}-error`].filter(Boolean).join(" ") || undefined;
  const count = documents.length + items.length;

  return (
    <div role="group" aria-labelledby={labelId} className="report-doc-kind" data-invalid={errorText ? "true" : undefined}>
      <h3 id={labelId} className="report-doc-title">
        {kind.label}
        <span className={required ? "report-required" : "report-optional"}> ({required ? "required" : "optional"})</span>
      </h3>
      {kind.hint && <p id={`${controlId}-hint`} className="report-hint">{kind.hint}</p>}
      {howTo && <p id={`${controlId}-howto`} className="report-hint">{howTo}</p>}

      {idKind && (
        <div className="report-field" style={{ margin: ".5rem 0 .75rem" }}>
          <label htmlFor={numberId} style={labelStyle}>
            {ID_LABEL[idKind]} <span className="report-optional">(optional)</span>
          </label>
          <p id={`${numberId}-hint`} className="report-hint">
            {idKind === "aadhaar"
              ? "12 digits, as printed on the card. Type it before uploading so staff can check it against the card."
              : "10 characters, as printed on the card, for example ABCDE1234F. Type it before uploading."}
          </p>
          <input
            ref={numberInput}
            id={numberId}
            inputMode={idKind === "aadhaar" ? "numeric" : "text"}
            autoComplete="off"
            autoCapitalize={idKind === "pan" ? "characters" : "off"}
            spellCheck={false}
            pattern={idKind === "aadhaar" ? "[2-9][0-9]{3} [0-9]{4} [0-9]{4}" : "[A-Z]{5}[0-9]{4}[A-Z]"}
            placeholder={idKind === "aadhaar" ? "1234 5678 9012" : "ABCDE1234F"}
            value={formatIdNumber(idKind, typedNumber)}
            onChange={(e) => setIdNumbers({ ...idNumbers, [idKind]: normaliseIdNumber(idKind, e.target.value) })}
            onBlur={() => setNumberTouched(true)}
            aria-invalid={shownNumberError ? true : undefined}
            aria-describedby={[`${numberId}-hint`, shownNumberError && `${numberId}-error`].filter(Boolean).join(" ")}
            style={{ ...inputStyle, maxWidth: "16rem", letterSpacing: ".06em", fontVariantNumeric: "tabular-nums" }}
          />
          {shownNumberError && <p id={`${numberId}-error`} className="report-field-error" role="alert">{shownNumberError}</p>}
        </div>
      )}

      {count > 0 && (
        <ul className="report-doc-files" aria-label={`Files for ${kind.label}`}>
          {documents.map((doc) => {
            const expired = isExpired(doc, now);
            const failure = removeErrors[doc.documentId];
            const busy = removing.has(doc.documentId);
            return (
              <li key={doc.documentId} className="report-doc-file">
                <span className="report-doc-name">{doc.fileName}</span>
                <span className="report-doc-size">{formatSize(doc.sizeBytes)}</span>
                <span className="report-doc-status" data-state={expired ? "error" : "done"}>
                  {expired ? "Expired: upload it again" : "Uploaded"}
                </span>
                <button type="button" className="report-link-btn" onClick={() => void remove(doc)} disabled={busy} aria-busy={busy || undefined}>
                  {busy ? "Removing…" : "Remove"}<span className="report-sr-only"> {doc.fileName}</span>
                </button>
                {!expired && doc.userMessages.length > 0 && (
                  <ul className="report-doc-messages">
                    {doc.userMessages.map((message, i) => <li key={i}>{message}</li>)}
                  </ul>
                )}
                {failure && <p className="report-field-error report-doc-wide" role="alert">{failure}</p>}
              </li>
            );
          })}
          {items.map((item) => (
            <li key={item.localId} className="report-doc-file">
              <span className="report-doc-name">{item.fileName}</span>
              <span className="report-doc-size">{formatSize(item.sizeBytes)}</span>
              <span className="report-doc-status" data-state={item.status === "error" ? "error" : "busy"}>{STATUS_LABEL[item.status]}</span>
              {item.status === "error" && (
                <>
                  <button type="button" className="report-link-btn" onClick={() => retry(item)}>
                    Retry<span className="report-sr-only"> {item.fileName}</span>
                  </button>
                  <button type="button" className="report-link-btn" onClick={() => discard(item)}>
                    Remove<span className="report-sr-only"> {item.fileName}</span>
                  </button>
                  <p className="report-field-error report-doc-wide" role="alert">{item.error}</p>
                </>
              )}
              {item.status === "queued" && (
                <button type="button" className="report-link-btn" onClick={() => discard(item)}>
                  Cancel<span className="report-sr-only"> {item.fileName}</span>
                </button>
              )}
            </li>
          ))}
        </ul>
      )}

      {kind.id === "selfie" ? (
        // Camera only: the liveness check needs three fresh poses, not a file from the gallery.
        <SelfieCapture idPrefix={controlId} startId={controlId} optional={!required} startDescribedBy={describedBy}
          startLabel={count > 0 ? "Take the selfie check again" : "Take the selfie check"}
          onRequestStart={canStartSelfie} onCapture={addSelfie} />
      ) : (
        <>
          <input ref={fileInput} type="file" accept={ACCEPT} multiple className="report-sr-only" tabIndex={-1} aria-hidden="true" onChange={onFiles} />
          <button type="button" id={controlId} className="report-btn report-btn--secondary" onClick={choose}
            aria-describedby={describedBy}>
            {count > 0 ? "Add another file" : "Choose file"}<span className="report-sr-only"> for {kind.label}</span>
          </button>
        </>
      )}
      {errorText && <p id={`${controlId}-error`} className="report-field-error" role="alert">{errorText}</p>}
    </div>
  );
}
