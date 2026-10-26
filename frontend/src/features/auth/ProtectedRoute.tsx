import { Navigate, useLocation } from "react-router-dom";
import { useStaffSession, type StaffSignOutReason } from "./staffSession";
import { Spinner } from "./Spinner";

/** Location state passed to /login, so it can explain the redirect and return. */
export type LoginRedirectState = { from?: string; reason?: StaffSignOutReason };

// Gates officer-only routes on a real Firebase Auth session that also passes
// the `officers/{uid}` allow-list check in ./staffSession — the same
// check firestore.rules and the ticket Cloud Functions enforce server-side.
// `ready` stays false until Firebase finishes restoring any persisted
// session, so a page refresh doesn't flash-redirect a signed-in officer to
// /login while that check is still in flight.
export function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { isStaff, ready, lastSignOutReason } = useStaffSession();
  const location = useLocation();

  if (!ready) {
    return (
      // Same background as the portal, so there is no colour flash once it loads.
      <main style={{ minHeight: "100vh", display: "grid", placeItems: "center", background: "#040a17", color: "#cbd5e1", padding: "0 16px" }}>
        <p role="status" aria-live="polite" style={{ display: "flex", alignItems: "center", gap: "0.6rem", margin: 0 }}>
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

  return <>{children}</>;
}
