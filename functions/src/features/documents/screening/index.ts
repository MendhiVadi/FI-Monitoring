import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import contract from "../../../platform/contracts/dispute.json";
import { hashId } from "../../otp/identity";
import { decodeAadhaarQr, uidaiPublicKey, type SecureQrResult } from "./aadhaarQr";
import { descriptorDistance, faceModelDir, scanFaces, type FaceScan } from "./faces";
import { isValidAadhaar, isValidPan, nameMatchScore, normaliseIdNumber, normaliseName, surnameInitial } from "./idNumbers";
import { digitsOnly, extractIdentifiers } from "./textFields";
import { dHash, dHashBands, errorLevelAnalysis, estimateJpegQuality, openImage, readJpegStructure, sharpness, type RawImage } from "./imaging";
import { decodeJpeg2000 } from "./jpeg2000";
import { IMAGE_EDITORS, PDF_EDITORS, pdfDate, readImageMetadata } from "./metadata";
import { recognise, tessdataDir } from "./ocr";
import { analysePdf, type PdfAnalysis, type PdfImage } from "./pdf";
import { readQrCode } from "./qrReader";
import { assetPath, errorName, StepTimeout, withTimeout } from "./runtime";

export const ENGINE_VERSION = "screening-2026-10-23.1";

export type CheckResult = "pass" | "warn" | "fail" | "info" | "unavailable";
export interface ScreeningCheck { id: string; label: string; result: CheckResult; detail: string }
export interface ScreeningInput { bytes: Buffer; contentType: string; kind: string; idNumber?: string | null; reporterName?: string | null }
export interface DuplicateReport { exactMatches: number; nearMatches: number; sameIdDifferentName: number }
export interface ScreeningDeps {
  // Implemented by documents-backend with Firestore; must exclude documents of the same submission.
  findDuplicates(q: { sha256: string; dhash: string | null; dhashBands: string[]; idNumberHash: string | null; reporterNameNorm: string | null }): Promise<DuplicateReport>;
  uidaiCertPem: string | null;
}
export interface DerivedFile { key: "ela" | "faceCard" | "faceQr"; contentType: string; bytes: Buffer }
export interface ScreeningOutput {
  risk: "low" | "medium" | "high" | "altered"; score: number; summary: string; userMessages: string[];
  checks: ScreeningCheck[];
  extracted: { qr?: { signatureValid: boolean | null; name: string | null; dob: string | null; gender: string | null; last4: string | null; district: string | null; state: string | null; pincode: string | null; hasPhoto: boolean };
               ocr?: { text: string; aadhaarNumbers: string[]; panNumbers: string[]; dates: string[] } };
  sha256: string; dhash: string | null; dhashBands: string[]; idNumberHash: string | null; reporterNameNorm: string | null;
  width: number | null; height: number | null; pageCount: number | null; derived: DerivedFile[];
}

// Whole-run budget keeps a 6 MiB upload inside the callable's 120 s timeout.
const TOTAL_BUDGET_MS = 55_000;
const MIN_ID_SHORT_SIDE = 600;
const MAX_PDF_PAGES = 20;
const OCR_TEXT_LIMIT = 4000;

const LABELS: Record<string, string> = {
  integrity: "File integrity", metadata: "Metadata", jpeg: "JPEG compression", ela: "Error level analysis",
  duplicates: "Duplicates", aadhaar_qr: "Aadhaar Secure QR", print_vs_qr: "Printed text vs QR",
  id_numbers: "ID numbers", name_match: "Name match", faces: "Faces",
};
// Points added per check; risk bands are low < 25 <= medium < 55 <= high.
const WEIGHTS: Record<string, { warn: number; fail: number }> = {
  integrity: { warn: 10, fail: 40 }, metadata: { warn: 15, fail: 15 }, jpeg: { warn: 10, fail: 10 }, ela: { warn: 15, fail: 15 },
  duplicates: { warn: 25, fail: 60 }, aadhaar_qr: { warn: 15, fail: 45 }, print_vs_qr: { warn: 10, fail: 40 },
  id_numbers: { warn: 10, fail: 35 }, name_match: { warn: 10, fail: 30 }, faces: { warn: 10, fail: 30 },
};
const SEVERITY: Record<CheckResult, number> = { fail: 4, warn: 3, pass: 2, info: 1, unavailable: 0 };

