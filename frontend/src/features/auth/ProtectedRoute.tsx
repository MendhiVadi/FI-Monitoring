import { Navigate } from "react-router-dom";
import { useStaffSession } from "./staffSession";

// Gates officer-only routes on a real Firebase Auth session that also passes
// the `officers/{uid}` allow-list check in ../lib/staffSession — the same
// check firestore.rules and the ticket Cloud Functions enforce server-side.
// `ready` stays false until Firebase finishes restoring any persisted
// session, so a page refresh doesn't flash-redirect a signed-in officer to
// /login while that check is still in flight.
export function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { isStaff, ready } = useStaffSession();

  if (!ready) {
    return (
      <main style={{ minHeight: "70vh", display: "grid", placeItems: "center", color: "#94a3b8" }}>
        <p role="status" aria-live="polite">Verifying officer credentials…</p>
      </main>
    );
  }

  if (!isStaff) {
    return <Navigate to="/login" replace />;
  }

  return <>{children}</>;
}
