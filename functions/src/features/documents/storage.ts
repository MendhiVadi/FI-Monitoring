import * as admin from "firebase-admin";
import "../../platform/firebase";

// Every object lives under one prefix per document, so a removal or purge is a
// single prefix delete that also catches derived files written late.
export const documentPrefix = (documentId: string) => "case-documents/" + documentId + "/";
export const DERIVED_NAMES = { ela: "ela.png", faceCard: "face-card.jpg", faceQr: "face-qr.jpg", copyMove: "copy-move.png" } as const;
export const VARIANT_TYPES = { ela: "image/png", faceCard: "image/jpeg", faceQr: "image/jpeg", copyMove: "image/png" } as const;

export interface DocumentStore {
  save(path: string, bytes: Buffer, contentType: string): Promise<void>;
  read(path: string): Promise<Buffer>;
  removeAll(documentId: string): Promise<void>;
}

// Default bucket through the Admin SDK; storage.rules deny every client.
export const firebaseStore: DocumentStore = {
  async save(path, bytes, contentType) {
    await admin.storage().bucket().file(path).save(bytes, { resumable: false, contentType,
      metadata: { cacheControl: "private, no-store", contentDisposition: "attachment" } });
  },
  async read(path) {
    const [bytes] = await admin.storage().bucket().file(path).download();
    return bytes;
  },
  async removeAll(documentId) {
    await admin.storage().bucket().deleteFiles({ prefix: documentPrefix(documentId), force: true });
  },
};
