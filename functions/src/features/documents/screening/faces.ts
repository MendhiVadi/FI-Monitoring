import { join } from "node:path";
import { existsSync } from "node:fs";
import sharp from "sharp";
import { openImage, type RawImage } from "./imaging";
import { assetPath, firstExisting, packageDir } from "./runtime";

type FaceApi = typeof import("@vladmandic/face-api/dist/face-api.node-wasm.js");
let engine: Promise<FaceApi> | null = null;

export function faceModelDir(): string | null {
  const bundled = packageDir("@vladmandic/face-api");
  const dir = firstExisting(assetPath("face-models"), bundled ? join(bundled, "model") : null);
  return dir && existsSync(join(dir, "ssd_mobilenetv1_model-weights_manifest.json")) ? dir : null;
}

function loadEngine(): Promise<FaceApi> {
  engine ??= (async () => {
    const modelDir = faceModelDir();
    if (!modelDir) throw new Error("Face models are missing");
    const faceapi: FaceApi = require("@vladmandic/face-api/dist/face-api.node-wasm.js");
    const tf = faceapi.tf as unknown as { setBackend(name: string): Promise<boolean>; ready(): Promise<void> };
    try {
      const wasm = require("@tensorflow/tfjs-backend-wasm");
      wasm.setWasmPaths(join(packageDir("@tensorflow/tfjs-backend-wasm") ?? "", "dist") + "/");
      if (!(await tf.setBackend("wasm"))) throw new Error("wasm backend unavailable");
    } catch {
      await tf.setBackend("cpu");
    }
    await tf.ready();
    await faceapi.nets.ssdMobilenetv1.loadFromDisk(modelDir);
    await faceapi.nets.faceLandmark68Net.loadFromDisk(modelDir);
    await faceapi.nets.faceRecognitionNet.loadFromDisk(modelDir);
    return faceapi;
  })().catch(err => { engine = null; throw err; });
  return engine;
}

export interface FaceBox {
  x: number; y: number; width: number; height: number; score: number;
  // Head turn (see estimateYaw); absent when the landmarks are unusable.
  yaw?: number;
}
export interface FaceScan { faces: FaceBox[]; descriptor: Float32Array | null; crop: Buffer | null }

async function rgb(source: Buffer | RawImage, maxSide: number, minSide = 0) {
  const meta = await openImage(source).metadata();
  const longSide = Math.max(meta.width ?? 1, meta.height ?? 1);
  const side = longSide < minSide ? minSide : Math.min(longSide, maxSide);
  const { data, info } = await openImage(source).resize({ width: side, height: side, fit: "inside" }).removeAlpha()
    .toColourspace("srgb").raw().toBuffer({ resolveWithObject: true });
  return { data, width: info.width, height: info.height };
}

// Detects faces and describes the most confident one. A tiny portrait (the QR
// photo) may defeat the detector; it is then described as a whole.
export async function scanFaces(source: Buffer | RawImage, options: { wholeIfNone?: boolean } = {}): Promise<FaceScan> {
  const faceapi = await loadEngine();
  const tf = faceapi.tf as unknown as { tensor3d(data: Uint8Array, shape: [number, number, number], dtype: "int32"): { dispose(): void } };
  const image = await rgb(source, 1600, options.wholeIfNone ? 320 : 0);
  const tensor = tf.tensor3d(new Uint8Array(image.data), [image.height, image.width, 3], "int32");
  try {
    const found = await faceapi.detectAllFaces(tensor as never, new faceapi.SsdMobilenetv1Options({ minConfidence: 0.45, maxResults: 6 }))
      .withFaceLandmarks().withFaceDescriptors();
    const faces = found.map(face => {
      const { x, y, width, height } = face.detection.box;
      const box: FaceBox = { x, y, width, height, score: face.detection.score };
      const yaw = estimateYaw(face.landmarks.positions);
      if (yaw !== null) box.yaw = yaw;
      return box;
    });
    const best = [...found].sort((a, b) => b.detection.score - a.detection.score)[0];
    if (best) {
      const box = best.detection.box, pad = Math.max(box.width, box.height) * 0.25;
      const left = Math.max(0, Math.floor(box.x - pad)), top = Math.max(0, Math.floor(box.y - pad));
      const crop = await sharp(image.data, { raw: { width: image.width, height: image.height, channels: 3 } })
        .extract({ left, top, width: Math.min(image.width - left, Math.ceil(box.width + pad * 2)), height: Math.min(image.height - top, Math.ceil(box.height + pad * 2)) })
        .jpeg({ quality: 88 }).toBuffer();
      return { faces, descriptor: best.descriptor, crop };
    }
    if (!options.wholeIfNone) return { faces, descriptor: null, crop: null };
    const descriptor = await faceapi.nets.faceRecognitionNet.computeFaceDescriptor(tensor as never) as Float32Array;
    const crop = await sharp(image.data, { raw: { width: image.width, height: image.height, channels: 3 } }).jpeg({ quality: 88 }).toBuffer();
    return { faces, descriptor, crop };
  } finally {
    tensor.dispose();
  }
}

// Head turn from the 68 landmarks: the nose tip's offset from the eye midpoint
// along the eye line, in inter-ocular distances, so roll and face size cancel
// out. 0 faces the camera; about 0.1 is a slight turn. The sign assumes the
// image as the camera sees it (not mirrored), where the person's left is the
// image's right: negative = turned to the person's left, positive = their right.
export function estimateYaw(points: ReadonlyArray<{ x: number; y: number }>): number | null {
  if (points.length < 48) return null;
  const centre = (from: number, to: number) => {
    let x = 0, y = 0;
    for (let i = from; i < to; i++) { x += points[i].x; y += points[i].y; }
    return { x: x / (to - from), y: y / (to - from) };
  };
  // 36–41 is the eye on the image's left, 42–47 the one on its right, 30 the nose tip.
  const leftEye = centre(36, 42), rightEye = centre(42, 48), nose = points[30];
  const ex = rightEye.x - leftEye.x, ey = rightEye.y - leftEye.y;
  const span = ex * ex + ey * ey;
  if (!(span > 0) || !Number.isFinite(nose.x) || !Number.isFinite(nose.y)) return null;
  const along = ((nose.x - (leftEye.x + rightEye.x) / 2) * ex + (nose.y - (leftEye.y + rightEye.y) / 2) * ey) / span;
  return Number.isFinite(along) ? -along : null;
}

export function descriptorDistance(a: Float32Array, b: Float32Array): number {
  let sum = 0;
  for (let i = 0; i < a.length; i++) sum += (a[i] - b[i]) ** 2;
  return Math.sqrt(sum);
}
