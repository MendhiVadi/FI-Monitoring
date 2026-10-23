import { memo, useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { Spinner } from "../auth/Spinner";
import {
  REVIEW_LABELS, REVIEW_LIMITS, formatAadhaar, formatBytes, hasIdNumberInText, kindLabel, maskIdNumber, maskIdNumbersInText,
  type CaseDocument, type CheckResult, type DocumentScreening, type FileVariant, type ReviewDecision,
} from "../tickets/caseDocuments";
import { EventTime } from "./CaseText";
import { fetchDocumentFile, reviewWasSaved, submitDocumentReview } from "./documentCalls";
import { actorLabel, describeSaveError } from "./presentation";
import { newRequestId } from "./useOfficerPortal";
import { styles } from "./portal.styles";

type Tone = { glyph: string; label: string; tone: CSSProperties };
// Glyph plus words on every badge, so a flag never depends on colour alone.
const RISK: Record<string, Tone> = {
  low: { glyph: "✓", label: "Low risk", tone: { color: "#bbf7d0", background: "rgba(34, 197, 94, 0.15)", borderColor: "rgba(34, 197, 94, 0.4)" } },
  medium: { glyph: "!", label: "Medium risk", tone: { color: "#fde68a", background: "rgba(245, 158, 11, 0.15)", borderColor: "rgba(245, 158, 11, 0.4)" } },
  high: { glyph: "▲", label: "High risk", tone: { color: "#fed7aa", background: "rgba(249, 115, 22, 0.18)", borderColor: "rgba(249, 115, 22, 0.5)" } },
  altered: { glyph: "✕", label: "Altered", tone: { color: "#fecaca", background: "rgba(239, 68, 68, 0.2)", borderColor: "rgba(239, 68, 68, 0.55)" } },
  pending: { glyph: "◌", label: "Screening…", tone: { color: "#bfdbfe", background: "rgba(59, 130, 246, 0.12)", borderColor: "rgba(59, 130, 246, 0.35)" } },
  error: { glyph: "?", label: "Screening failed", tone: { color: "#e5e7eb", background: "rgba(148, 163, 184, 0.14)", borderColor: "rgba(148, 163, 184, 0.4)" } },
  unscored: { glyph: "–", label: "Not scored", tone: { color: "#cbd5e1", background: "rgba(148, 163, 184, 0.1)", borderColor: "rgba(148, 163, 184, 0.3)" } },
};
const CHECKS: Record<CheckResult, { glyph: string; label: string; color: string }> = {
  pass: { glyph: "✓", label: "Pass", color: "#86efac" },
  warn: { glyph: "!", label: "Warning", color: "#fcd34d" },
  fail: { glyph: "✕", label: "Fail", color: "#fca5a5" },
  info: { glyph: "i", label: "Info", color: "#93c5fd" },
  unavailable: { glyph: "–", label: "Not run", color: "#94a3b8" },
};
const DECISION_GLYPHS: Record<ReviewDecision, string> = { accepted: "✓", rejected: "✕", reupload_requested: "↻" };
const DECISIONS: [ReviewDecision, string][] = [["accepted", "Accept"], ["rejected", "Reject"], ["reupload_requested", "Request re-upload"]];
const NOT_RETRYABLE = new Set(["functions/unauthenticated", "functions/permission-denied", "functions/invalid-argument",
  "functions/not-found", "functions/resource-exhausted", "functions/failed-precondition"]);

function riskKey(screening: DocumentScreening | undefined) {
  if (!screening || screening.state === "pending") return "pending";
  if (screening.state === "error") return "error";
  return screening.risk && Object.hasOwn(RISK, screening.risk) ? screening.risk : "unscored";
}

function RiskBadge({ screening }: { screening: DocumentScreening | undefined }) {
  const { glyph, label, tone } = RISK[riskKey(screening)];
  return (
    <span style={{ ...styles.docBadge, ...tone }}>
      <span aria-hidden="true">{glyph}</span>
      {label}
    </span>
  );
}

type FileState = { status: "loading" } | { status: "ready"; url: string; contentType: string } | { status: "error"; message: string };

function describeFileError(err: unknown) {
  const code = (err as { code?: string })?.code ?? "";
  if (err instanceof Error && err.message === "unsupported-type") return "This file type cannot be previewed here.";
  if (code === "functions/not-found") return "This file is no longer stored. It may have been removed after the retention period.";
  if (code === "functions/unauthenticated") return "Your session ended. Sign in again to view files.";
  if (code === "functions/permission-denied") return "Your account is not allowed to view this file.";
  return "The file could not be loaded. Check your connection and retry.";
}

// Files arrive only when asked for, and every blob URL is revoked once the
// card leaves the dossier, so closed cases do not keep copies in memory.
function useDocumentFiles(documentId: string) {
  const [files, setFiles] = useState<Partial<Record<FileVariant, FileState>>>({});
  const urls = useRef<string[]>([]), inFlight = useRef(new Set<FileVariant>()), alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => { alive.current = false; urls.current.forEach(url => URL.revokeObjectURL(url)); urls.current = []; };
  }, []);
  const load = (variant: FileVariant) => {
    if (files[variant]?.status === "ready" || inFlight.current.has(variant)) return;
    inFlight.current.add(variant);
    setFiles(previous => ({ ...previous, [variant]: { status: "loading" } }));
    fetchDocumentFile(documentId, variant).then(file => {
      if (!alive.current) { URL.revokeObjectURL(file.url); return; }
      urls.current.push(file.url);
      setFiles(previous => ({ ...previous, [variant]: { status: "ready", ...file } }));
    }, err => {
      if (alive.current) setFiles(previous => ({ ...previous, [variant]: { status: "error", message: describeFileError(err) } }));
    }).finally(() => inFlight.current.delete(variant));
  };
  return { files, load };
}

