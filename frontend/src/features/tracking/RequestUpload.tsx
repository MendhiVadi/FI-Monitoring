import { useEffect, useRef, useState, type ChangeEvent } from "react";
import { ACCEPT, contentTypeOf, fileProblem, kindById, readBase64 } from "../reporting/documentUploads";
import { formatIdNumber, idNumberError, normaliseIdNumber, type IdNumberKind } from "../reporting/idNumbers";
import { inputStyle, labelStyle } from "../reporting/reporting.styles";
import { readableCallableError } from "../reporting/callables";
import { SelfieCapture } from "../reporting/SelfieCapture";
import { formatDateIST } from "../../shared/format/formatDate";
import { isUnauthenticated, uploadReplacementDocument, type DocumentRequest } from "./caseStatus";

const ID_LABEL: Record<IdNumberKind, string> = { aadhaar: "Aadhaar number", pan: "PAN" };
const VERIFY_FIRST = "Verify your phone first (above), then upload.";

interface RequestUploadProps {
  request: DocumentRequest;
  reference: string;
  phone: string;
  verificationToken: string;
  /** No usable phone verification: uploads would be refused. */
  blocked: boolean;
  now: number;
  /** The server refused this proof: the page asks for a fresh verification. */
  onUnauthenticated: (token: string) => void;
}

