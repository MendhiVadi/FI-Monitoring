import { Modal } from "../../shared/ui/Modal";
import { inputStyle, submitBtnStyle, iconBtnStyle } from "./login.styles";
import { ServerClock } from "./ServerClock";
import { useLogin } from "./useLogin";

export function Login() {
  const {
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
  } = useLogin();

  return (
    <main
      style={{
        minHeight: "100vh",
        background: "radial-gradient(ellipse at 50% 20%, #0c1c38 0%, #040a16 75%)",
        padding: "6.5rem 1.5rem 4rem",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        color: "#f8fafc",
        position: "relative",
      }}
    >
      {/* Background ambient lighting */}
      <div
        style={{
          position: "absolute",
          top: "10%",
          left: "50%",
          transform: "translateX(-50%)",
          width: "650px",
          height: "350px",
          background: "radial-gradient(circle, rgba(16, 185, 129, 0.12) 0%, rgba(2, 6, 23, 0) 70%)",
          pointerEvents: "none",
          filter: "blur(60px)",
        }}
      />

      {/* Main Container */}
      <div style={{ width: "100%", maxWidth: 640, zIndex: 1 }}>
        {/* National / Ministry Header Bar */}
        <div
          style={{
            background: "linear-gradient(135deg, rgba(15, 23, 42, 0.8), rgba(8, 15, 30, 0.95))",
            border: "1px solid rgba(123, 216, 159, 0.25)",
            borderRadius: "16px 16px 0 0",
            padding: "1.25rem 1.75rem",
            borderBottom: "1px solid rgba(255, 255, 255, 0.08)",
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            flexWrap: "wrap",
            gap: "0.75rem",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: "0.85rem" }}>
            <div
              style={{
                width: 44,
                height: 44,
                borderRadius: 10,
                background: "linear-gradient(135deg, #10b981, #065f46)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                fontSize: "1.4rem",
                boxShadow: "0 0 16px rgba(16, 185, 129, 0.4)",
              }}
            >
              🇮🇳
            </div>
            <div>
              <div
                style={{
                  fontSize: "0.68rem",
                  letterSpacing: "0.15em",
                  textTransform: "uppercase",
                  color: "#7bd89f",
                  fontWeight: 700,
                }}
              >
                FOREST WATCH • FRA MONITORING
              </div>
              <div style={{ fontSize: "1.05rem", fontWeight: 700, color: "#ffffff" }}>
                Forest Watch Officer Portal
              </div>
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
              color: "rgba(255, 255, 255, 0.7)",
            }}
          >
            <span
              style={{
                width: 6,
                height: 6,
                borderRadius: "50%",
                background: "#22c55e",
                boxShadow: "0 0 6px #22c55e",
              }}
            />
            <ServerClock />
          </div>
        </div>

        {/* Card Body */}
        <div
          style={{
            background: "rgba(11, 23, 42, 0.82)",
            backdropFilter: "blur(20px)",
            border: "1px solid rgba(123, 216, 159, 0.25)",
            borderTop: "none",
            borderRadius: "0 0 16px 16px",
            padding: "2rem",
            boxShadow: "0 25px 50px -12px rgba(0, 0, 0, 0.7)",
          }}
        >
          {/* Active Session Notice if already logged in */}
          {sessionOfficer && (
            <div
              style={{
                background: "linear-gradient(135deg, rgba(16, 185, 129, 0.15), rgba(6, 95, 70, 0.2))",
                border: "1px solid rgba(123, 216, 159, 0.4)",
                borderRadius: 10,
                padding: "1.1rem 1.25rem",
                marginBottom: "1.75rem",
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                flexWrap: "wrap",
                gap: "1rem",
              }}
            >
              <div>
                <div style={{ display: "flex", alignItems: "center", gap: "0.4rem" }}>
                  <span style={{ fontSize: "1rem" }}>🛡️</span>
                  <strong style={{ color: "#7bd89f", fontSize: "0.95rem" }}>
                    Active Official Session Detected
                  </strong>
                </div>
                <div style={{ fontSize: "0.83rem", color: "rgba(255,255,255,0.75)", marginTop: "0.2rem" }}>
                  Logged in as:{" "}
                  <code style={{ background: "rgba(0,0,0,0.3)", padding: "0.15rem 0.4rem", borderRadius: 4, color: "#fff" }}>
                    {sessionOfficer}
                  </code>
                </div>
              </div>
              <div style={{ display: "flex", gap: "0.6rem" }}>
                <button
                  onClick={() => navigate("/officer-portal")}
                  style={{
                    background: "#10b981",
                    border: "none",
                    borderRadius: 6,
                    padding: "0.45rem 0.95rem",
                    color: "#fff",
                    fontWeight: 600,
                    fontSize: "0.85rem",
                    cursor: "pointer",
                    boxShadow: "0 2px 8px rgba(16, 185, 129, 0.3)",
                  }}
                >
                  Enter Portal →
                </button>
                <button
                  onClick={handleSignOut}
                  style={{
                    background: "rgba(255, 255, 255, 0.08)",
                    border: "1px solid rgba(255, 255, 255, 0.2)",
                    borderRadius: 6,
                    padding: "0.45rem 0.85rem",
                    color: "rgba(255, 255, 255, 0.85)",
                    fontSize: "0.85rem",
                    cursor: "pointer",
                  }}
                >
                  Sign Out
                </button>
              </div>
            </div>
          )}

          {/* Status / Error alerts */}
          {errorMessage && (
            <div
              role="alert"
              style={{
                background: "rgba(239, 68, 68, 0.15)",
                border: "1px solid rgba(239, 68, 68, 0.4)",
                borderRadius: 8,
                padding: "0.75rem 1rem",
                marginBottom: "1.25rem",
                color: "#fca5a5",
                fontSize: "0.88rem",
                display: "flex",
                alignItems: "center",
                gap: "0.6rem",
              }}
            >
              <span>⚠️</span>
              <span>{errorMessage}</span>
            </div>
          )}

          {/* Email & Password Form */}
          {(
            <form onSubmit={handleEmailLogin} style={{ display: "grid", gap: "1.25rem" }}>
              <div>
                <label
                  htmlFor="officer-email"
                  style={{
                    display: "block",
                    fontSize: "0.84rem",
                    fontWeight: 600,
                    marginBottom: "0.4rem",
                    color: "#cbd5e1",
                  }}
                >
                  Official Government Email / ID
                </label>
                <div style={{ position: "relative" }}>
                  <input
                    id="officer-email"
                    type="email"
                    required
                    autoComplete="username"
                    aria-label="Officer email" placeholder="Official email address"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    style={inputStyle}
                  />
                  <span
                    style={{
                      position: "absolute",
                      right: "12px",
                      top: "50%",
                      transform: "translateY(-50%)",
                      fontSize: "0.95rem",
                      opacity: 0.5,
                      pointerEvents: "none",
                    }}
                  >
                    ✉️
                  </span>
                </div>
              </div>

              <div>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "0.4rem" }}>
                  <label
                    htmlFor="officer-password"
                    style={{
                      fontSize: "0.84rem",
                      fontWeight: 600,
                      color: "#cbd5e1",
                    }}
                  >
                    Account Password
                  </label>
                  <button
                    type="button"
                    onClick={() => setShowForgotModal(true)}
                    style={{
                      background: "none",
                      border: "none",
                      color: "#7bd89f",
                      fontSize: "0.8rem",
                      cursor: "pointer",
                      padding: 0,
                      textDecoration: "underline",
                    }}
                  >
                    Forgot password?
                  </button>
                </div>
                <div style={{ position: "relative" }}>
                  <input
                    id="officer-password"
                    type={showPassword ? "text" : "password"}
                    required
                    autoComplete="current-password"
                    placeholder="Enter security password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    style={{ ...inputStyle, paddingRight: "3rem" }}
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    style={{
                      position: "absolute",
                      right: "10px",
                      top: "50%",
                      transform: "translateY(-50%)",
                      background: "none",
                      border: "none",
                      color: "rgba(255,255,255,0.6)",
                      cursor: "pointer",
                      fontSize: "0.85rem",
                      padding: "0.2rem",
                    }}
                    title={showPassword ? "Hide password" : "Show password"}
                  >
                    {showPassword ? "👁️" : "🔒"}
                  </button>
                </div>
              </div>

              {/* Security CAPTCHA Section */}
              <div
                style={{
                  background: "rgba(0, 0, 0, 0.25)",
                  border: "1px solid rgba(255, 255, 255, 0.08)",
                  borderRadius: 10,
                  padding: "1rem",
                }}
              >
                <div
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                    marginBottom: "0.6rem",
                  }}
                >
                  <span style={{ fontSize: "0.82rem", fontWeight: 600, color: "#cbd5e1" }}>
                    Security Verification (CAPTCHA)
                  </span>
                  <div style={{ display: "flex", gap: "0.4rem" }}>
                    <button
                      type="button"
                      onClick={handleSpeakCaptcha}
                      style={iconBtnStyle}
                      title="Audio Pronunciation of Captcha for Accessibility"
                    >
                      🔊 Listen
                    </button>
                    <button
                      type="button"
                      onClick={handleRefreshCaptcha}
                      style={iconBtnStyle}
                      title="Regenerate Captcha Code"
                    >
                      🔄 Refresh
                    </button>
                  </div>
                </div>

                <div
                  style={{
                    display: "flex",
                    gap: "1rem",
                    alignItems: "center",
                    flexWrap: "wrap",
                  }}
                >
                  <canvas
                    ref={canvasRef}
                    width={180}
                    height={46}
                    style={{
                      borderRadius: 6,
                      border: "1px solid rgba(123, 216, 159, 0.3)",
                      background: "#030811",
                    }}
                  />
                  <input
                    type="text"
                    required
                    maxLength={6}
                    placeholder="Enter 6 characters"
                    value={captchaInput}
                    onChange={(e) => setCaptchaInput(e.target.value.toUpperCase())}
                    style={{
                      ...inputStyle,
                      flex: 1,
                      minWidth: "140px",
                      letterSpacing: "0.2em",
                      fontWeight: 700,
                      textTransform: "uppercase",
                    }}
                  />
                </div>
              </div>

              {/* Remember Session */}
              <label
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "0.6rem",
                  fontSize: "0.84rem",
                  color: "rgba(255,255,255,0.75)",
                  cursor: "pointer",
                }}
              >
                <input
                  type="checkbox"
                  checked={rememberOfficer}
                  onChange={(e) => setRememberOfficer(e.target.checked)}
                  style={{ accentColor: "#10b981", width: 16, height: 16 }}
                />
                <span>Remember sign-in on this device (maximum 8 hours)</span>
              </label>

              {/* Submit Button */}
              <button
                type="submit"
                disabled={busy}
                style={{
                  ...submitBtnStyle,
                  opacity: busy ? 0.7 : 1,
                }}
              >
                {busy ? (
                  <span style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: "0.5rem" }}>
                    <span style={{ display: "inline-block", width: 14, height: 14, borderRadius: "50%", border: "2px solid #fff", borderTopColor: "transparent", animation: "fw-spin 0.8s linear infinite" }} />
                    Authenticating Official Credentials…
                  </span>
                ) : (
                  "Authenticate & Access Portal →"
                )}
              </button>
            </form>
          )}

          {/* Security Compliance Footnote */}
          <div
            style={{
              marginTop: "2rem",
              paddingTop: "1.25rem",
              borderTop: "1px solid rgba(255, 255, 255, 0.08)",
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              flexWrap: "wrap",
              gap: "0.75rem",
              fontSize: "0.75rem",
              color: "rgba(255, 255, 255, 0.5)",
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: "0.4rem" }}>
              <span>🔒</span>
              <span>Access restricted to authorized project staff</span>
            </div>
            <div>
              <span>FRA Grievance Portal v2.6.4</span>
            </div>
          </div>
        </div>
      </div>

      {/* Forgot Password Modal */}
      {showForgotModal && (
        <Modal label="Account recovery" onClose={() => setShowForgotModal(false)}>
          <div
            style={{
              background: "#0e1f38",
              border: "1px solid rgba(123, 216, 159, 0.3)",
              borderRadius: 14,
              padding: "2rem",
              maxWidth: 480,
              width: "100%",
              boxShadow: "0 20px 40px rgba(0,0,0,0.8)",
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1rem" }}>
              <h3 style={{ margin: 0, fontSize: "1.15rem", color: "#fff" }}>
                Official Account Recovery
              </h3>
              <button
                onClick={() => setShowForgotModal(false)}
                style={{
                  background: "none",
                  border: "none",
                  color: "rgba(255,255,255,0.6)",
                  fontSize: "1.2rem",
                  cursor: "pointer",
                }}
              >
                ✕
              </button>
            </div>
            <p style={{ fontSize: "0.85rem", color: "rgba(255,255,255,0.7)", lineHeight: 1.5, marginBottom: "1.25rem" }}>
              Portal credentials are issued and reset by the Forest Watch project administrator.
              Enter your departmental email and we will show you who to contact — no reset link is
              sent automatically.
            </p>
            <form onSubmit={handleResetPassword} style={{ display: "grid", gap: "1rem" }}>
              <input
                type="email"
                required
                placeholder="Official email address"
                value={resetEmail}
                onChange={(e) => setResetEmail(e.target.value)}
                style={inputStyle}
              />
              {resetStatus && (
                <p style={{ fontSize: "0.84rem", color: "#7bd89f", margin: 0 }}>
                  {resetStatus}
                </p>
              )}
              <div style={{ display: "flex", justifyContent: "flex-end", gap: "0.75rem", marginTop: "0.5rem" }}>
                <button
                  type="button"
                  onClick={() => setShowForgotModal(false)}
                  style={{
                    padding: "0.5rem 1rem",
                    borderRadius: 6,
                    background: "rgba(255,255,255,0.08)",
                    border: "1px solid rgba(255,255,255,0.15)",
                    color: "rgba(255,255,255,0.8)",
                    cursor: "pointer",
                    fontSize: "0.85rem",
                  }}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={busy}
                  style={{
                    padding: "0.5rem 1.25rem",
                    borderRadius: 6,
                    background: "#10b981",
                    border: "none",
                    color: "#fff",
                    fontWeight: 600,
                    cursor: "pointer",
                    fontSize: "0.85rem",
                  }}
                >
                  Show Contact
                </button>
              </div>
            </form>
          </div>
        </Modal>
      )}
    </main>
  );
}
