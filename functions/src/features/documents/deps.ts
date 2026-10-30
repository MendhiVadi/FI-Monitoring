import { uploadBytesPerIpDayMib, uploadsPerIpDay } from "../../platform/limits";
import { limitValue } from "../disputes/params";
import { MIB, sniffDocumentType, type UploadLimits } from "./rules";
import type { ScreeningEngine, UploadDeps } from "./service";
import { firebaseStore } from "./storage";

// Shared by the two upload callables (uploadDisputeDocument and
// uploadReplacementDocument). The engine is loaded on first upload only (see
// ScreeningEngine); the certificate is read once per instance.
let uidaiCertPem: string | null | undefined;
// Every report needs an Aadhaar upload, so an engine that fails to load (a
// missing native binary, say) must not stop reporting: files are still
// type-checked and stored, and staff see "screening could not run".
const unavailableEngine: ScreeningEngine = { ENGINE_VERSION: "unavailable", sniffContentType: sniffDocumentType,
  screenDocument: () => Promise.reject(Object.assign(new Error("Screening engine unavailable"), { name: "EngineUnavailable" })) };

// Per-connection upload quota from the deployed params (platform/limits.ts).
export function uploadLimits(): UploadLimits {
  return { files: limitValue(uploadsPerIpDay), bytes: limitValue(uploadBytesPerIpDayMib) * MIB };
}

export async function screeningDeps(): Promise<UploadDeps> {
  const limits = uploadLimits();
  try {
    const engine = await import("./screening/index");
    if (uidaiCertPem === undefined) uidaiCertPem = engine.loadUidaiCertificate();
    return { store: firebaseStore, engine, uidaiCertPem, limits };
  } catch (err) {
    console.error("Document screening engine failed to load", { error: err instanceof Error ? err.name : "unknown" });
    return { store: firebaseStore, engine: unavailableEngine, uidaiCertPem: null, limits };
  }
}
