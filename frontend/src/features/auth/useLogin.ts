import React, { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { signInStaff, signOutStaff, readableStaffAuthError, useStaffSession } from "./staffSession";

/* ---------------- CAPTCHA GENERATOR HELPERS ---------------- */
function generateCaptchaCode(length = 6): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // Omit ambiguous characters like 0, O, 1, I
  let result = "";
  for (let i = 0; i < length; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}

export function useLogin() {
  const navigate = useNavigate();

  // Active session state, from the front-end-only staff session store.
  const { email: sessionOfficer } = useStaffSession();

  // Email login state
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [rememberOfficer, setRememberOfficer] = useState(false);

  // Security CAPTCHA state
  const [captchaCode, setCaptchaCode] = useState(() => generateCaptchaCode(6));
  const [captchaInput, setCaptchaInput] = useState("");
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  // Password reset helper
  const [showForgotModal, setShowForgotModal] = useState(false);
  const [resetEmail, setResetEmail] = useState("");
  const [resetStatus, setResetStatus] = useState<string | null>(null);

  // UI status
  const [busy, setBusy] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Render Security CAPTCHA onto HTML5 Canvas
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // Background gradient with grid
    const bgGrad = ctx.createLinearGradient(0, 0, canvas.width, canvas.height);
    bgGrad.addColorStop(0, "#081324");
    bgGrad.addColorStop(1, "#030811");
    ctx.fillStyle = bgGrad;
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // Subtle security grid
    ctx.strokeStyle = "rgba(123, 216, 159, 0.08)";
    ctx.lineWidth = 1;
    for (let x = 0; x < canvas.width; x += 16) {
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, canvas.height);
      ctx.stroke();
    }
    for (let y = 0; y < canvas.height; y += 12) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(canvas.width, y);
      ctx.stroke();
    }

    // Noise dots
    for (let i = 0; i < 45; i++) {
      ctx.fillStyle = `rgba(123, 216, 159, ${Math.random() * 0.4})`;
      ctx.beginPath();
      ctx.arc(
        Math.random() * canvas.width,
        Math.random() * canvas.height,
        Math.random() * 1.6 + 0.4,
        0,
        Math.PI * 2
      );
      ctx.fill();
    }

    // Distorted crossing curves
    for (let i = 0; i < 3; i++) {
      ctx.strokeStyle = i % 2 === 0 ? "rgba(123, 216, 159, 0.35)" : "rgba(96, 165, 250, 0.35)";
      ctx.lineWidth = 1.4;
      ctx.beginPath();
      ctx.moveTo(0, Math.random() * canvas.height);
      ctx.bezierCurveTo(
        canvas.width * 0.3,
        Math.random() * canvas.height,
        canvas.width * 0.7,
        Math.random() * canvas.height,
        canvas.width,
        Math.random() * canvas.height
      );
      ctx.stroke();
    }

    // Draw stylized glyphs with jitter and rotation
    const chars = captchaCode.split("");
    const charSpacing = canvas.width / (chars.length + 1);
    ctx.textBaseline = "middle";

    chars.forEach((char, index) => {
      ctx.save();
      const x = charSpacing * (index + 1) + (Math.random() * 6 - 3);
      const y = canvas.height / 2 + (Math.random() * 6 - 3);
      const angle = (Math.random() * 32 - 16) * (Math.PI / 180);

      ctx.translate(x, y);
      ctx.rotate(angle);
      ctx.font = `bold ${Math.floor(Math.random() * 4 + 22)}px 'Courier New', monospace`;

      // Shadow
      ctx.fillStyle = "rgba(0, 0, 0, 0.6)";
      ctx.fillText(char, 2, 2);

      // Character fill
      ctx.fillStyle = index % 2 === 0 ? "#7bd89f" : "#93c5fd";
      ctx.fillText(char, 0, 0);

      ctx.restore();
    });
  }, [captchaCode]);

  // Regenerate the CAPTCHA image/input without touching any error message
  // that the caller just set (used on failed-login paths).
  const regenerateCaptcha = () => {
    if ("speechSynthesis" in window) window.speechSynthesis.cancel();
    setCaptchaCode(generateCaptchaCode(6));
    setCaptchaInput("");
  };

  // Refresh CAPTCHA (manual "Refresh" button — also clears any stale error)
  const handleRefreshCaptcha = () => {
    regenerateCaptcha();
    setErrorMessage(null);
  };

  // Stop any in-progress CAPTCHA readout when the page unmounts, so it does
  // not keep announcing a code that is no longer on screen.
  useEffect(() => {
    return () => {
      if ("speechSynthesis" in window) window.speechSynthesis.cancel();
    };
  }, []);

  // Text-to-speech for accessibility
  const handleSpeakCaptcha = () => {
    if ("speechSynthesis" in window) {
      window.speechSynthesis.cancel();
      const spelled = captchaCode.split("").join(" . ");
      const utterance = new SpeechSynthesisUtterance(`Captcha characters are: ${spelled}`);
      utterance.rate = 0.85;
      utterance.pitch = 1.0;
      window.speechSynthesis.speak(utterance);
    } else {
      alert(`Captcha code is: ${captchaCode}`);
    }
  };

  // Submit Email & Password login against real Firebase Auth, gated by the
  // officers/{uid} allow-list — see ./staffSession for how that boundary
  // is enforced.
  const handleEmailLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMessage(null);

    // Validate CAPTCHA
    if (captchaInput.trim().toUpperCase() !== captchaCode.toUpperCase()) {
      setErrorMessage("Security CAPTCHA verification code is incorrect. Please re-enter.");
      regenerateCaptcha();
      return;
    }

    setBusy(true);
    try {
      await signInStaff(email, password, rememberOfficer);
      navigate("/officer-portal");
    } catch (err) {
      setErrorMessage(readableStaffAuthError(err));
      regenerateCaptcha();
    } finally {
      setBusy(false);
    }
  };

  // Handle password reset. There is no account store to reset against any
  // more, so this only tells the officer who to contact.
  const handleResetPassword = (e: React.FormEvent) => {
    e.preventDefault();
    if (!resetEmail) {
      setResetStatus("Enter your official government email address first.");
      return;
    }
    setResetStatus(
      "Credentials for this portal are issued by the Forest Watch project administrator. Contact them to have yours reset."
    );
  };

  // Handle sign out
  const handleSignOut = signOutStaff;

  return {
    navigate,
    sessionOfficer,
    email,
    setEmail,
    password,
    setPassword,
    showPassword,
    setShowPassword,
    rememberOfficer,
    setRememberOfficer,
    captchaInput,
    setCaptchaInput,
    canvasRef,
    showForgotModal,
    setShowForgotModal,
    resetEmail,
    setResetEmail,
    resetStatus,
    busy,
    errorMessage,
    handleRefreshCaptcha,
    handleSpeakCaptcha,
    handleEmailLogin,
    handleResetPassword,
    handleSignOut,
  };
}
