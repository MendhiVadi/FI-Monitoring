import type { RawImage } from "./imaging";

interface J2KDecoder {
  getEncodedBuffer(length: number): Uint8Array;
  decode(): void;
  getFrameInfo(): { width: number; height: number; bitsPerSample: number; componentCount: number; isSigned: boolean };
  getDecodedBuffer(): Uint8Array;
  delete(): void;
}
interface OpenJpegModule { J2KDecoder: new () => J2KDecoder }

let codec: Promise<OpenJpegModule> | null = null;

function loadCodec(): Promise<OpenJpegModule> {
  codec ??= (async () => {
    const factory = require("@cornerstonejs/codec-openjpeg/decodewasmjs");
    // The decoder narrates to stdout; screening output must stay quiet.
    return (factory.default ?? factory)({ print: () => undefined, printErr: () => undefined }) as Promise<OpenJpegModule>;
  })().catch(err => { codec = null; throw err; });
  return codec;
}

// The Aadhaar photo may be a JP2 file (boxes) or a bare J2K codestream; the
// decoder only accepts the codestream, which lives in the "jp2c" box.
export function j2kCodestream(bytes: Buffer): Buffer | null {
  if (bytes[0] === 0xff && bytes[1] === 0x4f && bytes[2] === 0xff && bytes[3] === 0x51) return bytes;
  let offset = 0;
  while (offset + 8 <= bytes.length) {
    let length = bytes.readUInt32BE(offset);
    const type = bytes.toString("latin1", offset + 4, offset + 8);
    let header = 8;
    if (length === 1 && offset + 16 <= bytes.length) { length = Number(bytes.readBigUInt64BE(offset + 8)); header = 16; }
    if (length === 0) length = bytes.length - offset;
    if (length < header) return null;
    if (type === "jp2c") return bytes.subarray(offset + header, Math.min(bytes.length, offset + length));
    offset += length;
  }
  return null;
}

// The QR photo is a small portrait, but its header is attacker-controlled: a few
// bytes can declare gigapixels and grow the shared WASM heap for the instance's life.
const MAX_PHOTO_SAMPLES = 12_000_000;

// SOC, then SIZ: Lsiz, Rsiz, Xsiz, Ysiz, XOsiz, YOsiz, XTsiz, YTsiz, XTOsiz, YTOsiz, Csiz.
export function codestreamSamples(stream: Buffer): number | null {
  if (stream.length < 42 || stream.readUInt16BE(0) !== 0xff4f || stream.readUInt16BE(2) !== 0xff51) return null;
  const width = stream.readUInt32BE(8) - stream.readUInt32BE(16), height = stream.readUInt32BE(12) - stream.readUInt32BE(20);
  const components = stream.readUInt16BE(40);
  return width > 0 && height > 0 && components > 0 ? width * height * components : null;
}

export async function decodeJpeg2000(bytes: Buffer): Promise<RawImage | null> {
  const stream = j2kCodestream(bytes);
  const samples = stream ? codestreamSamples(stream) : null;
  if (!stream || !samples || samples > MAX_PHOTO_SAMPLES) return null;
  const { J2KDecoder } = await loadCodec();
  const decoder = new J2KDecoder();
  try {
    decoder.getEncodedBuffer(stream.length).set(stream);
    decoder.decode();
    const info = decoder.getFrameInfo();
    if (!info.width || !info.height || !info.componentCount) return null;
    const decoded = decoder.getDecodedBuffer();
    const channels = info.componentCount >= 3 ? 3 : 1;
    const pixels = info.width * info.height;
    const out = Buffer.alloc(pixels * channels);
    if (info.bitsPerSample > 8) {
      const wide = new Uint16Array(decoded.buffer, decoded.byteOffset, Math.floor(decoded.byteLength / 2));
      const shift = info.bitsPerSample - 8;
      for (let i = 0; i < out.length; i++) out[i] = Math.min(255, wide[i] >> shift);
    } else {
      // Interleaved components; extra components (alpha) are dropped.
      for (let p = 0; p < pixels; p++) for (let c = 0; c < channels; c++) out[p * channels + c] = decoded[p * info.componentCount + c];
    }
    return { data: out, width: info.width, height: info.height, channels };
  } finally {
    decoder.delete();
  }
}
