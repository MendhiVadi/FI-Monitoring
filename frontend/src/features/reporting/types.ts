export type Step = "phone" | "otp" | "form" | "done";

/** A file the server has stored and screened for this draft. Only what the
 *  reporter may see is kept: never the risk, score or check results. */
export interface UploadedDocument {
  documentId: string;
  kind: string;
  fileName: string;
  sizeBytes: number;
  userMessages: string[];
  /** Client clock, so a document past the server's pending TTL can be flagged before submit. */
  uploadedAt: number;
}
