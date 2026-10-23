import { readFileSync } from "node:fs";
import { toRgba, type RawImage } from "./imaging";

type ZXingReader = typeof import("zxing-wasm/reader");
let reader: Promise<ZXingReader> | null = null;

// zxing-wasm fetches its binary from a CDN by default; load the installed copy.
function loadReader(): Promise<ZXingReader> {
  reader ??= (async () => {
    const zxing: ZXingReader = require("zxing-wasm/reader");
    const wasm = readFileSync(require.resolve("zxing-wasm/reader/zxing_reader.wasm"));
    await zxing.prepareZXingModule({
      overrides: { wasmBinary: wasm.buffer.slice(wasm.byteOffset, wasm.byteOffset + wasm.byteLength) as ArrayBuffer },
      fireImmediately: true,
    });
    return zxing;
  })().catch(err => { reader = null; throw err; });
  return reader;
}

// Secure QR codes are dense (version 25+), so a phone photo is tried at a few
// resolutions: full detail first, then smaller copies that suppress noise.
export async function readQrCode(source: Buffer | RawImage): Promise<string | null> {
  const zxing = await loadReader();
  let previousWidth = 0;
  for (const side of [2400, 1400, 900]) {
    const image = await toRgba(source, side);
    if (image.width === previousWidth) continue;
    previousWidth = image.width;
    const results = await zxing.readBarcodes(
      { data: new Uint8ClampedArray(image.data.buffer, image.data.byteOffset, image.data.length), width: image.width, height: image.height, colorSpace: "srgb" } as unknown as Parameters<ZXingReader["readBarcodes"]>[0],
      { formats: ["QRCode"], tryHarder: true, maxNumberOfSymbols: 4 },
    );
    const found = results.find(result => result.isValid && result.text);
    if (found) return found.text;
  }
  return null;
}
