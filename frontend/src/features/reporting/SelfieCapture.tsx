import { useEffect, useRef, useState } from "react";
import {
  CAMERA_CONSTRAINTS, SELFIE_FILE_NAME, SELFIE_POSES, cameraProblem, cameraSupported, grabFrame,
  looksIdentical, releaseFrames, stitchFrames, type SelfieFrame,
} from "./selfieFrames";

type Phase = "closed" | "consent" | "starting" | "live" | "review" | "unavailable";

interface SelfieCaptureProps {
  /** Prefix for this instance's element ids. */
  idPrefix: string;
  /** Id of the start button, so callers can move focus back to it. */
  startId?: string;
  startLabel: string;
  startDescribedBy?: string;
  /** Says the check can be skipped when the camera is unavailable. */
  optional: boolean;
  /** Return false to stay closed; the caller has explained why (e.g. verify first). */
  onRequestStart?: () => boolean;
  /** The stitched JPEG, handed over only after the reporter chooses to use it. */
  onCapture: (file: File) => void;
}

const POSE_COUNT = SELFIE_POSES.length;

// A guided camera check for the "selfie" document kind: consent first, then
// one photo per pose, a preview, and only then an upload by the caller. The
// camera stops as soon as the last photo is taken, on Cancel, when the page is
// hidden and on unmount; the photos exist only in memory until sent.
export function SelfieCapture({ idPrefix, startId, startLabel, startDescribedBy, optional, onRequestStart, onCapture }: SelfieCaptureProps) {
  const [phase, setPhase] = useState<Phase>("closed");
  const [agreed, setAgreed] = useState(false);
  const [consentError, setConsentError] = useState<string | null>(null);
  const [problem, setProblem] = useState<{ message: string; retryable: boolean } | null>(null);
  const [frameError, setFrameError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const [taken, setTaken] = useState(0);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [announcement, setAnnouncement] = useState("");
  const stream = useRef<MediaStream | null>(null);
  const video = useRef<HTMLVideoElement>(null);
  const frames = useRef<SelfieFrame[]>([]);
  const stitched = useRef<Blob | null>(null);
  const preview = useRef<string | null>(null);
  // Bumped by every open and close, so a camera or encoder that answers late is ignored.
  const attempt = useRef(0);
  const startButton = useRef<HTMLButtonElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const captureButton = useRef<HTMLButtonElement>(null);
  const acceptButton = useRef<HTMLButtonElement>(null);
  const focusStart = useRef(false);

  const headingId = `${idPrefix}-selfie-heading`;
  const consentId = `${idPrefix}-selfie-consent`;
  const instructionId = `${idPrefix}-selfie-instruction`;

  function stopCamera() {
    stream.current?.getTracks().forEach((track) => track.stop());
    stream.current = null;
    if (video.current) video.current.srcObject = null;
    setReady(false);
  }

  function discardPhotos() {
    releaseFrames(frames.current);
    frames.current = [];
    stitched.current = null;
    if (preview.current) URL.revokeObjectURL(preview.current);
    preview.current = null;
    setPreviewUrl(null);
    setTaken(0);
  }

  // Unmount (the row disappears, or the reporter leaves the page) must never leave the camera on.
  useEffect(() => () => {
    attempt.current += 1;
    stream.current?.getTracks().forEach((track) => track.stop());
    stream.current = null;
    releaseFrames(frames.current);
    frames.current = [];
    if (preview.current) URL.revokeObjectURL(preview.current);
    preview.current = null;
  }, []);

  // Switching apps or tabs mid-check turns the camera off rather than leaving it running unseen.
  useEffect(() => {
    if (phase !== "starting" && phase !== "live") return;
    const onHidden = () => {
      if (document.visibilityState !== "hidden") return;
      attempt.current += 1;
      stopCamera();
      discardPhotos();
      setNotice("The camera was turned off because you left the page. Open it again to start over.");
      setPhase("consent");
    };
    document.addEventListener("visibilitychange", onHidden);
    return () => document.removeEventListener("visibilitychange", onHidden);
  }, [phase]);

  // The video element mounts with the "live" phase; attach the stream then.
  useEffect(() => {
    if (phase !== "live") return;
    const element = video.current, source = stream.current;
    if (!element || !source) return;
    element.srcObject = source;
    // Announced once per camera start, when the first frame arrives (not on every later "playing").
    let announced = false;
    const onData = () => {
      if (element.videoWidth <= 0) return;
      setReady(true);
      if (announced) return;
      announced = true;
      setAnnouncement(`Camera on. Photo 1 of ${POSE_COUNT}: ${SELFIE_POSES[0].instruction}`);
    };
    element.addEventListener("loadeddata", onData);
    element.addEventListener("playing", onData);
    // Muted and inline, so autoplay is allowed; a refusal still shows frames once loaded.
    element.play().catch(() => {});
    onData();
    return () => {
      element.removeEventListener("loadeddata", onData);
      element.removeEventListener("playing", onData);
    };
  }, [phase]);

  // The button is disabled until ready, so focus waits for the render that enables it.
  useEffect(() => {
    if (ready) captureButton.current?.focus({ preventScroll: true });
  }, [ready]);

  useEffect(() => {
    if (phase === "consent") heading.current?.focus({ preventScroll: true });
    if (phase === "closed" && focusStart.current) {
      focusStart.current = false;
      startButton.current?.focus();
    }
  }, [phase]);

  useEffect(() => {
    if (previewUrl) acceptButton.current?.focus({ preventScroll: true });
  }, [previewUrl]);

  function open() {
    if (onRequestStart && !onRequestStart()) return;
    setConsentError(null);
    setNotice(null);
    setAgreed(false);
    setPhase("consent");
  }

  function close() {
    attempt.current += 1;
    stopCamera();
    discardPhotos();
    setProblem(null);
    setFrameError(null);
    setNotice(null);
    setAgreed(false);
    setAnnouncement("");
    focusStart.current = true;
    setPhase("closed");
  }

  async function openCamera() {
    setFrameError(null);
    setNotice(null);
    discardPhotos();
    if (!cameraSupported()) {
      setProblem({ message: "This browser cannot open the camera on this page. Try a current version of Chrome, Safari or Firefox.", retryable: false });
      setPhase("unavailable");
      return;
    }
    const id = ++attempt.current;
    setProblem(null);
    setPhase("starting");
    setAnnouncement("Opening the camera…");
    try {
      const source = await navigator.mediaDevices.getUserMedia(CAMERA_CONSTRAINTS);
      if (id !== attempt.current) { source.getTracks().forEach((track) => track.stop()); return; }
      stream.current = source;
      setPhase("live");
    } catch (err) {
      if (id !== attempt.current) return;
      setProblem(cameraProblem(err));
      setAnnouncement("");
      setPhase("unavailable");
    }
  }

  function startCamera() {
    if (!agreed) {
      setConsentError("Tick the box to agree before the camera opens.");
      return;
    }
    void openCamera();
  }

  function capture() {
    const element = video.current;
    if (!element || !ready) return;
    const frame = grabFrame(element);
    if (!frame) { setFrameError("The camera has not shown a picture yet. Wait a moment, then try again."); return; }
    const previous = frames.current[frames.current.length - 1];
    if (previous && looksIdentical(previous, frame)) {
      releaseFrames([frame]);
      setFrameError("This photo looks the same as the last one. Turn your head a little, then take it again.");
      return;
    }
    setFrameError(null);
    frames.current = [...frames.current, frame];
    const count = frames.current.length;
    setTaken(count);
    if (count < POSE_COUNT) {
      setAnnouncement(`Photo ${count} taken. Photo ${count + 1} of ${POSE_COUNT}: ${SELFIE_POSES[count].instruction}`);
      return;
    }
    // All poses taken: the camera is no longer needed.
    stopCamera();
    setPhase("review");
    setAnnouncement("All three photos taken. Preparing a preview…");
    const id = attempt.current;
    void stitchFrames(frames.current).then((blob) => {
      if (id !== attempt.current) return;
      releaseFrames(frames.current);
      frames.current = [];
      if (!blob) {
        setFrameError("Your browser could not prepare the photos. Retake them, or try another browser.");
        setAnnouncement("");
        return;
      }
      stitched.current = blob;
      const url = URL.createObjectURL(blob);
      preview.current = url;
      setPreviewUrl(url);
      setAnnouncement("Preview ready. Nothing has been sent yet.");
    });
  }

  function acceptPhotos() {
    const blob = stitched.current;
    if (!blob) return;
    const file = new File([blob], SELFIE_FILE_NAME, { type: "image/jpeg", lastModified: Date.now() });
    close();
    onCapture(file);
  }

  if (phase === "closed") {
    return (
      <button ref={startButton} id={startId} type="button" className="report-btn report-btn--secondary" aria-describedby={startDescribedBy} onClick={open}>
        {startLabel}
      </button>
    );
  }

  const current = SELFIE_POSES[Math.min(taken, POSE_COUNT - 1)];

  return (
    <section className="selfie-panel" aria-labelledby={headingId}>
      <h4 id={headingId} ref={heading} tabIndex={-1} className="selfie-panel__title">Selfie check</h4>
      <p role="status" className="report-sr-only">{announcement}</p>
      {notice && <p className="report-warning" style={{ marginTop: 0 }}>{notice}</p>}

      {phase === "consent" && (
        <>
          <div id={consentId} className="selfie-consent">
            <p>
              The camera takes three photos of your face: looking straight, turned to your left and turned to
              your right. They are joined into one picture, and you see it before anything is sent.
            </p>
            <p>
              The picture is sent only when you choose “Use these photos”. It is compared with the photo on your
              Aadhaar card to check that a real person matching the card is making this report. Face images are
              biometric data: they are used only for this check, only staff can see them, and they are deleted
              with your other documents. Nothing is saved on your device. See the{" "}
              <a href="/privacy-policy" target="_blank" rel="noreferrer">Privacy Policy<span className="report-sr-only"> (opens in new tab)</span></a>.
            </p>
          </div>
          <label className="report-check">
            <input type="checkbox" checked={agreed} aria-describedby={[consentId, consentError && `${idPrefix}-selfie-consent-error`].filter(Boolean).join(" ")}
              aria-invalid={consentError ? true : undefined}
              onChange={(e) => { setAgreed(e.target.checked); if (e.target.checked) setConsentError(null); }} />
            <span>I agree to take the selfie check and for the picture to be used as described.</span>
          </label>
          {consentError && <p id={`${idPrefix}-selfie-consent-error`} role="alert" className="report-field-error">{consentError}</p>}
          <div className="report-actions">
            <button type="button" className="report-btn" onClick={startCamera}>Open camera</button>
            <button type="button" className="report-btn report-btn--secondary" onClick={close}>Cancel</button>
          </div>
        </>
      )}

      {(phase === "starting" || phase === "live") && (
        <>
          <div className="selfie-stage">
            {phase === "live" && <video ref={video} className="selfie-video" muted playsInline autoPlay aria-label="Camera preview, shown like a mirror" />}
            <div className="selfie-guide" aria-hidden="true" />
            {!ready && <p className="selfie-stage__status" aria-hidden="true">Opening the camera…</p>}
          </div>
          <ol className="selfie-steps" aria-label="Photos">
            {SELFIE_POSES.map((pose, i) => (
              <li key={pose.id} data-state={i < taken ? "done" : i === taken ? "current" : "waiting"} aria-current={i === taken ? "step" : undefined}>
                {pose.label}{i < taken ? " · taken" : ""}
              </li>
            ))}
          </ol>
          <p id={instructionId} className="selfie-instruction">Photo {taken + 1} of {POSE_COUNT}: {current.instruction}</p>
          <p className="report-hint">Hold the phone at eye level in good light, with your whole face inside the oval and nothing covering it.</p>
          {frameError && <p role="alert" className="report-field-error">{frameError}</p>}
          <div className="report-actions">
            <button ref={captureButton} type="button" className="report-btn" disabled={!ready} aria-describedby={instructionId} onClick={capture}>
              Take photo {taken + 1} of {POSE_COUNT}
            </button>
            <button type="button" className="report-btn report-btn--secondary" onClick={close}>Cancel</button>
          </div>
        </>
      )}

      {phase === "review" && (
        <>
          {previewUrl
            ? <img src={previewUrl} className="selfie-preview" alt="Your three selfie photos side by side: looking straight, turned left and turned right." />
            : !frameError && <p className="report-hint">Preparing your photos…</p>}
          <p className="report-hint report-hint--after">Check that your face is clear in all three photos. Nothing has been sent yet.</p>
          {frameError && <p role="alert" className="report-field-error">{frameError}</p>}
          <div className="report-actions">
            <button ref={acceptButton} type="button" className="report-btn" disabled={!previewUrl} onClick={acceptPhotos}>Use these photos</button>
            <button type="button" className="report-btn report-btn--secondary" onClick={() => void openCamera()}>Retake</button>
            <button type="button" className="report-link-btn" onClick={close}>Cancel</button>
          </div>
        </>
      )}

      {phase === "unavailable" && problem && (
        <>
          <p role="alert" className="report-warning" style={{ marginTop: 0 }}>
            {problem.message}
            {optional ? " The selfie check is optional: you can send your report without it." : " If you cannot use a camera, contact the project team and quote your reference."}
          </p>
          <div className="report-actions">
            {problem.retryable && <button type="button" className="report-btn" onClick={() => void openCamera()}>Try again</button>}
            <button type="button" className="report-btn report-btn--secondary" onClick={close}>Close</button>
          </div>
        </>
      )}
    </section>
  );
}
