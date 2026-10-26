import { parentPort, workerData } from "node:worker_threads";
import { analysePdfInThread, type PdfOptions, type PdfWorkerMessage } from "./pdf";
import { errorName } from "./runtime";

// Hosts pdf.js for analysePdf (see pdf.ts); images travel back page by page so
// a stop part-way still leaves the caller what was already read.
const { bytes, options } = workerData as { bytes: Uint8Array; options: PdfOptions };
const send = (message: PdfWorkerMessage) => parentPort?.postMessage(message);

analysePdfInThread(Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength), options, (partial, images) => send({ type: "progress", partial, images }))
  .then(result => send({ type: "done", result: { ...result, images: [] } }))
  .catch(err => send({ type: "error", name: errorName(err) }));
