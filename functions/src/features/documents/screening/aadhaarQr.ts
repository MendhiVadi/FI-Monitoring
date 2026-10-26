import { X509Certificate, createPublicKey, verify, type KeyObject } from "node:crypto";
import { gunzipSync, inflateRawSync, inflateSync, constants as zlib } from "node:zlib";

export interface SecureQrFields {
  format: "secure_v1" | "secure_v2" | "xml";
  referenceId: string | null;
  last4: string | null;
  name: string | null;
  dob: string | null;
  gender: string | null;
  careOf: string | null;
  district: string | null;
  landmark: string | null;
  house: string | null;
  location: string | null;
  pincode: string | null;
  postOffice: string | null;
  state: string | null;
  street: string | null;
  subDistrict: string | null;
  vtc: string | null;
  photo: Buffer | null;
  // Exactly the bytes UIDAI signed, and the trailing RSA signature.
  signedData: Buffer | null;
  signature: Buffer | null;
}

export interface SecureQrResult {
  fields: SecureQrFields;
  // null: no certificate configured, or the legacy XML QR that carries no signature.
  signatureValid: boolean | null;
}

const SIGNATURE_BYTES = 256;
const TEXT_FIELDS = ["name", "dob", "gender", "careOf", "district", "landmark", "house", "location", "pincode",
  "postOffice", "state", "street", "subDistrict", "vtc"] as const;

export function secureQrBytes(text: string): Buffer | null {
  const digits = text.trim();
  if (!/^\d{200,}$/.test(digits)) return null;
  let hex = BigInt(digits).toString(16);
  if (hex.length % 2) hex = "0" + hex;
  return Buffer.from(hex, "hex");
}

// Real payloads are a few KiB; the cap stops a crafted QR from inflating without bound.
const MAX_PAYLOAD_BYTES = 1 << 20;

export function decompressSecureQr(bytes: Buffer): Buffer {
  const strict = { maxOutputLength: MAX_PAYLOAD_BYTES };
  const tolerant = { finishFlush: zlib.Z_SYNC_FLUSH, maxOutputLength: MAX_PAYLOAD_BYTES };
  for (const attempt of [() => gunzipSync(bytes, strict), () => gunzipSync(bytes, tolerant), () => inflateSync(bytes, tolerant), () => inflateRawSync(bytes, tolerant)]) {
    try {
      const out = attempt();
      if (out.length) return out;
    } catch { /* try the next container */ }
  }
  throw new Error("Secure QR payload did not decompress");
}

// Real fields are short; a crafted payload can inflate one to the full cap,
// which would not fit in the document record.
const MAX_FIELD_CHARS = 200;

function text(value: Buffer | undefined): string | null {
  const decoded = value?.subarray(0, MAX_FIELD_CHARS * 2).toString("latin1").trim().slice(0, MAX_FIELD_CHARS);
  return decoded ? decoded : null;
}

// UIDAI Secure QR: 0xFF-separated ISO-8859-1 fields. V2 starts with "V2" and adds
// the mobile's last 4 digits; the JPEG 2000 photo follows the last text field,
// then optional SHA-256 email/mobile hashes, then a 256-byte SHA256withRSA signature.
export function parseSecureQrPayload(data: Buffer): SecureQrFields {
  if (data.length <= SIGNATURE_BYTES + 16) throw new Error("Secure QR payload is too short");
  const v2 = data[0] === 0x56 && data[1] === 0x32 && data[2] === 0xff;
  const textFieldCount = v2 ? 18 : 16;
  const fields: Buffer[] = [];
  let start = 0;
  while (fields.length < textFieldCount) {
    const end = data.indexOf(0xff, start);
    if (end < 0) throw new Error("Secure QR payload has too few fields");
    fields.push(data.subarray(start, end));
    start = end + 1;
  }
  const offset = v2 ? 1 : 0;
  const indicator = Number(text(fields[offset]) ?? "0") & 3;
  const hashBytes = (indicator & 1 ? 32 : 0) + (indicator & 2 ? 32 : 0);
  const photoEnd = data.length - SIGNATURE_BYTES - hashBytes;
  const referenceId = text(fields[offset + 1]);
  const parsed: SecureQrFields = {
    format: v2 ? "secure_v2" : "secure_v1",
    referenceId,
    last4: referenceId && /^\d{4}/.test(referenceId) ? referenceId.slice(0, 4) : null,
    name: null, dob: null, gender: null, careOf: null, district: null, landmark: null, house: null, location: null,
    pincode: null, postOffice: null, state: null, street: null, subDistrict: null, vtc: null,
    photo: photoEnd > start ? Buffer.from(data.subarray(start, photoEnd)) : null,
    signedData: data.subarray(0, data.length - SIGNATURE_BYTES),
    signature: data.subarray(data.length - SIGNATURE_BYTES),
  };
  TEXT_FIELDS.forEach((key, i) => { parsed[key] = text(fields[offset + 2 + i]); });
  return parsed;
}

