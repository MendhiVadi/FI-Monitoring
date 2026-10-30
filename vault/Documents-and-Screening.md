# Documents and screening (v1 spec)
Linked from [[00-Index]]. Owner decision 2026-10-23: this is a mock-up, so Aadhaar copies and numbers may be stored and scanned. Screening only **flags** documents for staff; it never accepts or rejects a case on its own. Only a broken UIDAI QR or PDF signature is labelled "altered"; everything else is "needs review".

## Case types and required documents
Source of truth: `contracts/dispute.json` → `documents` (edit there, then `node scripts/sync-contracts.mjs`).
- Case type comes from the other party's type via `documents.caseTypeByPartyType`: an individual → `person_vs_person`; any government body or "Not sure" → `citizen_vs_government`.
- `citizen_vs_government`: required Aadhaar; optional site photos, notices, ownership papers, land record, police/court papers, other.
- `person_vs_person`: required Aadhaar, PAN, ownership deed, land record extract, proof of possession; optional encumbrance, mutation, survey map, other party's documents, site photos, notices, police/court papers, other.
- Limits: JPEG/PNG/WebP/PDF, ≤ 6 MiB each (`maxFileBytes`), ≤ 12 per case. Several files per kind are allowed.
- Contract `version` is now `2026-10-23` (it is also the consent version), and the privacy policy describes document handling.

## Data model
`caseDocuments/{documentId}` — server-written only; allow-listed officers can read (list queries need `limit <= 100`).
```
submissionId: string            // the report draft's submissionId
phoneHash: string | null        // hashId(phone) when verified; binds the upload to the verifier
ticketId: string | null         // set by submitDispute
status: "pending" | "attached"
kind: string                    // documents.kinds[].id
side: "reporter" | "other_party"
fileName: string                // ≤ 120 chars, sanitised
contentType: string
sizeBytes: number
sha256: string
dhash: string | null            // 64-bit perceptual hash, 16 hex chars; images and first PDF page image only
dhashBands: string[]            // 8 bands of 8 bits, "0:ab".."7:cd"; array-contains-any finds candidates (Hamming ≤ 7 shares a band)
idNumberHash: string | null     // hashId(kind + ":" + normalised number), for cross-case duplicate lookups
reporterNameNorm: string | null // lowercased, accents/punctuation stripped, single spaces
width, height, pageCount: number | null
idNumberFull: string | null     // typed Aadhaar/PAN number (mock-up only)
idNumberMasked: string | null   // "XXXX XXXX 1234" / "ABCDE****F"
uploadedAt: Timestamp
expiresAt: number | null        // ms; pending uploads expire after pendingTtlMinutes
purgeAt: number | null          // ms; set to closedAt + 90 days when the case closes, cleared on reopen
storage: { original: string, ela?: string, faceCard?: string, faceQr?: string }   // object paths
screening: {
  state: "pending" | "done" | "error"
  risk: "low" | "medium" | "high" | "altered" | null
  score: number | null          // 0–100, higher = more suspicious
  summary: string               // one line for staff
  checks: Array<{ id, label, result: "pass"|"warn"|"fail"|"info"|"unavailable", detail }>
  extracted: { qr?: { signatureValid: boolean|null, name, dob, gender, last4, district, state, pincode, hasPhoto },
               ocr?: { text: string (≤ 4000 chars), aadhaarNumbers: string[], panNumbers: string[], dates: string[] } }
  engineVersion: string
  completedAt: Timestamp | null
}
review: { decision: "accepted"|"rejected"|"reupload_requested", reason: string, by: uid, byEmail: string|null, at: Timestamp,
          officerUid, officerEmail, officerName, officerRole,   // wave 2 staff identity
          expiresAt?: number } | null                      // ms; reupload_requested only: the open request's deadline
```
Ticket gains `documents: { caseType, count, kinds: string[], flagged: number }` (flagged = risk high or altered) and `closedAt` (ms) when the status becomes terminal. `listTickets` projects `documents`.

Storage: default bucket, objects under `case-documents/{documentId}/original`, `/ela.png`, `/face-card.jpg`, `/face-qr.jpg`. `storage.rules` deny all client access; everything goes through the Admin SDK.

## Callables (all `invoker: "public"`, `region` like the others)
- `uploadDisputeDocument` (public): `{ submissionId, phone?, verificationToken?, kind, fileName, contentType, dataBase64, idNumber?, reporterName? }` → `{ documentId, screening: { state, userMessages: string[] } }` (no risk level: it would let a forger retry until a fake reads "low").
  When OTP is required, the token must match an **unspent, unexpired** `disputeVerifications` grant whose `phoneHash` matches the phone (checked, not spent). Guest mode binds by submissionId + IP bucket. Limits: 12 pending per submissionId, 40 uploads/day per IP bucket, 60 MiB/day per IP bucket, decoded size ≤ `maxFileBytes`, magic bytes must match the declared type. maxInstances 5, memory 2 GiB, timeout 120 s. Screening runs before returning. `userMessages` are safe to show reporters (e.g. "The QR code could not be read — upload the e-Aadhaar PDF or a sharper photo"); never show scores or forensic detail to reporters.
