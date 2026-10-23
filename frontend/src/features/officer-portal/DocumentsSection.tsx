import { useState } from "react";
import type { Ticket } from "../tickets/types";
import { caseTypeForParty, caseTypeLabel, isFlagged, kindLabel, missingRequiredKinds } from "../tickets/caseDocuments";
import { useCaseDocuments } from "../tickets/useCaseDocuments";
import { DocumentCard } from "./DocumentCard";
import { styles } from "./portal.styles";

// Uploaded papers with their automatic screening. Flags only point staff at
// what to look at; nothing here accepts or rejects the case by itself.
export function DocumentsSection({ ticket, currentUid, onNotice }: {
  ticket: Ticket;
  currentUid: string | undefined;
  onNotice: (message: string) => void;
}) {
  const summary = ticket.documents;
  const [attempt, setAttempt] = useState(0);
  // Cases filed before uploads have no documents to subscribe to.
  const { documents, loading, error } = useCaseDocuments(summary ? ticket.id : null, attempt);
  const caseType = summary?.caseType ?? caseTypeForParty(ticket.dispute?.otherPartyType);
  const missing = missingRequiredKinds(caseType, [...(summary?.kinds ?? []), ...documents.map(document => document.kind)]);
  const count = loading || error ? summary?.count ?? 0 : documents.length;
  const flagged = loading || error ? summary?.flagged ?? 0 : documents.filter(isFlagged).length;

  return (
    <section style={styles.modalSectionCard} aria-labelledby="dossier-documents" className="dossier-documents">
      <div style={styles.sectionTitle}>
        <svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#a5b4fc" strokeWidth="2">
          <rect x="3" y="4" width="18" height="16" rx="2" />
          <circle cx="9" cy="11" r="2.5" />
          <path d="M5.5 17c.8-1.8 2-2.7 3.5-2.7s2.7.9 3.5 2.7M15 10h3M15 14h3" />
        </svg>
        <h3 id="dossier-documents" style={{ margin: 0, fontSize: "1rem", color: "#a5b4fc" }}>Documents</h3>
      </div>
      {summary ? (
        <p style={{ ...styles.docMeta, marginBottom: "0.4rem" }}>
          <strong style={{ color: "#e5e7eb" }}>{caseTypeLabel(caseType)}</strong>
          {" · "}{count} uploaded · {flagged} flagged
        </p>
      ) : (
        <p style={{ ...styles.fieldHint, marginBottom: "0.4rem" }}>
          This case was filed before document uploads were added, so no documents were collected with it.
          {caseType && <> The papers a {caseTypeLabel(caseType).toLowerCase()} report now requires are listed below.</>}
        </p>
      )}
      {/* Older cases list their required papers as "Not provided" as well. */}
      {missing.length > 0 && (
        <p style={styles.docMissing}>
          <span aria-hidden="true">! </span><strong>Not provided:</strong> {missing.map(kindLabel).join(", ")}
        </p>
      )}
      {summary && <p style={{ ...styles.fieldHint, marginBottom: "0.75rem" }}>Screening flags are signals for staff review, not a verdict.</p>}

      {error ? (
        <div role="alert" style={styles.fieldError}>
          <span>{error}</span>
          <button type="button" className="portal-btn" style={{ ...styles.resetFiltersBtn, padding: "0 0.85rem" }} onClick={() => setAttempt(n => n + 1)}>Retry</button>
        </div>
      ) : loading ? (
        <div role="status" style={{ display: "grid", gap: "0.6rem" }}>
          <span className="sr-only">Loading documents…</span>
          <div className="portal-skeleton" style={{ height: 96 }} />
        </div>
      ) : documents.length > 0 ? (
        <ul className="doc-list">
          {documents.map(document => <DocumentCard key={document.id} document={document} currentUid={currentUid} onNotice={onNotice} />)}
        </ul>
      ) : summary ? (
        <p style={styles.fieldHint}>No stored documents. They may have been removed after the retention period.</p>
      ) : null}
    </section>
  );
}