function xmlAttribute(xml: string, name: string): string | null {
  const match = new RegExp(`\\b${name}\\s*=\\s*"([^"]*)"`, "i").exec(xml) ?? new RegExp(`\\b${name}\\s*=\\s*'([^']*)'`, "i").exec(xml);
  return match?.[1]?.trim() || null;
}

// Pre-2018 cards carry a plain, unsigned XML QR.
export function parseXmlQr(content: string): SecureQrFields | null {
  if (!/<\?xml|<PrintLetterBarcodeData|<QPDB|<QDA/i.test(content)) return null;
  const uid = xmlAttribute(content, "uid")?.replace(/\D/g, "") ?? null;
  const yob = xmlAttribute(content, "yob");
  return {
    format: "xml", referenceId: null, last4: uid && uid.length >= 4 ? uid.slice(-4) : null,
    name: xmlAttribute(content, "name") ?? xmlAttribute(content, "n"),
    dob: xmlAttribute(content, "dob") ?? xmlAttribute(content, "d") ?? yob,
    gender: xmlAttribute(content, "gender") ?? xmlAttribute(content, "g"),
    careOf: xmlAttribute(content, "co"), district: xmlAttribute(content, "dist"), landmark: xmlAttribute(content, "lm"),
    house: xmlAttribute(content, "house"), location: xmlAttribute(content, "loc"), pincode: xmlAttribute(content, "pc"),
    postOffice: xmlAttribute(content, "po"), state: xmlAttribute(content, "state"), street: xmlAttribute(content, "street"),
    subDistrict: xmlAttribute(content, "subdist"), vtc: xmlAttribute(content, "vtc"),
    photo: null, signedData: null, signature: null,
  };
}

export function publicKeyFrom(pem: string): KeyObject {
  return pem.includes("BEGIN CERTIFICATE") ? new X509Certificate(pem).publicKey : createPublicKey(pem);
}

// A certificate that does not parse, or is not RSA, is a configuration fault:
// treating it as "no certificate" keeps every genuine card from reading "altered".
export function uidaiPublicKey(pem: string): KeyObject | null {
  try {
    const key = publicKeyFrom(pem);
    return key.asymmetricKeyType === "rsa" ? key : null;
  } catch {
    return null;
  }
}

export function verifySecureQrSignature(fields: SecureQrFields, cert: string | KeyObject): boolean {
  if (!fields.signedData || !fields.signature) return false;
  try {
    return verify("sha256", fields.signedData, typeof cert === "string" ? publicKeyFrom(cert) : cert, fields.signature);
  } catch {
    return false;
  }
}

// Returns null when the text is neither a Secure QR number nor the XML format.
// Throws when it looks like a Secure QR but the payload is corrupt.
export function decodeAadhaarQr(content: string, certPem: string | null): SecureQrResult | null {
  const bytes = secureQrBytes(content);
  if (!bytes) {
    const xml = parseXmlQr(content);
    return xml ? { fields: xml, signatureValid: null } : null;
  }
  const fields = parseSecureQrPayload(decompressSecureQr(bytes));
  const key = certPem ? uidaiPublicKey(certPem) : null;
  return { fields, signatureValid: key ? verifySecureQrSignature(fields, key) : null };
}
