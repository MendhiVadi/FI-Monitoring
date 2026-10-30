import { Link, Navigate, useLocation } from "react-router-dom";
import { hasAccess, signOutStaff, useStaffSession, type StaffAccess, type StaffSignOutReason } from "./staffSession";
import { Spinner } from "./Spinner";
import "./protected-route.css";

/** Location state passed to /login, so it can explain the redirect and return. */
export type LoginRedirectState = { from?: string; reason?: StaffSignOutReason };

const NEEDS: Record<StaffAccess, string> = { viewer: "staff", officer: "officer", admin: "administrator" };

// Gates staff routes on a real Firebase Auth session that also passes the
// `officers/{uid}` allow-list check in ./staffSession — the same check
// firestore.rules and the ticket Cloud Functions enforce server-side.
// `minAccess` (default "officer") is the lowest officers/{uid}.access level the
// route accepts; a read-only viewer reaches only routes marked "viewer".
// `ready` stays false until Firebase finishes restoring any persisted
// session, so a page refresh doesn't flash-redirect a signed-in officer to
// /login while that check is still in flight.
export function ProtectedRoute({ children, minAccess = "officer" }: { children: React.ReactNode; minAccess?: StaffAccess }) {
  const { isStaff, ready, lastSignOutReason, access } = useStaffSession();
  const location = useLocation();

  if (!ready) {
    return (
      // Same background as the portal, so there is no colour flash once it loads.
      <main className="staff-gate">
        <p role="status" aria-live="polite" className="staff-gate__status">
          <Spinner size={16} color="#7bd89f" />
          Checking your staff session…
        </p>
      </main>
    );
  }

  if (!isStaff) {
    const state: LoginRedirectState = { from: location.pathname + location.search + location.hash, reason: lastSignOutReason };
    return <Navigate to="/login" replace state={state} />;
  }

  if (!hasAccess(access, minAccess)) {
    // Signed in, but this page needs more than the account has. Sending them to
    // /login would only show "already signed in", so explain it here instead.
    return (
      <main className="staff-gate">
        <div className="staff-gate__card">
          <h1>This page needs {NEEDS[minAccess]} access</h1>
          <p>
            {access === "viewer"
              ? "Your staff account is read-only. It can browse cases with personal data masked, but not open this page."
              : "Your staff account does not include this page."}
            {" "}Ask the administrator for this deployment if you need it.
          </p>
          <div className="staff-gate__actions">
            {hasAccess(access, "viewer") && <Link to="/officer-portal" className="staff-gate__btn staff-gate__btn--primary">Open the case registry</Link>}
            <button type="button" className="staff-gate__btn" onClick={() => void signOutStaff()}>Sign out</button>
          </div>
        </div>
      </main>
    );
  }

  return <>{children}</>;
}