const MESSAGES = {
  wrongType: "This file is not a readable JPEG, PNG, WebP or PDF. Export it again in one of those formats.",
  small: "The image is too small to read. Upload a larger photo or the original PDF.",
  blurry: "The image looks blurry. Take a sharper photo in good light, holding the document flat.",
  qr: "The QR code could not be read — upload the e-Aadhaar PDF or a sharper photo of the side with the QR code.",
  locked: "This PDF is password-protected. Upload a copy without a password, or a photo of the document.",
  unreadablePdf: "This PDF could not be opened. Export or download it again and re-upload.",
};

const ID_NUMBER_KIND = new Map<string, string>(
  (contract.documents.kinds as Array<{ id: string; idNumber?: string }>).filter(kind => kind.idNumber).map(kind => [kind.id, kind.idNumber as string]),
);
// Kinds where text is not expected, so OCR and name checks are skipped.
const PICTURE_KINDS = new Set(["site_photo"]);

export function sniffContentType(bytes: Buffer): string | null {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
  if (bytes.length >= 8 && bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return "image/png";
  if (bytes.length >= 12 && bytes.toString("latin1", 0, 4) === "RIFF" && bytes.toString("latin1", 8, 12) === "WEBP") return "image/webp";
  // The PDF header may follow a little leading junk; readers accept it within 1 KiB.
  const head = bytes.subarray(0, 1024).indexOf("%PDF-", 0, "latin1");
  if (head >= 0) return "application/pdf";
  return null;
}

let certificate: { pem: string | null } | null = null;
export function loadUidaiCertificate(): string | null {
  if (certificate) return certificate.pem;
  const file = assetPath("uidai", "uidai-secure-qr.pem");
  let pem: string | null = null;
  try {
    const text = existsSync(file) ? readFileSync(file, "utf8") : "";
    pem = /-----BEGIN (CERTIFICATE|PUBLIC KEY)-----/.test(text) && uidaiPublicKey(text) ? text : null;
  } catch {
    pem = null;
  }
  certificate = { pem };
  return pem;
}

interface Finding { result: CheckResult; text: string }
function combine(parts: Finding[], fallback: Finding): Finding {
  if (!parts.length) return fallback;
  const result = parts.reduce<CheckResult>((worst, part) => (SEVERITY[part.result] > SEVERITY[worst] ? part.result : worst), parts[0].result);
  return { result, text: parts.map(part => part.text).join(" ") };
}

function sameDate(a: string, b: string): boolean {
  const da = digitsOnly(a), db = digitsOnly(b);
  if (da.length === 4 || db.length === 4) return da.slice(-4) === db.slice(-4);
  return da === db;
}

function logStep(step: string, err: unknown) {
  console.warn("Document screening step failed", { step, error: errorName(err) });
}

export async function screenDocument(input: ScreeningInput, deps: ScreeningDeps): Promise<ScreeningOutput> {
  const deadline = Date.now() + TOTAL_BUDGET_MS;
  const budget = (ms: number) => Math.max(500, Math.min(ms, deadline - Date.now()));
  const { bytes, kind } = input;
  const checks: ScreeningCheck[] = [];
  const userMessages = new Set<string>();
  const derived: DerivedFile[] = [];
  const add = (id: string, part: Finding) => checks.push({ id, label: LABELS[id], result: part.result, detail: part.text });
  const idType = ID_NUMBER_KIND.get(kind) ?? null;
  const textKind = !PICTURE_KINDS.has(kind);
  const reporterName = input.reporterName?.trim() || null;
  const reporterNameNorm = reporterName ? normaliseName(reporterName) || null : null;

  const sha256 = createHash("sha256").update(bytes).digest("hex");
  const sniffed = sniffContentType(bytes);
  const isPdf = sniffed === "application/pdf";
  const isImage = !!sniffed && sniffed.startsWith("image/");
  let width: number | null = null, height: number | null = null, pageCount: number | null = null;
  let primary: Buffer | RawImage | null = null;
  let pdf: PdfAnalysis | null = null;

  // 1. File integrity
  {
    const parts: Finding[] = [];
    if (!sniffed) {
      parts.push({ result: "fail", text: "The content is not a JPEG, PNG, WebP or PDF file." });
      userMessages.add(MESSAGES.wrongType);
    } else if (sniffed !== input.contentType) {
      parts.push({ result: "fail", text: `Declared as ${input.contentType} but the content is ${sniffed}.` });
      userMessages.add(MESSAGES.wrongType);
    }
    if (isImage) {
      try {
        const meta = await openImage(bytes).metadata();
        const rotated = (meta.orientation ?? 1) >= 5;
        width = (rotated ? meta.height : meta.width) ?? null;
        height = (rotated ? meta.width : meta.height) ?? null;
        await openImage(bytes).resize(64, 64, { fit: "inside" }).raw().toBuffer(); // full decode surfaces truncation
        primary = bytes;
        parts.push({ result: "pass", text: `Image decodes (${width}×${height}).` });
        const shortSide = Math.min(width ?? 0, height ?? 0);
        if (idType && shortSide < MIN_ID_SHORT_SIDE) {
          parts.push({ result: "warn", text: `Too small for an ID document (${shortSide} px short side; at least ${MIN_ID_SHORT_SIDE} needed).` });
          userMessages.add(MESSAGES.small);
        }
        const focus = await sharpness(bytes);
        if (textKind && focus < 40) {
          parts.push({ result: "warn", text: `Looks blurry (sharpness ${Math.round(focus)}).` });
          userMessages.add(MESSAGES.blurry);
        }
      } catch (err) {
        logStep("integrity", err);
        parts.push({ result: "fail", text: "The image could not be decoded; it may be truncated or corrupt." });
        userMessages.add(MESSAGES.wrongType);
      }
    } else if (isPdf) {
      try {
        pdf = await analysePdf(bytes, { reporterName, timeoutMs: budget(15_000) });
        pageCount = pdf.pageCount;
        if (pdf.opened) {
          parts.push({ result: "pass", text: `PDF opens (${pageCount} page${pageCount === 1 ? "" : "s"}${pdf.unlockedWithDerivedPassword ? ", unlocked with the e-Aadhaar password pattern" : ""}).` });
          if ((pageCount ?? 0) > MAX_PDF_PAGES) parts.push({ result: "warn", text: `More than ${MAX_PDF_PAGES} pages.` });
          if (pdf.imagesSkipped) parts.push({ result: "info", text: "Embedded images are too large to decode safely, so page images were not analysed." });
          if (pdf.incomplete) parts.push({ result: "warn", text: "Analysis stopped early because the PDF is very large or complex; check the remaining pages by hand." });
          const firstPage = pdf.images.filter(image => image.page === 1).sort((a, b) => b.width * b.height - a.width * a.height)[0];
          if (firstPage) primary = firstPage;
        } else {
          parts.push({ result: "warn", text: "Password-protected PDF; its pages could not be checked." });
          userMessages.add(MESSAGES.locked);
        }
      } catch (err) {
        logStep("pdf", err);
        if (err instanceof StepTimeout || errorName(err) === "PdfTooComplex") {
          parts.push({ result: "warn", text: "The PDF is too large or complex to analyse automatically; check it by hand." });
        } else {
          parts.push({ result: "fail", text: "The PDF could not be parsed." });
          userMessages.add(MESSAGES.unreadablePdf);
        }
      }
    }
    add("integrity", combine(parts, { result: "fail", text: "The file could not be read." }));
  }

  // 2. Metadata
  if (isImage) {
    try {
      const meta = await readImageMetadata(bytes);
      const parts: Finding[] = [];
      const tool = [meta.software, meta.creatorTool].find(value => value && IMAGE_EDITORS.test(value));
      if (tool) parts.push({ result: "warn", text: `Saved with editing software (${tool.slice(0, 80)}).` });
      else if (meta.photoshop) parts.push({ result: "warn", text: "Contains Photoshop metadata." });
      const edits = meta.historyActions.filter(action => /saved|converted|derived|edited|produced/i.test(action));
      if (edits.length > 1) parts.push({ result: "warn", text: `XMP edit history lists ${edits.length} steps.` });
      if (meta.original && meta.modified && meta.modified.getTime() - meta.original.getTime() > 60_000) {
        parts.push({ result: "warn", text: "Modified after the picture was taken." });
      }
      if (!meta.make && !meta.model) parts.push({ result: "info", text: "No camera details (a screenshot, scan, forwarded copy or stripped metadata)." });
      add("metadata", combine(parts, { result: "pass", text: `Camera: ${[meta.make, meta.model].filter(Boolean).join(" ")}; no editing traces.` }));
    } catch (err) {
      logStep("metadata", err);
      add("metadata", { result: "unavailable", text: "Metadata could not be read." });
    }
  } else if (pdf) {
    const parts: Finding[] = [];
    const tool = [pdf.producer, pdf.creator].find(value => value && PDF_EDITORS.test(value));
    if (tool) parts.push({ result: "warn", text: `Produced with editing software (${tool.slice(0, 80)}).` });
    if (pdf.signatureCount) {
      parts.push({ result: "info", text: `Digitally signed (${pdf.signatureCount} signature${pdf.signatureCount === 1 ? "" : "s"}; not cryptographically verified in this version).` });
      if (pdf.bytesAfterSignature > 0) parts.push({ result: "warn", text: "Content was added after the last signature." });
    }
    const expectedSaves = (pdf.signatureCount ? pdf.signatureCount + 1 : 1) + (pdf.linearized ? 1 : 0);
    if (pdf.eofCount > expectedSaves) {
      parts.push({ result: "warn", text: `Saved ${pdf.eofCount} times (incremental updates: edited after it was created).` });
    }
    const created = pdfDate(pdf.creationDate), modified = pdfDate(pdf.modDate);
    if (created && modified && modified.getTime() - created.getTime() > 60_000) parts.push({ result: "info", text: "Modification date is later than the creation date." });
    if (pdf.encrypted) parts.push({ result: "info", text: "Encrypted PDF." });
    const origin = [pdf.producer, pdf.creator].filter(Boolean).join(" / ");
    add("metadata", combine(parts, { result: "pass", text: origin ? `Producer: ${origin.slice(0, 120)}; saved once.` : "No editing traces; saved once." }));
  } else {
    add("metadata", { result: "unavailable", text: "Unsupported file; metadata not checked." });
  }

  // 3. JPEG compression
  if (sniffed === "image/jpeg") {
    try {
      const structure = readJpegStructure(bytes);
      const estimate = estimateJpegQuality(structure.tables);
      const parts: Finding[] = [];
      if (structure.appSegments.some(segment => segment.startsWith("APP13:Photoshop"))) parts.push({ result: "warn", text: "Contains a Photoshop resource block (written by Adobe Photoshop and some other editors)." });
      if (structure.appSegments.some(segment => segment.startsWith("APP12:Ducky"))) parts.push({ result: "warn", text: "Saved through an editor's “save for web” export." });
      if (estimate) {
        if (estimate.quality < 60) parts.push({ result: "warn", text: `Heavily compressed (quality ≈ ${estimate.quality}); fine edits may be hidden.` });
        else if (!estimate.standard && estimate.chromaQuality !== null && Math.abs(estimate.lumaQuality - estimate.chromaQuality) > 15) {
          parts.push({ result: "info", text: `Brightness and colour tables come from different quality levels (${estimate.lumaQuality}/${estimate.chromaQuality}); typical of editor presets or camera firmware.` });
        }
      }
      const fallback: Finding = estimate
        ? { result: "pass", text: `Quality ≈ ${estimate.quality} (${estimate.standard ? "standard encoder tables" : "camera or app specific tables"}).` }
        : { result: "info", text: "No quantisation tables found." };
      add("jpeg", parts.length ? combine([...parts, fallback], fallback) : fallback);
    } catch (err) {
      logStep("jpeg", err);
      add("jpeg", { result: "unavailable", text: "JPEG structure could not be read." });
    }
  } else {
    add("jpeg", { result: "info", text: isPdf ? "PDF; compression of embedded images is not analysed." : "Not a JPEG file." });
  }

  // Perceptual hash and 4. ELA run on the image, or the PDF's first-page image.
  let dhash: string | null = null;
  if (primary) {
    try { dhash = await dHash(primary); } catch (err) { logStep("dhash", err); }
    try {
      const ela = await withTimeout("ela", budget(8_000), () => errorLevelAnalysis(primary as Buffer | RawImage));
      derived.push({ key: "ela", contentType: "image/png", bytes: ela.heatmap });
      add("ela", ela.localised
        ? { result: "warn", text: `A few regions recompress very differently from the rest (peak ${ela.peakRatio.toFixed(1)}× typical); compare the heatmap with the original.` }
        : { result: "pass", text: "Recompression error is even across the image." });
    } catch (err) {
      logStep("ela", err);
      add("ela", { result: "unavailable", text: "Error level analysis could not run." });
    }
  } else {
    add("ela", { result: "unavailable", text: isPdf ? "No page image to analyse (text-only or locked PDF)." : "No decodable image." });
  }

  // 6. Aadhaar Secure QR
  let qr: SecureQrResult | null = null;
  let qrImage: PdfImage | null = null;
  const pdfImages = pdf ? [...pdf.images].sort((a, b) => b.width * b.height - a.width * a.height) : [];
  if (kind === "aadhaar") {
    let content: string | null = null;
    try {
      await withTimeout("qr", budget(12_000), async () => {
        if (isImage) content = await readQrCode(bytes);
        // QR images are square; try those first, then the rest.
        const squareFirst = [...pdfImages].sort((a, b) => Number(Math.abs(a.width / a.height - 1) > 0.2) - Number(Math.abs(b.width / b.height - 1) > 0.2));
        for (const image of squareFirst.slice(0, 5)) {
          if (content) break;
          content = await readQrCode(image);
          if (content) qrImage = image;
        }
      });
    } catch (err) {
      logStep("qr", err);
    }
    if (!content) {
      add("aadhaar_qr", { result: "warn", text: isPdf && pdf && !pdf.opened ? "The PDF is locked, so its QR code could not be read." : "No QR code could be read from this file." });
      userMessages.add(isPdf && pdf && !pdf.opened ? MESSAGES.locked : MESSAGES.qr);
    } else {
      try {
        qr = decodeAadhaarQr(content, deps.uidaiCertPem);
        if (!qr) add("aadhaar_qr", { result: "warn", text: "A QR code was read, but it is not an Aadhaar QR code." });
        else if (qr.fields.format === "xml") add("aadhaar_qr", { result: "warn", text: "Older unsigned Aadhaar QR (pre-2018); its details cannot be verified cryptographically." });
        else if (qr.signatureValid === null) add("aadhaar_qr", { result: "unavailable", text: "Secure QR read, but no UIDAI certificate is configured to verify its signature." });
        else if (qr.signatureValid) add("aadhaar_qr", { result: "pass", text: "Secure QR signature verified against the UIDAI certificate." });
        else add("aadhaar_qr", { result: "fail", text: "Secure QR signature does not match the UIDAI certificate: the QR data was altered or fabricated." });
      } catch (err) {
        logStep("qr-decode", err);
        add("aadhaar_qr", { result: "fail", text: "The QR looks like an Aadhaar Secure QR but its data is corrupt." });
      }
    }
  }
  const qrFields = qr?.fields ?? null;

  // OCR (worker thread) and faces (main thread) overlap.
  const ownText = pdf && pdf.text.replace(/\s/g, "").length >= 80 ? pdf.text : null;
  const ocrSource: Buffer | RawImage | null = ownText ? null : (qrImage && pdfImages.find(image => image !== qrImage)) || primary;
  const ocrWork: Promise<{ text: string; confidence: number; from: "pdf" | "ocr" } | null> = !textKind
    ? Promise.resolve(null)
    : ownText
      ? Promise.resolve({ text: ownText, confidence: 100, from: "pdf" as const })
      : ocrSource && tessdataDir()
        ? recognise(ocrSource, budget(25_000)).then(result => ({ ...result, from: "ocr" as const })).catch(err => { logStep("ocr", err); return null; })
        : Promise.resolve(null);
  const faceWork: Promise<{ card: FaceScan[]; photo: FaceScan | null } | "unavailable" | null> = kind !== "aadhaar"
    ? Promise.resolve(null)
    : !faceModelDir()
      ? Promise.resolve("unavailable" as const)
      : withTimeout("faces", budget(20_000), async () => {
        const sources: Array<Buffer | RawImage> = isImage ? [bytes] : pdfImages.filter(image => image !== qrImage).slice(0, 4);
        const card: FaceScan[] = [];
        for (const source of sources) card.push(await scanFaces(source));
        let photo: FaceScan | null = null;
        if (qrFields?.photo) {
          const decoded = await decodeJpeg2000(qrFields.photo).catch(err => { logStep("jpeg2000", err); return null; });
          if (decoded) photo = await scanFaces(decoded, { wholeIfNone: true });
        }
        return { card, photo };
      }).catch(err => { logStep("faces", err); return "unavailable" as const; });
  const [ocr, faces] = await Promise.all([ocrWork, faceWork]);

  const text = ocr?.text ?? "";
  const ids = extractIdentifiers(text);
  const extracted: ScreeningOutput["extracted"] = {};
  if (qrFields) {
    extracted.qr = {
      signatureValid: qr?.signatureValid ?? null, name: qrFields.name, dob: qrFields.dob, gender: qrFields.gender, last4: qrFields.last4,
      district: qrFields.district, state: qrFields.state, pincode: qrFields.pincode, hasPhoto: !!qrFields.photo,
    };
  }
  if (ocr && text.trim()) {
    extracted.ocr = { text: text.slice(0, OCR_TEXT_LIMIT), aadhaarNumbers: ids.aadhaarNumbers, panNumbers: ids.panNumbers, dates: ids.dates };
  }
  const textSource = ocr?.from === "pdf" ? "PDF text" : "OCR text";

  // 7. Printed text vs QR
  if (kind === "aadhaar") {
    if (!qrFields) add("print_vs_qr", { result: "unavailable", text: "No QR data to compare with." });
    else if (!text.trim()) add("print_vs_qr", { result: "unavailable", text: tessdataDir() ? "No printed text could be read." : "OCR language data is missing." });
    else {
      const parts: Finding[] = [];
      const missing: string[] = [];
      if (qrFields.name && nameMatchScore(qrFields.name, text) < 0.75) missing.push("name");
      if (qrFields.dob) {
        if (ids.dobs.length && !ids.dobs.some(dob => sameDate(dob, qrFields.dob as string))) parts.push({ result: "fail", text: "The printed date of birth differs from the QR." });
        else if (!digitsOnly(text).includes(digitsOnly(qrFields.dob))) missing.push("date of birth");
      }
      if (qrFields.last4) {
        const printed = [...ids.aadhaarNumbers.map(number => number.slice(-4)), ...ids.maskedLast4];
        if (ids.aadhaarNumbers.length && !printed.includes(qrFields.last4)) parts.push({ result: "fail", text: "The printed Aadhaar number does not end with the QR's last 4 digits." });
        else if (!printed.includes(qrFields.last4)) missing.push("last 4 digits");
      }
      if (missing.length) parts.push({ result: "warn", text: `Not found in the ${textSource}: ${missing.join(", ")}.` });
      add("print_vs_qr", combine(parts, { result: "pass", text: `QR name, date of birth and last 4 digits appear in the ${textSource}.` }));
    }
  }

  // 8. Typed and printed ID numbers
  let idNumberHash: string | null = null;
  if (idType) {
    const typed = input.idNumber ? normaliseIdNumber(idType, input.idNumber) : "";
    const parts: Finding[] = [];
    let hashable: string | null = null;
    if (idType === "aadhaar") {
      if (!typed) parts.push({ result: "info", text: "No Aadhaar number was typed." });
      else if (!isValidAadhaar(typed)) parts.push({ result: "fail", text: "The typed number is not a valid Aadhaar number (format or check digit)." });
      else {
        hashable = typed;
        if (ids.aadhaarNumbers.length && !ids.aadhaarNumbers.includes(typed)) parts.push({ result: "fail", text: `The typed number differs from the number in the ${textSource}.` });
        else if (ids.aadhaarNumbers.includes(typed)) parts.push({ result: "pass", text: `The typed number matches the ${textSource}.` });
        else parts.push({ result: "info", text: "The full number could not be read from the document." });
        if (qrFields?.last4) {
          parts.push(qrFields.last4 === typed.slice(-4)
            ? { result: "pass", text: "Last 4 digits match the QR." }
            : { result: "fail", text: "Last 4 digits differ from the QR." });
        }
      }
      if (!hashable && ids.aadhaarNumbers.length === 1) hashable = ids.aadhaarNumbers[0];
    } else if (idType === "pan") {
      if (!typed) parts.push({ result: "info", text: "No PAN was typed." });
      else if (!isValidPan(typed)) parts.push({ result: "fail", text: "The typed PAN does not have the AAAAA9999A format." });
      else {
        hashable = typed;
        if (typed[3] !== "P") parts.push({ result: "warn", text: "The 4th letter shows this PAN does not belong to an individual." });
        const initial = reporterName ? surnameInitial(reporterName) : null;
        if (initial && typed[3] === "P" && typed[4] !== initial) parts.push({ result: "warn", text: "The 5th letter does not match the reporter's surname initial." });
        if (ids.panNumbers.length && !ids.panNumbers.includes(typed)) parts.push({ result: "fail", text: `The typed PAN differs from the PAN in the ${textSource}.` });
        else if (ids.panNumbers.includes(typed)) parts.push({ result: "pass", text: `The typed PAN matches the ${textSource}.` });
        else parts.push({ result: "info", text: "The PAN could not be read from the document." });
      }
      if (!hashable && ids.panNumbers.length === 1) hashable = ids.panNumbers[0];
    }
    if (hashable) {
      try { idNumberHash = hashId(`${kind}:${hashable}`); } catch (err) { logStep("id-hash", err); }
    }
    add("id_numbers", combine(parts, { result: "unavailable", text: "No ID number to check." }));
  }

  // 9. Name match
  if (textKind) {
    if (!reporterName) add("name_match", { result: "unavailable", text: "No reporter name to compare." });
    else if (qrFields?.name) {
      const score = nameMatchScore(reporterName, qrFields.name);
      add("name_match", score >= 0.75 ? { result: "pass", text: "Reporter name matches the QR name." }
        : score >= 0.5 ? { result: "warn", text: "Reporter name only partly matches the QR name." }
          : { result: "fail", text: "Reporter name does not match the QR name." });
    } else if (text.trim()) {
      const score = nameMatchScore(reporterName, text);
      add("name_match", score >= 0.75 ? { result: "pass", text: `Reporter name appears in the ${textSource}.` }
        : { result: "warn", text: `Reporter name was not found in the ${textSource}${ocr?.from === "ocr" ? " (OCR may have misread it)" : ""}.` });
    } else {
      add("name_match", { result: "unavailable", text: "No name could be read from the document." });
    }
  }

  // 10. Faces
  if (kind === "aadhaar") {
    if (faces === "unavailable" || faces === null) add("faces", { result: "unavailable", text: "Face models are missing or face detection could not run." });
    else if (!faces.card.length) add("faces", { result: "unavailable", text: "No decodable image to look for faces in." });
    else {
      const parts: Finding[] = [];
      const count = faces.card.reduce((sum, scan) => sum + scan.faces.length, 0);
      const best = faces.card.find(scan => scan.descriptor);
      if (count === 0) parts.push({ result: "warn", text: "No face found on the card." });
      else if (count > 1) parts.push({ result: "warn", text: `${count} faces found (a ghost photo or the e-Aadhaar letter can repeat the same face).` });
      else parts.push({ result: "pass", text: "Exactly one face on the card." });
      if (best?.crop) derived.push({ key: "faceCard", contentType: "image/jpeg", bytes: best.crop });
      if (faces.photo?.crop) derived.push({ key: "faceQr", contentType: "image/jpeg", bytes: faces.photo.crop });
      if (best?.descriptor && faces.photo?.descriptor) {
        const distance = descriptorDistance(best.descriptor, faces.photo.descriptor);
        // No face was detected in the QR photo, so its descriptor is of the whole,
        // unaligned image: too rough to call a mismatch on its own.
        const aligned = faces.photo.faces.length > 0;
        parts.push(distance < 0.55 ? { result: "pass", text: `Card face matches the QR photo (distance ${distance.toFixed(2)}).` }
          : distance < 0.7 ? { result: "warn", text: `Card face is only loosely similar to the QR photo (distance ${distance.toFixed(2)}).` }
            : !aligned ? { result: "warn", text: `Card face does not clearly match the QR photo (distance ${distance.toFixed(2)}; no face was found in the QR photo, so this is a rough comparison).` }
              : { result: "fail", text: `Card face does not match the QR photo (distance ${distance.toFixed(2)}).` });
      } else if (qrFields?.photo) {
        parts.push({ result: "info", text: "The QR photo could not be compared." });
      }
      add("faces", combine(parts, { result: "unavailable", text: "No faces to compare." }));
    }
  }

  // 5. Duplicates (after OCR, which may supply the ID number)
  try {
    const report = await withTimeout("duplicates", budget(8_000), () => deps.findDuplicates({ sha256, dhash, dhashBands: dhash ? dHashBands(dhash) : [], idNumberHash, reporterNameNorm }));
    const parts: Finding[] = [];
    if (report.exactMatches) parts.push({ result: "fail", text: `The same file was uploaded with ${report.exactMatches} other report${report.exactMatches === 1 ? "" : "s"}.` });
    if (report.sameIdDifferentName) parts.push({ result: "fail", text: "The same ID number was used by a reporter with a different name." });
    if (report.nearMatches) parts.push({ result: "warn", text: `Looks nearly identical to ${report.nearMatches} file${report.nearMatches === 1 ? "" : "s"} in other reports.` });
    checks.splice(4, 0, { id: "duplicates", label: LABELS.duplicates, ...toCheck(combine(parts, { result: "pass", text: "Not seen in other reports." })) });
  } catch (err) {
    logStep("duplicates", err);
    checks.splice(4, 0, { id: "duplicates", label: LABELS.duplicates, result: "unavailable", detail: "The duplicate lookup could not run." });
  }

  const score = Math.min(100, checks.reduce((sum, check) => {
    const weight = WEIGHTS[check.id];
    return sum + (check.result === "fail" ? weight.fail : check.result === "warn" ? weight.warn : 0);
  }, 0));
  const altered = qr?.signatureValid === false;
  const risk: ScreeningOutput["risk"] = altered ? "altered" : score >= 55 ? "high" : score >= 25 ? "medium" : "low";
  return {
    risk, score: altered ? 100 : score, summary: summarise(risk, altered ? 100 : score, checks), userMessages: [...userMessages], checks, extracted,
    sha256, dhash, dhashBands: dhash ? dHashBands(dhash) : [], idNumberHash, reporterNameNorm,
    width, height, pageCount, derived,
  };
}

function toCheck(part: Finding): { result: CheckResult; detail: string } {
  return { result: part.result, detail: part.text };
}

function summarise(risk: ScreeningOutput["risk"], score: number, checks: ScreeningCheck[]): string {
  if (risk === "altered") return "Altered: the Aadhaar QR signature does not verify against UIDAI's certificate.";
  const issues = checks.filter(check => check.result === "fail" || check.result === "warn")
    .sort((a, b) => SEVERITY[b.result] - SEVERITY[a.result] || WEIGHTS[b.id].fail - WEIGHTS[a.id].fail)
    .slice(0, 3)
    .map(check => `${check.label}: ${check.detail.split(/(?<=\.)\s/)[0].replace(/\.$/, "")}`);
  const band = `${risk[0].toUpperCase()}${risk.slice(1)} risk (${score})`;
  return issues.length ? `${band}. ${issues.join("; ")}.` : `${band}. No problems found by the automated checks.`;
}