function FileView({ state, label, onRetry }: { state: FileState | undefined; label: string; onRetry: () => void }) {
  if (!state || state.status === "loading") {
    return <p role="status" style={{ ...styles.fieldHint, display: "flex", gap: "0.5rem", alignItems: "center" }}><Spinner color="#93c5fd" /> Loading {label.toLowerCase()}…</p>;
  }
  if (state.status === "error") {
    return (
      <div role="alert" style={styles.fieldError}>
        <span>{state.message}</span>
        <button type="button" className="portal-btn" style={{ ...styles.resetFiltersBtn, padding: "0 0.85rem" }} onClick={onRetry}>Retry</button>
      </div>
    );
  }
  return (
    <div className="doc-file">
      {state.contentType === "application/pdf"
        ? <iframe src={state.url} title={label} />
        : <img src={state.url} alt={label} />}
      <a href={state.url} target="_blank" rel="noopener noreferrer" style={styles.docLink}>Open file<span className="sr-only"> ({label}) in a new tab</span></a>
    </div>
  );
}

const Caret = ({ open }: { open: boolean }) => <span aria-hidden="true">{open ? "▾" : "▸"}</span>;

function Field({ label, children }: { label: string; children: ReactNode }) {
  return <div><dt>{label}</dt><dd>{children}</dd></div>;
}

function signatureText(valid: boolean | null | undefined, certificateMissing: boolean) {
  if (valid === true) return <><span aria-hidden="true">✓ </span>Valid UIDAI signature</>;
  if (valid === false) return <><span aria-hidden="true">✕ </span>Signature does not verify (content altered)</>;
  return <><span aria-hidden="true">– </span>{certificateMissing ? "Not verified: no UIDAI certificate configured" : "Not verified"}</>;
}