- `removeDisputeDocument` (public): `{ submissionId, phone?, verificationToken?, documentId }` → `{ removed: true }`; only pending documents of that submission.
- `submitDispute` gains `documentIds: string[]` (≤ 12). Inside the transaction: every id must be a pending document of this submissionId (and same phoneHash when verified) that has not expired; the required kinds for the case type must be present; documents become `attached` with `ticketId`; ticket gets `documents` summary.
- `getCaseDocumentFile` (officer): `{ documentId, variant: "original"|"ela"|"faceCard"|"faceQr" }` → `{ contentType, dataBase64 }`.
- `reviewCaseDocument` (officer, fresh session): `{ documentId, decision, reason (3–500), requestId }` → `{ review }`; writes an immutable ticket event `{ type: "document_review", documentId, kind, decision, reason, actorUid }`, idempotent on requestId.
- `purgeExpiredDocuments` (scheduled, daily, maxInstances 1): deletes Storage objects + records for expired pending uploads and for attached documents past `purgeAt`. Bounded batches, per-collection try/catch like `purgeExpiredOtps`.

## Screening checks (v1)
Each check yields pass / warn / fail / info / unavailable with a plain-language detail. Weights combine into `score` and `risk` (low < 25 ≤ medium < 55 ≤ high; any failed signature → altered).
1. **File integrity** — magic bytes match the type; image decodes; size and dimensions sane (ID images ≥ 600 px on the short side); PDF parses, page count ≤ 20.
2. **Metadata** — EXIF/XMP `Software`/`CreatorTool` naming an editor (Photoshop, GIMP, Canva, PicsArt, Snapseed, Pixlr…) → warn; XMP edit history → warn; modify date after original date → warn; no camera data on a "photo" → info. PDF: Producer/Creator, more than one `%%EOF` (edited after creation/signing) → warn, digital-signature presence → info.
3. **JPEG compression** — quality estimate from quantization tables; tables matching common editor presets / double-compression signs → warn.
4. **Error Level Analysis** — re-encode at quality 90, amplified difference heatmap saved as `ela.png`; strongly localised high-error regions → warn (never fail).
5. **Duplicates** — same `sha256` in another submission → fail; near-identical `dhash` (Hamming ≤ 6) in another submission → warn; same Aadhaar number with a different reporter name → fail.
6. **Aadhaar Secure QR** (kind `aadhaar`) — decode the QR from the image (or the PDF's page images); big-integer → bytes → decompress → 0xFF-separated fields → verify the trailing 256-byte RSA-SHA256 signature with the UIDAI certificate. Valid → pass; invalid → fail (**altered**); no certificate configured → unavailable; unreadable QR → warn + reporter message. Extract name/DOB/gender/last 4/address/photo.
7. **Print vs QR** — OCR the image; the QR name, DOB and last 4 digits must appear in the printed text; mismatch → fail.
8. **Typed and printed ID numbers** — Aadhaar: 12 digits, first digit 2–9, Verhoeff check digit; must match the OCR'd number and the QR last 4. PAN: `AAAAA9999A`, 4th letter `P` for a person, 5th letter = surname initial of the reporter name; must match OCR text.
9. **Name match** — reporter name from the form vs QR name / OCR text (token-based fuzzy match).
10. **Faces** (kind `aadhaar`) — exactly one face on the card; compare with the QR photo (descriptor distance); crops saved as `face-card.jpg` / `face-qr.jpg`. Missing models or decoder → unavailable.

UIDAI certificate: place UIDAI's public certificate for Secure QR at `functions/assets/uidai/uidai-secure-qr.pem` (not committed until the owner downloads it from uidai.gov.in). Tests use a self-generated key pair and a synthetic signed payload.

## Admin Documents tab
In the dossier: a "Documents" section listing each document with kind, side, risk badge, the check list, extracted QR/OCR fields (Aadhaar number masked; "Show full number" reveals it), an inline preview (image or PDF), toggles for the ELA heatmap and the face comparison, and Accept / Reject / Request re-upload with a required reason. Cards in the registry show a flag when `documents.flagged > 0`. Missing required documents (older cases) show as "Not provided".

## Status (2026-10-23)
Built and reviewed. Functions unit tests 37/37, Firestore/Storage emulator tests 34/34, frontend tests 16/16, build and bundle budget pass. Reporter Documents section checked in the browser (case type, required kinds, Aadhaar check, error summary, 375 px). Not yet exercised end to end: a real upload through Firebase Storage, a real e-Aadhaar Secure QR with UIDAI's certificate, face-match thresholds (untuned), and the admin Documents tab in a browser (needs a staff account and backend).

Implementation notes
- Engine: `functions/src/features/documents/screening/` (sharp, exifr, zxing-wasm, pdfjs-dist, tesseract.js with bundled English data, @vladmandic/face-api, OpenJPEG for the QR photo). Every step is time-bounded (55 s engine budget, 80 s hard cap in the service) and fails soft to "unavailable". Adds ~450 MB to `functions/node_modules`; pdfjs-dist needs Node ≥ 22.13.
- Password-protected e-Aadhaar PDFs are tried with UIDAI's pattern (first 4 letters of the name + birth year).
- Hardening from review: VID digits are not mistaken for an Aadhaar number; QR text fields capped at 200 chars; JPEG2000 headers declaring huge images are refused before decoding; incomplete PDF scans are reported; name variants ("Asha Rao" / "Asha S. Rao") don't count as a different person; documents still being screened can't be attached.
- Not done in v1: cryptographic PDF (PKCS#7) signature verification (presence only), DCT double-compression analysis.

Deploy notes
- Deploy Functions + `firestore.rules` + `storage.rules` before the frontend (contract version changed to 2026-10-23, so old tabs must reload). The default Storage bucket must exist.
- Place UIDAI's Secure QR certificate at `functions/assets/uidai/uidai-secure-qr.pem` (download it yourself from uidai.gov.in); until then the QR check reports "unavailable".

## Later (v2)
Copy-move and noise analysis (Python/OpenCV service), selfie with liveness, hologram check from two angles, DigiLocker pull or a KYC vendor for real deployments, PAN/deed QR verification, e-stamp certificate lookups.
