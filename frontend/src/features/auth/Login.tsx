import { Modal } from "../../shared/ui/Modal";
import {
  inputStyle, invalidInputStyle, submitBtnStyle, iconBtnStyle, secondaryBtnStyle, fieldErrorStyle, hintStyle,
} from "./login.styles";
import { ServerClock } from "./ServerClock";
import { Spinner } from "./Spinner";
import { useLogin } from "./useLogin";
import "./login.css";

// Joins the ids of the messages that currently describe an input.
const describedBy = (...ids: (string | false | null | undefined)[]) => ids.filter(Boolean).join(" ") || undefined;

const labelStyle = { display: "block", fontSize: "0.88rem", fontWeight: 600, marginBottom: "0.4rem", color: "#e2e8f0" } as const;

export function Login() {
  const {
    ready,
    sessionOfficer,
    signOutNotice,
    email,
    setEmail,
    handleEmailBlur,
    password,
    setPassword,
    showPassword,
    setShowPassword,
    capsLock,
    handlePasswordKey,
    handlePasswordBlur,
    rememberOfficer,
    setRememberOfficer,
    captchaInput,
    setCaptchaInput,
    captchaSpelled,
    canvasRef,
    emailRef,
    passwordRef,
    captchaRef,
    showForgotModal,
    setShowForgotModal,
    busy,
    waitSeconds,
    waitTotal,
    errorMessage,
    errorField,
    fieldErrors,
    handleRefreshCaptcha,
    handleSpeakCaptcha,
    handleEmailLogin,
    handleContinue,
    handleSignOut,
  } = useLogin();

  // While a sign-in is in flight the form stays up, even though the session
  // store briefly reports "checking" and then "signed in".
  const view = busy ? "form" : !ready ? "checking" : sessionOfficer ? "session" : "form";
  const waiting = waitSeconds > 0;
  const submitBlocked = busy || waiting;
  const waitClock = `${Math.floor(waitSeconds / 60)}:${String(waitSeconds % 60).padStart(2, "0")}`;

  return (
    <main
      className="login-page"
      style={{
        minHeight: "100vh",
        background: "radial-gradient(ellipse at 50% 20%, #0c1c38 0%, #040a16 75%)",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        color: "#f8fafc",
        position: "relative",
        boxSizing: "border-box",
      }}
    >
      {/* Background ambient lighting */}
      <div
        aria-hidden="true"
        style={{
          position: "absolute",
          top: "10%",
          left: "50%",
          transform: "translateX(-50%)",
          width: "min(650px, 100%)",
          height: "350px",
          background: "radial-gradient(circle, rgba(16, 185, 129, 0.12) 0%, rgba(2, 6, 23, 0) 70%)",
          pointerEvents: "none",
          filter: "blur(60px)",
        }}
      />

      {/* Main Container */}
      <div style={{ width: "100%", maxWidth: 640, zIndex: 1 }}>
        {/* Portal header bar */}
        <div
          className="login-header"
          style={{
            background: "linear-gradient(135deg, rgba(15, 23, 42, 0.8), rgba(8, 15, 30, 0.95))",
            border: "1px solid rgba(123, 216, 159, 0.25)",
            borderRadius: "16px 16px 0 0",
            borderBottom: "1px solid rgba(255, 255, 255, 0.08)",
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            flexWrap: "wrap",
            gap: "0.75rem",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: "0.85rem", minWidth: 0 }}>
            <div
              aria-hidden="true"
              style={{
                width: 44,
                height: 44,
                flex: "none",
                borderRadius: 10,
                background: "linear-gradient(135deg, #10b981, #065f46)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                boxShadow: "0 0 16px rgba(16, 185, 129, 0.4)",
              }}
            >
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <rect x="4" y="10" width="16" height="11" rx="2" />
                <path d="M8 10V7a4 4 0 0 1 8 0v3" />
              </svg>
            </div>
            <div style={{ minWidth: 0 }}>
              <div
                style={{
                  fontSize: "0.7rem",
                  letterSpacing: "0.15em",
                  textTransform: "uppercase",
                  color: "#7bd89f",
                  fontWeight: 700,
                }}
              >
                Land Dispute · Staff access
              </div>
              <h1 style={{ fontSize: "1.2rem", fontWeight: 700, color: "#ffffff", margin: 0 }}>
                Staff sign-in
              </h1>
            </div>
          </div>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: "0.5rem",
              background: "rgba(255, 255, 255, 0.05)",
              border: "1px solid rgba(255, 255, 255, 0.1)",
              borderRadius: 6,
              padding: "0.35rem 0.65rem",
              fontSize: "0.76rem",
              color: "rgba(255, 255, 255, 0.75)",
            }}
          >
            <ServerClock />
          </div>
        </div>

        {/* Card Body */}
        <div
          className="login-card"
          style={{
            background: "rgba(11, 23, 42, 0.82)",
            backdropFilter: "blur(20px)",
            border: "1px solid rgba(123, 216, 159, 0.25)",
            borderTop: "none",
            borderRadius: "0 0 16px 16px",
            boxShadow: "0 25px 50px -12px rgba(0, 0, 0, 0.7)",
          }}
        >
          {/* Why the officer was sent here (session ended, or signed out) */}
          {signOutNotice && view === "form" && (
            <p
              role="status"
              style={{
                background: "rgba(96, 165, 250, 0.12)",
                border: "1px solid rgba(96, 165, 250, 0.4)",
                borderRadius: 8,
                padding: "0.75rem 1rem",
                margin: "0 0 1.25rem",
                color: "#bfdbfe",
                fontSize: "0.88rem",
                lineHeight: 1.5,
              }}
            >
              {signOutNotice}
            </p>
          )}

          {view === "checking" && (
            // Same height as the form, so nothing jumps when the check ends.
            <div role="status" className="login-checking">
              <Spinner size={22} color="#7bd89f" />
              <span>Checking for an existing staff session…</span>
            </div>
          )}

          {/* Already signed in: offer to continue, or switch account */}
          {view === "session" && (
            <section
              aria-labelledby="session-heading"
              style={{
                background: "linear-gradient(135deg, rgba(16, 185, 129, 0.15), rgba(6, 95, 70, 0.2))",
                border: "1px solid rgba(123, 216, 159, 0.4)",
                borderRadius: 10,
                padding: "1.1rem 1.25rem",
              }}
            >
              <h2 id="session-heading" style={{ margin: 0, color: "#7bd89f", fontSize: "1rem" }}>
                You are already signed in
              </h2>
              <p style={{ fontSize: "0.88rem", color: "rgba(255,255,255,0.8)", margin: "0.35rem 0 1rem", overflowWrap: "anywhere" }}>
                Signed in as{" "}
                <code style={{ background: "rgba(0,0,0,0.3)", padding: "0.15rem 0.4rem", borderRadius: 4, color: "#fff" }}>
                  {sessionOfficer}
                </code>
              </p>
              <div className="login-session-actions" style={{ display: "flex", gap: "0.6rem", flexWrap: "wrap" }}>
                <button
                  type="button"
                  autoFocus
                  onClick={handleContinue}
                  style={{ ...submitBtnStyle, minHeight: 44, padding: "0.5rem 1.1rem", fontSize: "0.9rem" }}
                >
                  Continue to portal
                </button>
                <button type="button" onClick={handleSignOut} style={secondaryBtnStyle}>
                  Sign in with a different account
                </button>
              </div>
            </section>
          )}

          {view === "form" && (
            <>
              {/* Form-level error and failed sign-in wait */}
              {(errorMessage || waiting) && (
                <div
                  id="login-error"
                  role="alert"
                  style={{
                    background: "rgba(239, 68, 68, 0.15)",
                    border: "1px solid rgba(239, 68, 68, 0.4)",
                    borderRadius: 8,
                    padding: "0.75rem 1rem",
                    marginBottom: "1.25rem",
                    color: "#fca5a5",
                    fontSize: "0.88rem",
                    lineHeight: 1.5,
                  }}
                >
                  {errorMessage && <p style={{ margin: 0 }}>{errorMessage}</p>}
                  {waiting && (
                    <p style={{ margin: errorMessage ? "0.35rem 0 0" : 0 }}>
                      Too many failed sign-in attempts.{" "}
                      {/* The ticking clock is hidden from screen readers so it is not
                          re-announced every second; they hear the wait once. */}
                      <span aria-hidden="true" style={{ fontVariantNumeric: "tabular-nums", fontWeight: 600 }}>
                        Try again in {waitClock}
                      </span>
                      <span className="login-sr-only">You can try again in about {waitTotal} seconds.</span>
                    </p>
                  )}
                </div>
              )}

              {/* Email & Password Form */}
              <form onSubmit={handleEmailLogin} noValidate style={{ display: "grid", gap: "1.25rem" }}>
                <div>
                  <label htmlFor="officer-email" style={labelStyle}>
                    Work email
                  </label>
                  <input
                    ref={emailRef}
                    id="officer-email"
                    type="email"
                    required
                    autoComplete="username"
                    inputMode="email"
                    spellCheck={false}
                    placeholder="name@example.org"
                    maxLength={254}
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    onBlur={handleEmailBlur}
                    aria-invalid={fieldErrors.email ? true : undefined}
                    aria-describedby={describedBy(fieldErrors.email && "email-error")}
                    style={{ ...inputStyle, ...(fieldErrors.email ? invalidInputStyle : null) }}
                  />
                  {fieldErrors.email && (
                    <p id="email-error" role="alert" style={fieldErrorStyle}>{fieldErrors.email}</p>
                  )}
                </div>

                <div>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", columnGap: "1rem" }}>
                    <label htmlFor="officer-password" style={{ ...labelStyle, marginBottom: 0 }}>
                      Password
                    </label>
                    <button type="button" className="login-link-btn" onClick={() => setShowForgotModal(true)}>
                      Forgot password?
                    </button>
                  </div>
                  <div style={{ position: "relative" }}>
                    <input
                      ref={passwordRef}
                      id="officer-password"
                      type={showPassword ? "text" : "password"}
                      required
                      autoComplete="current-password"
                      maxLength={4096}
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      onKeyDown={handlePasswordKey}
                      onKeyUp={handlePasswordKey}
                      onBlur={handlePasswordBlur}
                      aria-invalid={fieldErrors.password ? true : undefined}
                      aria-describedby={describedBy(
                        errorField === "password" && "login-error",
                        fieldErrors.password && "password-error",
                        capsLock && "caps-hint",
                      )}
                      style={{ ...inputStyle, paddingRight: "4.5rem", ...(fieldErrors.password ? invalidInputStyle : null) }}
                    />
                    <button
                      type="button"
                      className="login-reveal-btn"
                      aria-controls="officer-password"
                      onClick={() => setShowPassword(!showPassword)}
                    >
                      {showPassword ? "Hide" : "Show"}
                      <span className="login-sr-only"> password</span>
                    </button>
                  </div>
                  {fieldErrors.password && (
                    <p id="password-error" role="alert" style={fieldErrorStyle}>{fieldErrors.password}</p>
                  )}
                  {/* Kept mounted (empty) so the status is announced when it appears. */}
                  <p id="caps-hint" role="status" className="login-caps">
                    {capsLock ? "Caps Lock is on" : ""}
                  </p>
                </div>

                {/* Security CAPTCHA Section */}
                <fieldset
                  style={{
                    margin: 0,
                    minWidth: 0,
                    background: "rgba(0, 0, 0, 0.25)",
                    border: "1px solid rgba(255, 255, 255, 0.08)",
                    borderRadius: 10,
                    padding: "1rem",
                  }}
                >
                  <legend style={{ padding: "0 0.35rem", fontSize: "0.84rem", fontWeight: 600, color: "#e2e8f0" }}>
                    Security check
                  </legend>

                  <div style={{ display: "flex", gap: "0.75rem", alignItems: "center", flexWrap: "wrap" }}>
                    <canvas
                      ref={canvasRef}
                      width={180}
                      height={46}
                      role="img"
                      aria-label="CAPTCHA image. Use Listen for an audio version."
                      style={{
                        maxWidth: "100%",
                        borderRadius: 6,
                        border: "1px solid rgba(123, 216, 159, 0.3)",
                        background: "#030811",
                      }}
                    />
                    <div style={{ display: "flex", gap: "0.5rem" }}>
                      <button type="button" onClick={handleSpeakCaptcha} style={iconBtnStyle}>
                        Listen
                      </button>
                      <button type="button" onClick={handleRefreshCaptcha} style={iconBtnStyle}>
                        New code
                      </button>
                    </div>
                  </div>

                  {/* Kept mounted (empty) so the spelling is announced when it appears. */}
                  <p role="status" style={captchaSpelled ? { ...hintStyle, color: "#cbd5e1" } : { margin: 0 }}>
                    {captchaSpelled ? `Audio is not available in this browser. The code is: ${captchaSpelled}.` : ""}
                  </p>

                  <label htmlFor="captcha" style={{ ...labelStyle, marginTop: "0.85rem" }}>
                    Type the characters shown
                  </label>
                  <input
                    ref={captchaRef}
                    id="captcha"
                    type="text"
                    required
                    maxLength={6}
                    autoComplete="off"
                    autoCapitalize="characters"
                    autoCorrect="off"
                    spellCheck={false}
                    value={captchaInput}
                    onChange={(e) => setCaptchaInput(e.target.value.toUpperCase())}
                    aria-invalid={fieldErrors.captcha ? true : undefined}
                    aria-describedby={describedBy("captcha-hint", fieldErrors.captcha && "captcha-error")}
                    style={{
                      ...inputStyle,
                      letterSpacing: "0.2em",
                      fontWeight: 700,
                      textTransform: "uppercase",
                      ...(fieldErrors.captcha ? invalidInputStyle : null),
                    }}
                  />
                  <p id="captcha-hint" style={hintStyle}>Not case-sensitive · 6 characters</p>
                  {fieldErrors.captcha && (
                    <p id="captcha-error" role="alert" style={fieldErrorStyle}>{fieldErrors.captcha}</p>
                  )}
                </fieldset>

                {/* Remember Session */}
                <label
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: "0.6rem",
                    minHeight: 44,
                    fontSize: "0.88rem",
                    color: "rgba(255,255,255,0.8)",
                    cursor: "pointer",
                  }}
                >
                  <input
                    type="checkbox"
                    checked={rememberOfficer}
                    onChange={(e) => setRememberOfficer(e.target.checked)}
                    style={{ accentColor: "#10b981", width: 18, height: 18, flex: "none", margin: 0 }}
                  />
                  <span>Keep me signed in on this device (up to 8 hours)</span>
                </label>

                {/* Submit Button. aria-disabled (not disabled) keeps keyboard focus on
                    it while busy; the handler ignores presses until it can run. */}
                <button
                  type="submit"
                  aria-disabled={submitBlocked || undefined}
                  style={{
                    ...submitBtnStyle,
                    opacity: submitBlocked ? 0.7 : 1,
                  }}
                >
                  {busy ? (
                    <span style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: "0.5rem" }}>
                      <Spinner />
                      Signing in…
                    </span>
                  ) : waiting ? (
                    `Wait ${waitSeconds} s`
                  ) : (
                    "Sign in"
                  )}
                </button>
              </form>
            </>
          )}

          {/* Access footnote */}
          <div
            style={{
              marginTop: "2rem",
              paddingTop: "1.25rem",
              borderTop: "1px solid rgba(255, 255, 255, 0.08)",
              fontSize: "0.8rem",
              color: "rgba(255, 255, 255, 0.6)",
            }}
          >
            Access is limited to authorised staff of this deployment.
          </div>
        </div>
      </div>

      {/* Account recovery: an explanation only. This portal has no self-service
          reset, so it does not pretend to collect an email address. */}
      {showForgotModal && (
        <Modal label="Account recovery" onClose={() => setShowForgotModal(false)}>
          <div
            style={{
              background: "#0e1f38",
              border: "1px solid rgba(123, 216, 159, 0.3)",
              borderRadius: 14,
              padding: "1.5rem",
              maxWidth: 480,
              width: "100%",
              boxSizing: "border-box",
              boxShadow: "0 20px 40px rgba(0,0,0,0.8)",
              color: "#f8fafc",
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <h2 style={{ margin: "0 0 0.75rem", fontSize: "1.15rem", color: "#fff" }}>
              Forgot your password?
            </h2>
            <p style={{ fontSize: "0.92rem", color: "rgba(255,255,255,0.8)", lineHeight: 1.55, margin: "0 0 1.25rem" }}>
              Staff accounts for this deployment are created and reset by its administrator.
              This page cannot send a reset link. Contact the person or team who gave you access
              and ask them to reset your password.
            </p>
            <div style={{ display: "flex", justifyContent: "flex-end" }}>
              <button type="button" onClick={() => setShowForgotModal(false)} style={secondaryBtnStyle}>
                Close
              </button>
            </div>
          </div>
        </Modal>
      )}
    </main>
  );
}