function ReviewForm({ document, onSaved }: { document: CaseDocument; onSaved: (message: string) => void }) {
  const base = `doc-${document.id}`;
  const [decision, setDecision] = useState<ReviewDecision | null>(null);
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<{ message: string; retryable: boolean } | null>(null);
  // Same decision and reason keep the same request ID, so a retry after a lost
  // response cannot record a second review.
  const request = useRef<{ id: string; body: string } | null>(null);
  const trimmed = reason.trim();
  const canSubmit = decision !== null && trimmed.length >= REVIEW_LIMITS.min && trimmed.length <= REVIEW_LIMITS.max && !saving;
  const focusReason = () => window.document.getElementById(`${base}-reason`)?.focus();

  async function save() {
    if (!decision || !canSubmit) return;
    const body = decision + "\n" + trimmed;
    if (!request.current || request.current.body !== body) request.current = { id: newRequestId(), body };
    const requestId = request.current.id;
    setSaving(true); setError(null);
    const done = () => {
      request.current = null; setDecision(null); setReason("");
      onSaved(`Review saved: ${REVIEW_LABELS[decision]} · ${kindLabel(document.kind)}.`);
    };
    try {
      await submitDocumentReview(document.id, decision, trimmed, requestId);
      done();
    } catch (err) {
      if (await reviewWasSaved(document.ticketId, document.id, requestId)) { done(); return; }
      const code = (err as { code?: string })?.code ?? "";
      // already-exists: the ID collided with another change, so a retry needs a fresh one.
      if (code === "functions/aborted" || code === "functions/already-exists") request.current = null;
      setError({ message: describeSaveError(err), retryable: !NOT_RETRYABLE.has(code) });
    } finally { setSaving(false); }
  }

  return (
    <form className="doc-screen-only" style={styles.docReviewForm} aria-labelledby={`${base}-review-title`}
      onSubmit={event => { event.preventDefault(); void save(); }}>
      <h5 id={`${base}-review-title`} style={styles.docSubheading}>{document.review ? "Change review" : "Review this document"}</h5>
      <fieldset className="doc-decisions">
        <legend style={styles.fieldLabel}>Decision</legend>
        {DECISIONS.map(([value, label]) => (
          <label key={value} htmlFor={`${base}-${value}`}>
            <input type="radio" id={`${base}-${value}`} name={`${base}-decision`} value={value} checked={decision === value}
              disabled={saving} onChange={() => setDecision(value)} />
            <span aria-hidden="true">{DECISION_GLYPHS[value]}</span> {label}
          </label>
        ))}
      </fieldset>
      <label htmlFor={`${base}-reason`} style={styles.fieldLabel}>Reason (required, saved to case history)</label>
      <textarea id={`${base}-reason`} rows={2} maxLength={REVIEW_LIMITS.max} value={reason} readOnly={saving}
        onChange={event => { setReason(event.target.value); if (error && !error.retryable) setError(null); }}
        aria-invalid={error ? true : undefined}
        aria-describedby={`${base}-reason-hint ${base}-reason-count` + (error ? ` ${base}-review-error` : "")}
        style={styles.noteInput} />
      <div style={styles.fieldMeta}>
        <p id={`${base}-reason-hint`} style={styles.fieldHint}>Choose a decision and give 3–500 characters. Other staff can read it.</p>
        <span id={`${base}-reason-count`} style={styles.counter}>{reason.length}/{REVIEW_LIMITS.max}</span>
      </div>
      <button type="submit" className="portal-btn" style={{ ...styles.modalPrimaryBtn, alignSelf: "flex-start" }} disabled={!canSubmit}>
        {saving ? <><Spinner /> Saving…</> : "Submit review"}
      </button>
      {error && (
        <div role="alert" id={`${base}-review-error`} style={styles.fieldError}>
          <span>{error.message}</span>
          <span style={{ display: "flex", gap: "0.4rem" }}>
            {error.retryable && canSubmit && (
              <button type="button" className="portal-btn" style={{ ...styles.resetFiltersBtn, padding: "0 0.85rem" }}
                onClick={() => { focusReason(); void save(); }}>Retry</button>
            )}
            <button type="button" className="icon-btn" aria-label="Dismiss error" style={{ ...styles.clearSearchBtn, color: "#fecaca" }}
              onClick={() => { focusReason(); setError(null); }}>✕</button>
          </span>
        </div>
      )}
    </form>
  );
}

