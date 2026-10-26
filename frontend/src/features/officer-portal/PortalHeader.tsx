import { useEffect, useRef, useState, type MouseEvent } from "react";
import { Link } from "react-router-dom";
import { useStaffSession } from "../auth/staffSession";
import { SessionExpiryBanner } from "../auth/SessionExpiryBanner";
import { PortalClock } from "./PortalClock";
import { initialsFrom } from "./presentation";
import { styles } from "./portal.styles";

const sessionEnd = new Intl.DateTimeFormat("en-IN", { timeZone: "Asia/Kolkata", hour: "numeric", minute: "2-digit", hour12: true });

// Full header on wider screens; on phones a single row with one avatar button
// whose menu holds the account, the public-site link and sign-out.
export function PortalHeader({ officerEmail, onLogout, confirmLeave }: {
  officerEmail: string | null; onLogout: () => void; confirmLeave: () => boolean;
}) {
  const { expiresAt } = useStaffSession();
  // Leaving the portal drops unsaved note and reason drafts, as signing out does.
  // A modified click opens a new tab and keeps this page, so it needs no prompt.
  const guardLeave = (event: MouseEvent) => {
    if (event.button === 0 && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey && !confirmLeave()) event.preventDefault();
  };
  const initials = initialsFrom(officerEmail);
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null), toggleRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!menuOpen) return;
    const onPointer = (event: PointerEvent) => { if (!menuRef.current?.parentElement?.contains(event.target as Node)) setMenuOpen(false); };
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") { setMenuOpen(false); toggleRef.current?.focus(); } };
    document.addEventListener("pointerdown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("pointerdown", onPointer); document.removeEventListener("keydown", onKey); };
  }, [menuOpen]);

  return (
    <header className="portal-header" style={styles.portalHeader}>
      <div style={styles.portalHeaderInner}>
        <div style={{ display: "flex", alignItems: "center", gap: "12px", minWidth: 0 }}>
          <div style={{ ...styles.crestMiniCircle, flex: "none" }} aria-hidden="true">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#22c55e" strokeWidth="2.2">
              <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
              <path d="m9 12 2 2 4-4" />
            </svg>
          </div>
          <div style={{ minWidth: 0 }}>
            <div style={{ display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap" }}>
              <span style={{ fontWeight: 800, fontSize: "clamp(0.92rem, 2.6vw, 1.1rem)", letterSpacing: "-0.01em", color: "#f3f4f6" }}>
                Land Dispute Review Portal
              </span>
              <span className="portal-live-badge" style={styles.liveBadge}>STAFF PORTAL</span>
            </div>
            <div className="portal-header-tagline" style={{ fontSize: "0.75rem", color: "#9ca3af" }}>
              Case review and follow-up
            </div>
          </div>
        </div>

        <div className="portal-header-full">
          {/* Realtime clock */}
          <div style={styles.headerTimeBox}>
            <span aria-hidden="true" style={{ color: "#22c55e", marginRight: "6px" }}>●</span>
            <PortalClock />
          </div>
          <Link to="/" className="portal-btn" style={{ ...styles.modalSecondaryBtn, textDecoration: "none" }} onClick={guardLeave}>Public site</Link>

          {/* Staff account */}
          <div style={styles.officerProfilePill}>
            <div style={styles.avatarCircle} aria-hidden="true">{initials}</div>
            <div style={{ textAlign: "left", fontSize: "0.75rem", lineHeight: 1.2 }}>
              <div style={{ fontWeight: 700, color: "#f3f4f6" }}>Signed in</div>
              <div style={{ color: "#9ca3af", maxWidth: 160, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={officerEmail ?? undefined}>
                {officerEmail}
              </div>
            </div>
          </div>

          {/* Sign Out */}
          <button type="button" onClick={onLogout} style={styles.signOutBtn}>
            <svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
              <polyline points="16 17 21 12 16 7" />
              <line x1="21" y1="12" x2="9" y2="12" />
            </svg>
            Sign out
          </button>
        </div>

        <div className="portal-header-compact">
          <button
            ref={toggleRef}
            type="button"
            style={styles.avatarButton}
            aria-expanded={menuOpen}
            aria-controls="portal-account-menu"
            aria-label="Account menu"
            onClick={() => setMenuOpen(open => !open)}
          >
            {initials}
          </button>
          {menuOpen && (
            <div id="portal-account-menu" ref={menuRef} className="portal-menu">
              <div style={{ padding: "0.4rem 0.75rem 0.5rem", fontSize: "0.8rem", color: "#cbd5e1", overflowWrap: "anywhere" }}>
                {officerEmail}
                {expiresAt && <div style={{ color: "#94a3b8", marginTop: 2 }}>Session ends {sessionEnd.format(new Date(expiresAt))} IST</div>}
              </div>
              <Link to="/" onClick={(event) => { guardLeave(event); if (!event.defaultPrevented) setMenuOpen(false); }}>Public site</Link>
              <button type="button" style={{ color: "#fca5a5" }} onClick={() => { setMenuOpen(false); onLogout(); }}>Sign out</button>
            </div>
          )}
        </div>
      </div>
      <SessionExpiryBanner />
    </header>
  );
}
