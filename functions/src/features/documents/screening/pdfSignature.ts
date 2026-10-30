import { createHash, webcrypto } from "node:crypto";

type PkiJs = typeof import("pkijs");
type Asn1Js = typeof import("asn1js");
let libraries: { pkijs: PkiJs; asn1js: Asn1Js; engine: InstanceType<PkiJs["CryptoEngine"]> } | null = null;

// Loaded only when a PDF carries a signature; most uploads are photos.
function load() {
  if (!libraries) {
    const pkijs: PkiJs = require("pkijs");
    const asn1js: Asn1Js = require("asn1js");
    // A private engine rather than pkijs's global one, so nothing else is affected.
    libraries = { pkijs, asn1js, engine: new pkijs.CryptoEngine({ name: "node", crypto: webcrypto as never }) };
  }
  return libraries;
}

export interface PdfSignatureVerdict {
  // true: verifies over its ByteRange; false: broken (altered); null: could not be checked.
  valid: boolean | null;
  signer: string | null;
  subFilter: string | null;
  timestamp: boolean;
  // The signed ranges reach the end of the file (no later incremental save).
  coversFile: boolean;
  reason: string;
}

const MAX_SIGNATURES = 4;
// Real signatures, even with embedded revocation data, are well below this.
const MAX_CONTENTS_HEX = 2 * 1024 * 1024;
const BYTE_RANGE = /\/ByteRange\s*\[\s*(\d+)\s+(\d+)\s+(\d+)\s+(\d+)\s*\]/g;

function commonName(certificate: { subject: { typesAndValues: Array<{ type: string; value: { valueBlock: { value?: unknown } } }> } } | null | undefined): string | null {
  const value = certificate?.subject.typesAndValues.find(entry => entry.type === "2.5.4.3")?.value.valueBlock.value;
  const text = typeof value === "string" ? value.replace(/[\u0000-\u001f\u007f]/g, "").trim().slice(0, 120) : "";
  return text || null;
}

// The signature dictionary surrounds /Contents, i.e. the gap between the two
// ranges; its /SubFilter sits just before or just after that gap.
function dictionaryText(raw: string, gapStart: number, gapEnd: number): string {
  return raw.slice(Math.max(0, gapStart - 4096), gapStart) + " " + raw.slice(gapEnd, gapEnd + 4096);
}

function broken(reason: string, extra: Partial<PdfSignatureVerdict> = {}): PdfSignatureVerdict {
  return { valid: false, signer: null, subFilter: null, timestamp: false, coversFile: false, reason, ...extra };
}