// One open document request: what staff asked for, by when, and the upload
// control once the phone is verified. Each request takes exactly one file,
// which the server attaches to the case in place of the old copy.
export function RequestUpload({ request, reference, phone, verificationToken, blocked, now, onUnauthenticated }: RequestUploadProps) {
  const kind = kindById(request.kind);
  const label = request.kindLabel || kind?.label || "Document";
  const idKind: IdNumberKind | null = kind?.idNumber === "aadhaar" || kind?.idNumber === "pan" ? kind.idNumber : null;
  const controlId = `track-request-${request.requestId.replace(/[^\w-]/g, "")}`;
  const [state, setState] = useState<"idle" | "uploading" | "done">("idle");
  const [error, setError] = useState<string | null>(null);
  const [fileName, setFileName] = useState("");
  const [messages, setMessages] = useState<string[]>([]);
  const [announcement, setAnnouncement] = useState("");
  const [typedNumber, setTypedNumber] = useState("");
  const [numberTouched, setNumberTouched] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const numberInput = useRef<HTMLInputElement>(null);
  const doneRef = useRef<HTMLParagraphElement>(null);
  const inFlight = useRef(false);
  const expired = now >= request.expiresAt;
  const numberError = idKind ? idNumberError(idKind, typedNumber) : null;
  const shownNumberError = numberTouched ? numberError : null;
  const numberId = `${controlId}-number`;

  // The upload control disappears on success; keep keyboard users on the result.
  useEffect(() => { if (state === "done") doneRef.current?.focus({ preventScroll: true }); }, [state]);

  function ready(): boolean {
    if (inFlight.current) return false;
    setError(null);
    if (blocked) { setError(VERIFY_FIRST); return false; }
    if (numberError) { setNumberTouched(true); numberInput.current?.focus(); return false; }
    return true;
  }

  function choose() {
    if (ready()) fileInput.current?.click();
  }

  function onFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    // Cleared so choosing the same file again (after a failure) fires change.
    event.target.value = "";
    if (file) void upload(file);
  }

  async function upload(file: File) {
    if (inFlight.current) return;
    if (!ready()) return;
    const problem = fileProblem(file);
    const contentType = contentTypeOf(file);
    if (problem || !contentType) { setError(problem ?? "Choose a JPEG, PNG, WebP or PDF file."); return; }
    inFlight.current = true;
    setState("uploading");
    setFileName(file.name);
    setAnnouncement(`Uploading ${file.name}…`);
    const token = verificationToken;
    try {
      let dataBase64: string;
      try {
        dataBase64 = await readBase64(file);
      } catch {
        setState("idle");
        setAnnouncement("");
        setError("Couldn't read this file. Choose it again, or try another copy.");
        return;
      }
      const result = await uploadReplacementDocument({
        reference, requestId: request.requestId, phone, verificationToken: token,
        fileName: file.name.slice(0, 120), contentType, dataBase64,
        ...(idKind && typedNumber && !numberError ? { idNumber: normaliseIdNumber(idKind, typedNumber) } : {}),
      });
      setMessages(result.userMessages);
      setState("done");
      setAnnouncement(`${file.name} uploaded.`);
    } catch (err) {
      setState("idle");
      setAnnouncement("");
      console.error("Replacement upload failed", (err as { code?: string })?.code ?? "unknown");
      if (isUnauthenticated(err)) {
        onUnauthenticated(token);
        setError("Your phone verification expired or does not match this report. Verify again above with the number you used for the report, then upload again.");
      } else {
        setError(readableCallableError(err, "Couldn't upload this file. Try again."));
      }
    } finally {
      inFlight.current = false;
    }
  }

  const uploading = state === "uploading";
  const errorId = `${controlId}-error`;
  const describedBy = [kind?.hint && `${controlId}-hint`, error && errorId].filter(Boolean).join(" ") || undefined;

  return (
    <article className="track-request" aria-labelledby={`${controlId}-title`}>
      <h3 id={`${controlId}-title`} className="track-request__title">{label}</h3>
      <p className="track-request__meta">
        Requested {formatDateIST(request.requestedAt)} · {expired ? <strong>Expired {formatDateIST(request.expiresAt)}</strong> : <>Upload by {formatDateIST(request.expiresAt)}</>}
      </p>
      <p role="status" className="report-sr-only">{announcement}</p>

      {state === "done" ? (
        <>
          <p ref={doneRef} tabIndex={-1} className="track-request__done">
            Uploaded {fileName}. Staff will review the new copy.
          </p>
          {messages.length > 0 && (
            <ul className="report-doc-messages" style={{ paddingLeft: "1.1rem" }}>
              {messages.map((message, i) => <li key={i}>{message}</li>)}
            </ul>
          )}
        </>
      ) : expired ? (
        <p className="report-hint">This request has expired. If you still need to send this document, contact the project team and quote your reference.</p>
      ) : (
        <>
          {kind?.hint && <p id={`${controlId}-hint`} className="report-hint">{kind.hint}</p>}
          {idKind && request.kind !== "selfie" && (
            <div className="report-field" style={{ margin: ".5rem 0 .75rem" }}>
              <label htmlFor={numberId} style={labelStyle}>
                {ID_LABEL[idKind]} <span className="report-optional">(optional)</span>
              </label>
              <p id={`${numberId}-hint`} className="report-hint">
                {idKind === "aadhaar" ? "12 digits, as printed on the card. Type it before uploading." : "10 characters, as printed on the card, for example ABCDE1234F."}
              </p>
              <input
                ref={numberInput}
                id={numberId}
                inputMode={idKind === "aadhaar" ? "numeric" : "text"}
                autoComplete="off"
                autoCapitalize={idKind === "pan" ? "characters" : "off"}
                spellCheck={false}
                placeholder={idKind === "aadhaar" ? "1234 5678 9012" : "ABCDE1234F"}
                value={formatIdNumber(idKind, typedNumber)}
                onChange={(e) => setTypedNumber(normaliseIdNumber(idKind, e.target.value))}
                onBlur={() => setNumberTouched(true)}
                disabled={uploading}
                aria-invalid={shownNumberError ? true : undefined}
                aria-describedby={[`${numberId}-hint`, shownNumberError && `${numberId}-error`].filter(Boolean).join(" ")}
                style={{ ...inputStyle, maxWidth: "16rem", letterSpacing: ".06em", fontVariantNumeric: "tabular-nums" }}
              />
              {shownNumberError && <p id={`${numberId}-error`} className="report-field-error" role="alert">{shownNumberError}</p>}
            </div>
          )}

          {request.kind === "selfie" ? (
            <SelfieCapture idPrefix={controlId} startId={controlId} optional={false} startLabel="Take the selfie check"
              startDescribedBy={describedBy} onRequestStart={ready} onCapture={(file) => void upload(file)} />
          ) : (
            <>
              <input ref={fileInput} type="file" accept={ACCEPT} className="report-sr-only" tabIndex={-1} aria-hidden="true" onChange={onFile} />
              <button type="button" id={controlId} className="report-btn report-btn--secondary" onClick={choose}
                aria-busy={uploading || undefined} aria-describedby={describedBy}>
                {uploading ? "Uploading…" : "Choose file"}<span className="report-sr-only"> for {label}</span>
              </button>
            </>
          )}
          {uploading && <p className="report-hint report-hint--after" aria-hidden="true">Uploading and checking {fileName}. This can take a minute or two.</p>}
          {error && <p id={errorId} className="report-field-error" role="alert">{error}</p>}
        </>
      )}
    </article>
  );
}
