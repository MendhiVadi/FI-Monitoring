import { useEffect, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { onAuthStateChanged, type User } from "firebase/auth";
import { auth } from "../lib/firebase";
import { signOutQuietly } from "../lib/auth";

export function Header() {
  const [user, setUser] = useState<User | null>(null);
  const navigate = useNavigate();
  const location = useLocation();
  const isLandingPage = location.pathname === "/";

  useEffect(() => {
    return onAuthStateChanged(auth, setUser);
  }, []);

  const isLoggedIn = Boolean(user);

  const handleSignOut = async () => {
    await signOutQuietly();
    navigate("/login");
  };

  return (
    <header
      style={{
        position: "fixed",
        top: 0,
        left: 0,
        right: 0,
        zIndex: 50,
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        padding: "0.75rem clamp(1rem, 4vw, 2rem)",
        background: "rgba(4, 10, 22, 0.75)",
        backdropFilter: "blur(12px)",
        borderBottom: "1px solid rgba(255, 255, 255, 0.08)",
      }}
    >
      <Link
        to="/"
        style={{
          display: "flex",
          alignItems: "center",
          gap: "0.5rem",
          color: "white",
          fontWeight: 700,
          fontSize: "clamp(0.95rem, 3.2vw, 1.1rem)",
          textDecoration: "none",
          letterSpacing: "-0.01em",
          whiteSpace: "nowrap",
        }}
      >
        <span
          style={{
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            width: 26,
            height: 26,
            flexShrink: 0,
            borderRadius: 6,
            background: "linear-gradient(135deg, #10b981, #047857)",
            fontSize: "0.85rem",
            boxShadow: "0 0 10px rgba(16, 185, 129, 0.4)",
          }}
        >
          🌲
        </span>
        <span>Forest Watch</span>
      </Link>
      <nav style={{ display: "flex", alignItems: "center", gap: "clamp(0.5rem, 2vw, 1.25rem)" }}>
        <Link to="/report" style={navLinkStyle}>
          Raise a Dispute
        </Link>

        {isLoggedIn ? (
          <div style={{ display: "flex", alignItems: "center", gap: "clamp(0.4rem, 1.5vw, 0.85rem)" }}>
            <Link
              to="/officer-portal"
              style={{
                ...navLinkStyle,
                display: "inline-flex",
                alignItems: "center",
                gap: "0.4rem",
                padding: "0.3rem clamp(0.5rem, 2vw, 0.75rem)",
                borderRadius: 6,
                background: "rgba(123, 216, 159, 0.15)",
                border: "1px solid rgba(123, 216, 159, 0.35)",
                color: "#7bd89f",
                fontWeight: 600,
              }}
            >
              <span
                style={{
                  width: 7,
                  height: 7,
                  flexShrink: 0,
                  borderRadius: "50%",
                  background: "#22c55e",
                  boxShadow: "0 0 6px #22c55e",
                }}
              />
              Officer Portal
            </Link>
            {!isLandingPage && (
            <button
              onClick={handleSignOut}
              style={{
                background: "transparent",
                border: "1px solid rgba(255, 255, 255, 0.15)",
                borderRadius: 6,
                padding: "0.3rem clamp(0.5rem, 2vw, 0.75rem)",
                color: "rgba(255, 255, 255, 0.75)",
                fontSize: "clamp(0.78rem, 2.6vw, 0.85rem)",
                whiteSpace: "nowrap",
                cursor: "pointer",
                transition: "all 0.2s",
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.borderColor = "rgba(248, 113, 113, 0.4)";
                e.currentTarget.style.color = "#f87171";
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.borderColor = "rgba(255, 255, 255, 0.15)";
                e.currentTarget.style.color = "rgba(255, 255, 255, 0.75)";
              }}
            >
              Sign out
            </button>
            )}
          </div>
        ) : (
          <Link
            to="/login"
            style={{
              ...navLinkStyle,
              padding: "0.3rem clamp(0.55rem, 2vw, 0.85rem)",
              borderRadius: 6,
              background: "rgba(255, 255, 255, 0.06)",
              border: "1px solid rgba(255, 255, 255, 0.12)",
            }}
          >
            Staff login
          </Link>
        )}
      </nav>
    </header>
  );
}

const navLinkStyle: React.CSSProperties = {
  color: "rgba(255,255,255,0.85)",
  textDecoration: "none",
  fontSize: "clamp(0.78rem, 2.6vw, 0.92rem)",
  whiteSpace: "nowrap",
  transition: "opacity 0.15s ease",
};

