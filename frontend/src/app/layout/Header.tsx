import { useEffect, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { signOutStaff, useStaffSession } from "../../features/auth/staffSession";
import { loadLogin, loadReportIssue, prefetchHeaderRoutesWhenIdle, prefetchRoute } from "../routeChunks";

export function Header() {
  const { isStaff, ready } = useStaffSession();
  const navigate = useNavigate();
  const location = useLocation();
  const isLandingPage = location.pathname === "/";
  const [scrolled, setScrolled] = useState(false);

  // Both header destinations are lazily-loaded routes, so the very first
  // click paid for the chunk download before anything rendered. Warm them
  // once the browser goes idle instead.
  useEffect(prefetchHeaderRoutesWhenIdle, []);

  // The bar sits over the hero, so it stays nearly transparent at the top of
  // the page and only picks up its blur/border once content scrolls under it.
  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 12);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  const isLoggedIn = isStaff;

  const handleSignOut = () => {
    signOutStaff();
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
        background: scrolled ? "rgba(4, 10, 22, 0.82)" : "rgba(4, 10, 22, 0.25)",
        backdropFilter: scrolled ? "blur(14px) saturate(140%)" : "blur(6px)",
        borderBottom: `1px solid ${scrolled ? "rgba(123, 216, 159, 0.16)" : "transparent"}`,
        transition: "background 0.25s ease, border-color 0.25s ease, backdrop-filter 0.25s ease",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: "1rem",
          // Match the 1100px content column used by the sections below, so the
          // logo and nav line up with the page instead of hugging the viewport.
          maxWidth: 1160,
          margin: "0 auto",
          padding: "0.85rem clamp(1rem, 4vw, 2rem)",
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
            width: 30,
            height: 30,
            flexShrink: 0,
            borderRadius: 9,
            background: "linear-gradient(135deg, #34d399, #047857)",
            fontSize: "0.95rem",
            boxShadow: "0 2px 10px rgba(16, 185, 129, 0.35), inset 0 1px 0 rgba(255,255,255,0.25)",
          }}
        >
          🌲
        </span>
        <span style={{ display: "flex", flexDirection: "column", lineHeight: 1.15 }}>
          Forest Watch
          <span
            style={{
              fontSize: "0.6rem",
              fontWeight: 500,
              letterSpacing: "0.14em",
              textTransform: "uppercase",
              color: "rgba(123, 216, 159, 0.75)",
            }}
          >
            FRA Monitoring
          </span>
        </span>
      </Link>
      <nav style={{ display: "flex", alignItems: "center", gap: "clamp(0.5rem, 2vw, 1.25rem)" }}>
        <Link
          to="/report"
          style={navLinkStyle}
          onFocus={() => prefetchRoute(loadReportIssue)}
          onMouseEnter={(e) => {
            prefetchRoute(loadReportIssue);
            e.currentTarget.style.color = "#7bd89f";
          }}
          onMouseLeave={(e) => (e.currentTarget.style.color = "rgba(255,255,255,0.85)")}
        >
          Raise a Dispute
        </Link>

        {/* Render neither pill until the allow-list lookup settles, otherwise a
            signed-in officer sees "Staff login" flash on every page load. */}
        {!ready ? null : isLoggedIn ? (
          <div style={{ display: "flex", alignItems: "center", gap: "clamp(0.4rem, 1.5vw, 0.85rem)" }}>
            <Link
              to="/officer-portal"
              style={{
                ...navLinkStyle,
                display: "inline-flex",
                alignItems: "center",
                gap: "0.4rem",
                padding: "0.4rem clamp(0.6rem, 2vw, 0.9rem)",
                borderRadius: 999,
                background: "rgba(123, 216, 159, 0.14)",
                border: "1px solid rgba(123, 216, 159, 0.3)",
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
                borderRadius: 999,
                padding: "0.4rem clamp(0.6rem, 2vw, 0.9rem)",
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
            onMouseEnter={() => prefetchRoute(loadLogin)}
            onFocus={() => prefetchRoute(loadLogin)}
            style={{
              ...navLinkStyle,
              padding: "0.4rem clamp(0.65rem, 2vw, 0.95rem)",
              borderRadius: 999,
              background: "rgba(255, 255, 255, 0.06)",
              border: "1px solid rgba(255, 255, 255, 0.12)",
            }}
          >
            Staff login
          </Link>
        )}
        </nav>
      </div>
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
