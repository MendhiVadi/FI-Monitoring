import { descriptorDistance, faceModelDir, scanFaces } from "./faces";
import type { CheckResult } from "./index";
import { openImage, type RawImage } from "./imaging";
import { errorName, StepTimeout, withTimeout } from "./runtime";

type Verdict = { result: CheckResult; detail: string };
export interface SelfieVerdicts { liveness: Verdict; match: Verdict | null }

// Matches frontend/src/features/reporting/selfieFrames.ts: square frames joined
// left to right in this order, as the camera sees them (not mirrored).
export const SELFIE_POSES = ["straight", "turned left", "turned right"] as const;

export interface SelfieFrameFacts {
  faces: number;
  // estimateYaw of the single face: negative = turned to the person's left.
  yaw: number | null;
  descriptor: Float32Array | null;
  // Small greyscale copy for the identical-frame test.
  thumb: Uint8Array | null;
}

// The client caps the strip at 1440×480; anything bigger is only shrunk.
const MAX_WIDTH = 1440, MAX_HEIGHT = 600;
const STRIP_TOLERANCE = 0.15;
const THUMB = 32;
// Mean grey-level difference of the thumbnails; a still scene with camera noise
// and JPEG loss stays near 1, a turned head moves far more.
const IDENTICAL_DIFF = 1.5;
// Head turn in inter-ocular distances (see estimateYaw); landmark jitter is about 0.02.
const MIN_TURN = 0.06;
// face-api descriptor distances: about 0.5 or less is a strong match, 0.6 or more a different person.
const STRONG_MATCH = 0.5;
const SAME_PERSON = 0.6;

export function frameDifference(a: Uint8Array, b: Uint8Array): number {
  if (!a.length || a.length !== b.length) return Infinity;
  let total = 0;
  for (let i = 0; i < a.length; i++) total += Math.abs(a[i] - b[i]);
  return total / a.length;
}

export function meanDescriptor(descriptors: Float32Array[]): Float32Array | null {
  if (!descriptors.length) return null;
  const mean = new Float32Array(descriptors[0].length);
  for (const descriptor of descriptors) for (let i = 0; i < mean.length; i++) mean[i] += descriptor[i] / descriptors.length;
  return mean;
}

export function judgeLiveness(frames: SelfieFrameFacts[]): Verdict {
  if (frames.length !== SELFIE_POSES.length) {
    return { result: "warn", detail: "The selfie is not the three-pose camera strip, so the head turns could not be checked." };
  }
  const reasons: string[] = [];
  frames.forEach((frame, i) => {
    if (frame.faces === 0) reasons.push(`No face in the ${SELFIE_POSES[i]} frame.`);
    else if (frame.faces > 1) reasons.push(`${frame.faces} faces in the ${SELFIE_POSES[i]} frame.`);
  });
  for (let i = 0; i < frames.length; i++) for (let j = i + 1; j < frames.length; j++) {
    const a = frames[i].thumb, b = frames[j].thumb;
    if (a && b && frameDifference(a, b) < IDENTICAL_DIFF) {
      reasons.push(`The ${SELFIE_POSES[i]} and ${SELFIE_POSES[j]} frames are the same picture (a frozen camera or a copied frame).`);
    }
  }
  if (frames.every(frame => frame.faces === 1)) {
    const [straight, left, right] = frames.map(frame => frame.yaw);
    if (straight === null || left === null || right === null) reasons.push("The head turns could not be measured.");
    else if (left > straight + MIN_TURN && right < straight - MIN_TURN) reasons.push("The head turned the opposite way to both prompts.");
    else {
      if (!(left < straight - MIN_TURN)) reasons.push("The head did not turn left in the turned-left frame.");
      if (!(right > straight + MIN_TURN)) reasons.push("The head did not turn right in the turned-right frame.");
    }
    const descriptors = frames.map(frame => frame.descriptor);
    if (descriptors.some(descriptor => !descriptor)) reasons.push("A face could not be described in every frame.");
    else {
      let worst = 0;
      for (let i = 0; i < descriptors.length; i++) for (let j = i + 1; j < descriptors.length; j++) {
        worst = Math.max(worst, descriptorDistance(descriptors[i] as Float32Array, descriptors[j] as Float32Array));
      }
      if (worst >= SAME_PERSON) reasons.push(`The frames do not all show the same person (distance ${worst.toFixed(2)}).`);
    }
  }
  return reasons.length
    ? { result: "warn", detail: reasons.join(" ") }
    : { result: "pass", detail: "Three camera frames, one face in each, the head turned left and right as asked, and the same person throughout." };
}

