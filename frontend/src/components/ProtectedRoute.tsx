import { doc, getDoc } from "firebase/firestore";
import { onAuthStateChanged, type User } from "firebase/auth";
import { useEffect, useState } from "react";
import { Navigate } from "react-router-dom";
import { auth, db } from "../lib/firebase";

type Status = "checking" | "signed-out" | "not-officer" | "authorized";

// Gates officer-only routes. Access requires BOTH a real Firebase Auth
// session (verified via onAuthStateChanged, never trusted from
// sessionStorage — that can be forged from the browser console) AND
// membership in the `officers/{uid}` allow-list, which mirrors the same
// check enforced server-side in firestore.rules. The client check here is
// only for UX (redirecting/explaining); the rules are what actually stop a
// non-officer from reading ticket data.
export function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const [status, setStatus] = useState<Status>("checking");

  useEffect(() => {
    return onAuthStateChanged(auth, async (user: User | null) => {
      if (!user) {
        setStatus("signed-out");
        return;
      }
      try {
        const officerDoc = await getDoc(doc(db, "officers", user.uid));
        setStatus(officerDoc.exists() ? "authorized" : "not-officer");
      } catch {
        // If the allow-list itself can't be read, fail closed.
        setStatus("not-officer");
      }
    });
  }, []);

  if (status === "checking") {
    return (
      <main style={pageStyle}>
        <div style={{ display: "flex", alignItems: "center", gap: "0.75rem", color: "rgba(255,255,255,0.7)" }}>
          <span style={{ display: "inline-block", width: 14, height: 14, borderRadius: "50%", border: "2px solid #7bd89f", borderTopColor: "transparent", animation: "spin 0.8s linear infinite" }} />
          <span>Verifying officer credentials…</span>
        </div>
      </main>
    );
  }

  if (status === "signed-out") {
    return <Navigate to="/login" replace />;
  }

  if (status === "not-officer") {
    return (
      <main style={pageStyle}>
        <div style={{ maxWidth: 480, textAlign: "center", color: "rgba(255,255,255,0.8)" }}>
          <h2 style={{ color: "#f87171", marginBottom: "0.75rem" }}>Access denied</h2>
          <p style={{ fontSize: "0.9rem", lineHeight: 1.6 }}>
            Your account is signed in but is not on the FRA officer allow-list, so it cannot
            access dispute records. Contact your administrator if you believe this is an error.
          </p>
        </div>
      </main>
    );
  }

  return <>{children}</>;
}

const pageStyle: React.CSSProperties = {
  minHeight: "70vh",
  padding: "8rem 2rem 4rem",
  maxWidth: 700,
  margin: "0 auto",
  display: "flex",
  justifyContent: "center",
  alignItems: "center",
};
