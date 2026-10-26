import { useEffect, useState } from "react";
import { Link, NavLink, useNavigate } from "react-router-dom";
import { signOutStaff, useStaffSession } from "../../features/auth/staffSession";
import { loadLogin, loadReportIssue, prefetchHeaderRoutesWhenIdle, prefetchRoute } from "../routeChunks";
import "./layout.css";

export function Header() {
  const { isStaff, ready } = useStaffSession();
  const navigate = useNavigate();
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

  const handleSignOut = () => {
    signOutStaff();
    navigate("/login");
  };

  const prefetchReport = () => prefetchRoute(loadReportIssue);
  const prefetchLogin = () => prefetchRoute(loadLogin);

  return (
    <header className={`site-header${scrolled ? " is-scrolled" : ""}${ready && isStaff ? " site-header--staff" : ""}`}>
      <div className="site-header__inner">
        <Link to="/" className="site-header__brand">
          <span className="site-header__mark" aria-hidden="true">
            <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
              <path d="M20 10c0 6-8 12-8 12S4 16 4 10a8 8 0 1 1 16 0Z" />
              <circle cx="12" cy="10" r="2.5" />
            </svg>
          </span>
          <span className="site-header__name">
            Land Dispute
            <span className="site-header__tagline">Land &amp; Grievances</span>
          </span>
        </Link>
        <nav className="site-header__nav" aria-label="Primary">
          {/* The one public action, labelled and styled the same as the
              landing page's primary button. */}
          <NavLink
            to="/report"
            className="btn btn-primary site-header__cta"
            onFocus={prefetchReport}
            onMouseEnter={prefetchReport}
          >
            Report a dispute
          </NavLink>

          {/* Render no staff control until the allow-list lookup settles,
              otherwise a signed-in officer sees "Staff login" flash on every
              page load. Sign out is offered on every page, the landing page
              included, so a shared device can always be signed out. */}
          {!ready ? null : isStaff ? (
            <>
              <NavLink to="/officer-portal" className="site-header__link">
                <span className="site-header__status" aria-hidden="true" />
                <span><span className="site-header__wide">Staff </span>Portal</span>
              </NavLink>
              <button type="button" onClick={handleSignOut} className="site-header__link site-header__signout">
                Sign out
              </button>
            </>
          ) : (
            <NavLink to="/login" className="site-header__link" onMouseEnter={prefetchLogin} onFocus={prefetchLogin}>
              Staff login
            </NavLink>
          )}
        </nav>
      </div>
    </header>
  );
}
