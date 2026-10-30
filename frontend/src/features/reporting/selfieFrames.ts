// The selfie check: three square crops of the front camera (straight, turned
// left, turned right) joined side by side into one JPEG, which the server's
// liveness and face-match checks split again. Frames live in memory only:
// nothing is written to storage, the gallery or a download.

export const SELFIE_POSES = [
  { id: "straight", label: "Straight", instruction: "Look straight at the camera." },
  { id: "left", label: "Turned left", instruction: "Turn your head slightly to your left." },
  { id: "right", label: "Turned right", instruction: "Turn your head slightly to your right." },
] as const;

/** Each frame is at most this many pixels square, so the strip is at most 1440×480. */
const FRAME_MAX = 480;
export const SELFIE_FILE_NAME = "selfie-check.jpg";
const JPEG_QUALITY = 0.92;

export const CAMERA_CONSTRAINTS: MediaStreamConstraints = {
  audio: false,
  video: { facingMode: "user", width: { ideal: 1280 }, height: { ideal: 720 } },
};

export interface SelfieFrame {
  canvas: HTMLCanvasElement;
  /** A tiny greyscale copy, to spot a frozen camera before the server does. */
  signature: Uint8Array;
}

/** getUserMedia exists only in secure contexts (https or localhost) and not in every in-app browser. */
export function cameraSupported(): boolean {
  return typeof window !== "undefined" && window.isSecureContext && typeof navigator.mediaDevices?.getUserMedia === "function";
}

/** The centre square of the current video frame, as the camera sees it (not mirrored). */
export function grabFrame(video: HTMLVideoElement): SelfieFrame | null {
  const width = video.videoWidth, height = video.videoHeight;
  if (!width || !height) return null;
  const side = Math.min(width, height);
  const size = Math.min(FRAME_MAX, side);
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const context = canvas.getContext("2d");
  if (!context) return null;
  context.drawImage(video, (width - side) / 2, (height - side) / 2, side, side, 0, 0, size, size);
  return { canvas, signature: signatureOf(canvas) };
}

const SIGNATURE_SIZE = 24;
function signatureOf(source: HTMLCanvasElement): Uint8Array {
  const small = document.createElement("canvas");
  small.width = SIGNATURE_SIZE;
  small.height = SIGNATURE_SIZE;
  const context = small.getContext("2d", { willReadFrequently: true });
  if (!context) return new Uint8Array(0);
  context.drawImage(source, 0, 0, SIGNATURE_SIZE, SIGNATURE_SIZE);
  const { data } = context.getImageData(0, 0, SIGNATURE_SIZE, SIGNATURE_SIZE);
  const grey = new Uint8Array(SIGNATURE_SIZE * SIGNATURE_SIZE);
  for (let i = 0; i < grey.length; i++) grey[i] = (data[i * 4] * 299 + data[i * 4 + 1] * 587 + data[i * 4 + 2] * 114) / 1000;
  return grey;
}

/** True for practically the same picture twice: a frozen feed, or no movement at all.
 *  Camera noise alone averages well under one grey level at this size. */
export function looksIdentical(a: SelfieFrame, b: SelfieFrame): boolean {
  if (a.signature.length === 0 || a.signature.length !== b.signature.length) return false;
  let total = 0;
  for (let i = 0; i < a.signature.length; i++) total += Math.abs(a.signature[i] - b.signature[i]);
  return total / a.signature.length < 1;
}

/** The frames left to right in one JPEG; null when the browser cannot encode it. */
export function stitchFrames(frames: SelfieFrame[]): Promise<Blob | null> {
  const size = Math.min(...frames.map((frame) => frame.canvas.width));
  const canvas = document.createElement("canvas");
  canvas.width = size * frames.length;
  canvas.height = size;
  const context = canvas.getContext("2d");
  if (!context || !Number.isFinite(size) || size <= 0) return Promise.resolve(null);
  frames.forEach((frame, i) => context.drawImage(frame.canvas, i * size, 0, size, size));
  return new Promise((resolve) => {
    canvas.toBlob((blob) => {
      releaseCanvas(canvas);
      resolve(blob);
    }, "image/jpeg", JPEG_QUALITY);
  });
}

/** Zero-size canvases drop their pixel buffers straight away instead of at the next GC. */
export function releaseFrames(frames: SelfieFrame[]) {
  for (const frame of frames) releaseCanvas(frame.canvas);
}
function releaseCanvas(canvas: HTMLCanvasElement) {
  canvas.width = 0;
  canvas.height = 0;
}

/** Why the camera did not open, in words for the reporter, and whether trying again can help. */
export function cameraProblem(err: unknown): { message: string; retryable: boolean } {
  const name = (err as { name?: string })?.name ?? "";
  if (name === "NotAllowedError" || name === "PermissionDeniedError" || name === "SecurityError") {
    return { message: "Camera access is blocked for this site. To take the selfie check, allow the camera in your browser's site settings, then try again.", retryable: true };
  }
  if (name === "NotFoundError" || name === "DevicesNotFoundError" || name === "OverconstrainedError") {
    return { message: "No front camera was found on this device.", retryable: false };
  }
  if (name === "NotReadableError" || name === "TrackStartError" || name === "AbortError") {
    return { message: "The camera could not start. Another app may be using it: close that app and try again.", retryable: true };
  }
  return { message: "The camera could not start.", retryable: true };
}
