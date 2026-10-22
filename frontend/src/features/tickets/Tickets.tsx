import { useLiveTickets } from "./useLiveTickets";
import { signOutStaff } from "../auth/staffSession";
import { StatusBadge } from "./StatusBadge";

export function Tickets() {
  const { tickets, loading, error, hasMore, loadMore, refresh } = useLiveTickets();

  return (
    <main style={{ minHeight: "75vh", padding: "7rem 2rem 4rem", maxWidth: 900, margin: "0 auto" }}>
      {/* Officer Portal shortcut banner */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          flexWrap: "wrap",
          gap: "1rem",
          background: "linear-gradient(135deg, rgba(16, 185, 129, 0.12), rgba(14, 31, 56, 0.6))",
          border: "1px solid rgba(123, 216, 159, 0.35)",
          borderRadius: 12,
          padding: "1.25rem 1.5rem",
          marginBottom: "2rem",
        }}
      >
        <div>
          <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", marginBottom: "0.25rem" }}>
            <span style={{ fontSize: "1.2rem" }}>🛡️</span>
            <strong style={{ color: "#7bd89f", fontSize: "1.05rem" }}>
              Full staff portal available
            </strong>
          </div>
          <p style={{ color: "rgba(255,255,255,0.75)", fontSize: "0.88rem", margin: 0 }}>
            Review submitted reports. Refresh the registry for updates and load older cases below.
          </p>
        </div>
        <a
          href="/officer-portal"
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: "0.5rem",
            padding: "0.65rem 1.25rem",
            borderRadius: 8,
            background: "linear-gradient(135deg, #10b981, #059669)",
            color: "#fff",
            textDecoration: "none",
            fontWeight: 600,
            fontSize: "0.9rem",
            boxShadow: "0 4px 14px rgba(16, 185, 129, 0.3)",
          }}
        >
          <span>Open staff portal</span>
          <span>→</span>
        </a>
      </div>

      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1.5rem" }}>
        <div>
          <h1 style={{ fontSize: "1.8rem", fontWeight: 700, margin: "0 0 0.35rem 0", color: "#f1f5f9" }}>
            Dispute Records & Tickets
          </h1>
          <p style={{ margin: 0, color: "rgba(255,255,255,0.6)", fontSize: "0.9rem" }}>
            Submitted grievance cases. Use Refresh to load current records.
          </p>
        </div>
        <button
          onClick={() => signOutStaff()}
          style={{
            padding: "0.5rem 1rem",
            borderRadius: 6,
            background: "rgba(255,255,255,0.06)",
            border: "1px solid rgba(255,255,255,0.15)",
            color: "rgba(255,255,255,0.8)",
            cursor: "pointer",
            fontSize: "0.85rem",
          }}
        >
          Sign out
        </button>
      </div>

      {loading && <p style={{ opacity: 0.7 }}>Loading live tickets...</p>}
      {error && <p style={{ color: "#f87171" }}>{error}</p>}
      {!loading && !error && tickets.length === 0 && (
        <div
          style={{
            padding: "3rem 2rem",
            textAlign: "center",
            background: "rgba(255,255,255,0.03)",
            borderRadius: 12,
            border: "1px dashed rgba(255,255,255,0.15)",
          }}
        >
          <p style={{ opacity: 0.7, marginBottom: "1rem" }}>No tickets found in the database yet.</p>
          <a
            href="/officer-portal"
            style={{
              color: "#7bd89f",
              textDecoration: "none",
              fontSize: "0.9rem",
              fontWeight: 600,
            }}
          >
            Open the staff portal to search and review reports →
          </a>
        </div>
      )}
      <ul style={{ listStyle: "none", padding: 0, display: "grid", gap: "0.75rem" }}>
        {tickets.map((t) => (
          <li
            key={t.id}
            style={{
              background: "rgba(255,255,255,0.03)",
              border: "1px solid rgba(255,255,255,0.08)",
              borderRadius: 10,
              padding: "1.2rem",
            }}
          >
            {/* Wraps so the no-wrap long status badge cannot push a 360px screen sideways. */}
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: "0.5rem 1rem", flexWrap: "wrap" }}>
              <strong style={{ fontSize: "1rem", color: "#f8fafc", overflowWrap: "anywhere", minWidth: 0 }}>{t.subject}</strong>
              <StatusBadge status={t.status} long />
            </div>
            <div style={{ opacity: 0.6, fontSize: "0.85rem", marginTop: "0.5rem" }}>
              From: {t.waFrom || (t.source === "whatsapp-hotline" ? "WhatsApp hotline" : "Web form (no phone recorded)")}
            </div>
          </li>
        ))}
      </ul>
      <button type="button" disabled={loading} onClick={refresh}>Refresh registry</button>{hasMore && <button type="button" disabled={loading} onClick={loadMore}>Load older cases</button>}
    </main>
  );
}