async function verifyOne(bytes: Buffer, raw: string, range: number[]): Promise<PdfSignatureVerdict | null> {
  const [a, b, c, d] = range;
  // [0 0 0 0] and similar are placeholders of unsigned signature fields.
  if (b === 0 || (c === 0 && d === 0)) return null;
  if (a !== 0 || a + b > c || c + d > bytes.length) {
    return broken("Its signed byte ranges point outside the file, so the file was cut or rewritten after signing.");
  }
  const gap = bytes.subarray(a + b, c).toString("latin1").trim();
  const subFilter = /\/SubFilter\s*\/([A-Za-z0-9.#_-]+)/.exec(dictionaryText(raw, a + b, c))?.[1] ?? null;
  const timestamp = subFilter === "ETSI.RFC3161" || /\/Type\s*\/DocTimeStamp\b/.test(dictionaryText(raw, a + b, c));
  const coversFile = bytes.subarray(c + d).toString("latin1").replace(/\s+/g, "").length === 0;
  const base = { subFilter, timestamp, coversFile };
  if (!gap.startsWith("<") || !gap.endsWith(">")) {
    return broken("Its signed byte ranges no longer line up with the signature value, so the file was rewritten after signing.", base);
  }
  const hex = gap.slice(1, -1).replace(/\s+/g, "");
  if (hex.length > MAX_CONTENTS_HEX || !/^[0-9A-Fa-f]*$/.test(hex)) return broken("The signature value is malformed.", base);
  const der = Buffer.from(hex.length % 2 ? hex + "0" : hex, "hex");
  if (!der.some(byte => byte !== 0)) return null; // an empty, never-filled placeholder

  const { pkijs, asn1js, engine } = load();
  let signedData: InstanceType<PkiJs["SignedData"]>;
  try {
    // Contents is zero-padded to its reserved size; BER parsing stops at the end of the first element.
    const view = new Uint8Array(der.buffer, der.byteOffset, der.byteLength);
    const parsed = asn1js.fromBER(view);
    if (parsed.offset === -1) throw new Error("not BER");
    const info = new pkijs.ContentInfo({ schema: parsed.result });
    if (info.contentType !== pkijs.ContentInfo.SIGNED_DATA) throw new Error("not SignedData");
    signedData = new pkijs.SignedData({ schema: info.content });
  } catch {
    // Not CMS SignedData (e.g. legacy adbe.x509.rsa_sha1 holds a raw PKCS#1
    // value): a limit of this check, not proof of tampering.
    return { valid: null, signer: null, ...base, reason: "The signature uses a format this check does not support." };
  }
  const signed = Buffer.concat([bytes.subarray(a, a + b), bytes.subarray(c, c + d)]);
  const data = signed.buffer.slice(signed.byteOffset, signed.byteOffset + signed.byteLength) as ArrayBuffer;
  try {
    const result = await signedData.verify({ signer: 0, data, checkChain: false, extendedMode: true }, engine) as { signatureVerified: boolean | null; signerCertificate: unknown };
    const signer = commonName(result.signerCertificate as Parameters<typeof commonName>[0]);
    if (result.signatureVerified !== true) return broken("The signature does not match the signer's certificate.", { ...base, signer });
    // adbe.pkcs7.sha1 signs a SHA-1 digest of the ranges carried inside the CMS,
    // so the signature alone does not prove the ranges are unchanged.
    if (subFilter === "adbe.pkcs7.sha1") {
      const content = signedData.encapContentInfo.eContent?.getValue();
      const digest = content ? Buffer.from(content) : null;
      if (!digest || !digest.equals(createHash("sha1").update(signed).digest())) {
        return broken("The signed digest does not match the file's signed bytes.", { ...base, signer });
      }
    }
    return { valid: true, signer, ...base, reason: "" };
  } catch (err) {
    const failure = err as { message?: unknown; signerCertificate?: unknown };
    const message = typeof failure?.message === "string" ? failure.message : "";
    const signer = commonName(failure?.signerCertificate as Parameters<typeof commonName>[0]);
    // Only a digest mismatch proves the bytes changed; anything else (missing
    // certificate, unsupported algorithm) is a limit of this check, not tampering.
    if (/digest doesn't match|TSTInfo verification is failed/i.test(message)) {
      return broken("The signed bytes were changed after signing (the digest no longer matches).", { ...base, signer });
    }
    return { valid: null, signer, ...base, reason: /certificate/i.test(message) ? "The signer's certificate is not embedded." : "The signature uses a format this check does not support." };
  }
}

// Verifies each CMS / PKCS#7 signature over its /ByteRange. The signer's
// certificate is not chained to a trusted root, so a valid signature proves
// integrity since signing, not who the signer is.
export async function verifyPdfSignatures(bytes: Buffer): Promise<PdfSignatureVerdict[]> {
  const raw = bytes.toString("latin1");
  const verdicts: PdfSignatureVerdict[] = [];
  const seen = new Set<string>();
  for (const match of raw.matchAll(BYTE_RANGE)) {
    const key = match.slice(1, 5).join(" ");
    if (seen.has(key)) continue;
    seen.add(key);
    const verdict = await verifyOne(bytes, raw, match.slice(1, 5).map(Number));
    if (verdict) verdicts.push(verdict);
    if (verdicts.length >= MAX_SIGNATURES) break;
  }
  return verdicts;
}