// null when there is nothing to compare with.
export function judgeMatch(distances: { card: number | null; qr: number | null }): Verdict | null {
  const refs = [
    { label: "the Aadhaar card photo", distance: distances.card },
    { label: "the QR photo", distance: distances.qr },
  ].filter((ref): ref is { label: string; distance: number } => ref.distance !== null && Number.isFinite(ref.distance));
  if (!refs.length) return null;
  const describe = (list: typeof refs) => list.map(ref => `${ref.label} (distance ${ref.distance.toFixed(2)})`).join(" and ");
  const different = refs.filter(ref => ref.distance >= SAME_PERSON), same = refs.filter(ref => ref.distance < SAME_PERSON);
  if (!different.length) {
    const strong = refs.every(ref => ref.distance <= STRONG_MATCH);
    return { result: "pass", detail: `The selfie ${strong ? "matches" : "likely matches"} ${describe(refs)}.` };
  }
  return {
    result: "warn",
    detail: `The selfie does not clearly match ${describe(different)}.${same.length ? ` It does match ${describe(same)}.` : ""}`,
  };
}

// Three frames side by side when the strip has the client's 3:1 shape; otherwise
// the whole picture as one frame, so a plain photo can still be face-matched.
export async function splitStrip(selfie: Buffer): Promise<RawImage[]> {
  const { data, info } = await openImage(selfie).removeAlpha().toColourspace("srgb")
    .resize({ width: MAX_WIDTH, height: MAX_HEIGHT, fit: "inside", withoutEnlargement: true })
    .raw().toBuffer({ resolveWithObject: true });
  const { width, height, channels } = info;
  const whole: RawImage = { data, width, height, channels: channels as RawImage["channels"] };
  const count = SELFIE_POSES.length;
  if (Math.abs(width / height - count) > STRIP_TOLERANCE || width < count) return [whole];
  return Array.from({ length: count }, (_, i) => {
    const left = Math.round((i * width) / count), frameWidth = Math.round(((i + 1) * width) / count) - left;
    const frame = Buffer.alloc(frameWidth * height * channels);
    for (let y = 0; y < height; y++) data.copy(frame, y * frameWidth * channels, (y * width + left) * channels, (y * width + left + frameWidth) * channels);
    return { data: frame, width: frameWidth, height, channels: channels as RawImage["channels"] };
  });
}

async function thumbnail(frame: RawImage): Promise<Uint8Array> {
  return new Uint8Array(await openImage(frame).greyscale().resize(THUMB, THUMB, { fit: "fill" }).raw().toBuffer());
}

export async function checkSelfie(
  selfie: Buffer,
  refs: { cardFace: Float32Array | null; qrFace: Float32Array | null },
  deadline: number,
): Promise<SelfieVerdicts> {
  const hasRefs = !!(refs.cardFace || refs.qrFace);
  const unavailable = (detail: string): SelfieVerdicts => ({
    liveness: { result: "unavailable", detail },
    match: hasRefs ? { result: "unavailable", detail } : null,
  });
  if (!faceModelDir()) return unavailable("Face models are missing, so the selfie could not be checked.");
  const tick = () => { if (Date.now() > deadline) throw new StepTimeout("selfie"); };
  let frames: SelfieFrameFacts[];
  try {
    frames = await withTimeout("selfie", deadline - Date.now(), async () => {
      const parts = await splitStrip(selfie);
      const facts: SelfieFrameFacts[] = [];
      for (const part of parts) {
        tick();
        const scan = await scanFaces(part);
        const single = scan.faces.length === 1;
        facts.push({ faces: scan.faces.length, yaw: single ? scan.faces[0].yaw ?? null : null, descriptor: single ? scan.descriptor : null, thumb: await thumbnail(part) });
      }
      return facts;
    });
  } catch (err) {
    if (err instanceof StepTimeout) return unavailable("The selfie check ran out of time.");
    console.warn("Document screening step failed", { step: "selfie", error: errorName(err) });
    return unavailable("The selfie could not be read or face detection could not run.");
  }

  const liveness = judgeLiveness(frames);
  if (!hasRefs) return { liveness, match: null };
  const mean = meanDescriptor(frames.flatMap(frame => (frame.descriptor ? [frame.descriptor] : [])));
  if (!mean) return { liveness, match: { result: "unavailable", detail: "No frame of the selfie holds exactly one face to compare with the Aadhaar photo." } };
  const match = judgeMatch({
    card: refs.cardFace ? descriptorDistance(mean, refs.cardFace) : null,
    qr: refs.qrFace ? descriptorDistance(mean, refs.qrFace) : null,
  });
  return { liveness, match };
}