// Memoised: the dossier re-renders on every keystroke in its status and note forms.
export const DocumentCard = memo(function DocumentCard({ document, currentUid, onNotice }: {
  document: CaseDocument;
  currentUid: string | undefined;
  onNotice: (message: string) => void;
}) {
  const base = `doc-${document.id}`;
  const { files, load } = useDocumentFiles(document.id);
  const [open, setOpen] = useState<{ preview: boolean; ela: boolean; faces: boolean }>({ preview: false, ela: false, faces: false });
  const [reveal, setReveal] = useState(false);
  const screening = document.screening, checks = screening?.checks ?? [];
  const qr = screening?.extracted?.qr, ocr = screening?.extracted?.ocr;
  const attention = checks.filter(check => check.result === "fail" || check.result === "warn").length;
  // The Secure QR check, not "print vs QR" (which is unavailable whenever OCR is).
  const certificateMissing = checks.some(check => /qr/i.test(check.id) && !/print/i.test(check.id) && check.result === "unavailable");
  const label = kindLabel(document.kind);
  const toggle = (panel: keyof typeof open, variants: FileVariant[]) => {
    if (!open[panel]) variants.forEach(load);
    setOpen(previous => ({ ...previous, [panel]: !previous[panel] }));
  };
  const showNumber = (value: string) => reveal ? formatAadhaar(value) : maskIdNumber(value);
  const ocrNumbers = [...(ocr?.aadhaarNumbers ?? []), ...(ocr?.panNumbers ?? [])];
  const fileName = document.fileName || "";
  const shownName = reveal ? fileName : maskIdNumbersInText(fileName);
  const hasFullNumbers = Boolean(document.idNumberFull) || ocrNumbers.length > 0 || hasIdNumberInText(fileName);
  const review = document.review;

  return (
    <li style={styles.docCard}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: "0.5rem 0.75rem", flexWrap: "wrap", alignItems: "flex-start" }}>
        <div style={{ minWidth: 0, display: "flex", gap: "0.4rem", flexWrap: "wrap", alignItems: "center" }}>
          <h4 id={`${base}-title`} style={styles.docTitle}>{label}</h4>
          {document.side === "other_party" && <span style={styles.docSideTag}>Other party’s</span>}
        </div>
        <RiskBadge screening={screening} />
      </div>
      <p style={styles.docMeta}>
        <span style={{ overflowWrap: "anywhere" }}>{shownName || "Unnamed file"}</span>
        {" · "}{formatBytes(document.sizeBytes)}
        {document.pageCount ? ` · ${document.pageCount} page${document.pageCount === 1 ? "" : "s"}` : ""}
        {" · Uploaded "}<EventTime at={document.uploadedAt} />
      </p>
      {screening?.state === "done" && screening.summary && (
        <p style={styles.docSummary}>
          {screening.summary}
          {typeof screening.score === "number" && <span style={{ color: "#94a3b8" }}> · Score {Math.round(screening.score)}/100</span>}
        </p>
      )}
      {screening?.state === "error" && <p style={styles.docSummary}>Automatic checks did not finish for this file. Review it manually.</p>}
      {(!screening || screening.state === "pending") && <p style={styles.docSummary}>Checks are still running; this card updates when they finish.</p>}

      {review && (
        <p style={styles.docReviewLine}>
          <strong><span aria-hidden="true">{DECISION_GLYPHS[review.decision] ?? "•"} </span>{REVIEW_LABELS[review.decision] ?? review.decision}</strong>
          {" by "}{review.by === currentUid ? "you" : review.byEmail || actorLabel(review.by, currentUid)}
          {" · "}<EventTime at={review.at} />
          {review.reason && <span style={{ display: "block", marginTop: "0.2rem", overflowWrap: "anywhere" }}>“{review.reason}”</span>}
        </p>
      )}

      {checks.length > 0 && (
        <details className="doc-screen-only doc-details">
          <summary>
            Screening checks ({checks.length}{attention ? ` · ${attention} need${attention === 1 ? "s" : ""} attention` : ""})
          </summary>
          <ul className="doc-checks">
            {checks.map((check, index) => {
              const result = Object.hasOwn(CHECKS, check.result) ? CHECKS[check.result] : CHECKS.unavailable;
              return (
                <li key={check.id + ":" + index}>
                  <span aria-hidden="true" style={{ ...styles.docCheckGlyph, color: result.color, borderColor: result.color }}>{result.glyph}</span>
                  <span style={{ minWidth: 0 }}>
                    <strong style={{ color: "#e5e7eb" }}>{check.label}</strong>
                    <span style={{ color: result.color, fontWeight: 700 }}> · {result.label}</span>
                    {check.detail && <span style={{ display: "block", color: "#cbd5e1", overflowWrap: "anywhere" }}>{check.detail}</span>}
                  </span>
                </li>
              );
            })}
          </ul>
        </details>
      )}

      {(qr || ocrNumbers.length > 0 || document.idNumberMasked || document.idNumberFull) && (
        <div className="doc-screen-only" style={{ display: "grid", gap: "0.5rem" }}>
          <div style={{ display: "flex", justifyContent: "space-between", gap: "0.5rem", flexWrap: "wrap", alignItems: "center" }}>
            <h5 style={styles.docSubheading}>Extracted details</h5>
            {hasFullNumbers && (
              <button type="button" className="portal-btn" aria-pressed={reveal} style={styles.modalSecondaryBtn} onClick={() => setReveal(value => !value)}>
                <span aria-hidden="true">{reveal ? "✓" : "○"}</span> Show full number
              </button>
            )}
          </div>
          <dl className="doc-fields">
            {(document.idNumberMasked || document.idNumberFull) && (
              <Field label="ID number typed by reporter">
                <span style={{ fontVariantNumeric: "tabular-nums" }}>
                  {reveal && document.idNumberFull ? formatAadhaar(document.idNumberFull)
                    : document.idNumberMasked || maskIdNumber(document.idNumberFull ?? "")}
                </span>
              </Field>
            )}
            {qr && (
              <>
                <Field label="QR signature">{signatureText(qr.signatureValid, certificateMissing)}</Field>
                {qr.name && <Field label="Name (QR)">{qr.name}</Field>}
                {qr.dob && <Field label="Date of birth (QR)">{qr.dob}</Field>}
                {qr.gender && <Field label="Gender (QR)">{qr.gender}</Field>}
                {qr.last4 && <Field label="Aadhaar last 4 (QR)"><span style={{ fontVariantNumeric: "tabular-nums" }}>{qr.last4}</span></Field>}
                {(qr.district || qr.state || qr.pincode) && (
                  <Field label="Address (QR)">{[qr.district, qr.state, qr.pincode].filter(Boolean).join(", ")}</Field>
                )}
              </>
            )}
            {ocrNumbers.length > 0 && (
              <Field label="Numbers found in the printed text">
                <span style={{ fontVariantNumeric: "tabular-nums" }}>{ocrNumbers.map(showNumber).join(" · ")}</span>
              </Field>
            )}
          </dl>
        </div>
      )}

      <div className="doc-screen-only doc-toggles">
        <button type="button" className="portal-btn" style={styles.modalSecondaryBtn} aria-expanded={open.preview} aria-controls={`${base}-preview`}
          onClick={() => toggle("preview", ["original"])}>
          <Caret open={open.preview} /> Preview
        </button>
        {document.storage?.ela && (
          <button type="button" className="portal-btn" style={styles.modalSecondaryBtn} aria-expanded={open.ela} aria-controls={`${base}-ela`}
            onClick={() => toggle("ela", ["ela"])}>
            <Caret open={open.ela} /> ELA heatmap
          </button>
        )}
        {document.storage?.faceCard && document.storage?.faceQr && (
          <button type="button" className="portal-btn" style={styles.modalSecondaryBtn} aria-expanded={open.faces} aria-controls={`${base}-faces`}
            onClick={() => toggle("faces", ["faceCard", "faceQr"])}>
            <Caret open={open.faces} /> Face comparison
          </button>
        )}
      </div>
      {open.preview && (
        <div id={`${base}-preview`} className="doc-screen-only">
          <FileView state={files.original} label={`${label}: ${shownName || "uploaded file"}`} onRetry={() => load("original")} />
        </div>
      )}
      {open.ela && (
        <div id={`${base}-ela`} className="doc-screen-only" style={{ display: "grid", gap: "0.4rem" }}>
          <p style={styles.fieldHint}>Bright, tightly bounded patches can mean a region was edited; uniform noise is normal. Treat it as a hint only.</p>
          <FileView state={files.ela} label={`Error level heatmap of ${label}`} onRetry={() => load("ela")} />
        </div>
      )}
      {open.faces && (
        <div id={`${base}-faces`} className="doc-screen-only doc-faces">
          <figure>
            <FileView state={files.faceCard} label="Face printed on the card" onRetry={() => load("faceCard")} />
            <figcaption>Printed on the card</figcaption>
          </figure>
          <figure>
            <FileView state={files.faceQr} label="Photo stored in the Aadhaar QR code" onRetry={() => load("faceQr")} />
            <figcaption>Stored in the QR code</figcaption>
          </figure>
        </div>
      )}

      <ReviewForm document={document} onSaved={onNotice} />
    </li>
  );
});
