import { useEffect, useState, type CSSProperties, type ReactNode } from "react";
import { flushSync } from "react-dom";
import { Modal } from "../../shared/ui/Modal";
import { formatGovClock } from "../../shared/format/formatDate";
import { SessionExpiryBanner } from "../auth/SessionExpiryBanner";
import { Spinner } from "../auth/Spinner";
import { StatusBadge } from "../tickets/StatusBadge";
import { DossierActions } from "./DossierActions";
import { DocumentsSection } from "./DocumentsSection";
import { REVIEW_LABELS, kindLabel, type ReviewDecision } from "../tickets/caseDocuments";
import { NoticeRegion } from "./NoticeRegion";
import { AssignmentPanel } from "./AssignmentPanel";
import { ReadOnlyBanner } from "./ReadOnlyBanner";
import { assigneeText, decisionTone, formatMs, formatTimestamp, overdueText, staffIdentityLabel } from "./presentation";
import { EventTime, NotProvided } from "./CaseText";
import { styles } from "./portal.styles";
import type { useOfficerPortal } from "./useOfficerPortal";
import type { Ticket } from "../tickets/types";
import type { CaseEvent } from "../tickets/useTicketDetail";

type Portal = ReturnType<typeof useOfficerPortal>;
const rowText: CSSProperties = { fontSize: "0.85rem", color: "#e5e7eb", fontWeight: 600, overflowWrap: "anywhere" };
// Printing pulls in up to this many extra 50-note pages before opening the dialog.
const PRINT_PAGE_CAP = 10;

const focusField = (id: string) => {
  const field = document.getElementById(id);
  field?.scrollIntoView({ block: "center", behavior: "smooth" });
  field?.focus({ preventScroll: true });
};

function SectionTitle({ color, title, children }: { color: string; title: string; children: ReactNode }) {
  return (
    <div style={styles.sectionTitle}>
      <svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2">{children}</svg>
      <h3 style={{ margin: 0, fontSize: "1rem", color }}>{title}</h3>
    </div>
  );
}

// One case-history row. Escalations are automatic and replacements come from
// the reporter, so neither names a staff member unless staff wrote it.
function HistoryEntry({ event, currentUid }: { event: CaseEvent; currentUid: string | undefined }) {
  let body: ReactNode, actor = staffIdentityLabel(event, currentUid);
  if (event.type === "document_review") {
    body = (
      <div style={rowText}>
        Document reviewed: {event.kind ? kindLabel(event.kind) : "document"} ·{" "}
        {event.decision && Object.hasOwn(REVIEW_LABELS, event.decision) ? REVIEW_LABELS[event.decision as ReviewDecision] : "Decision recorded"}
      </div>
    );
  } else if (event.type === "assignment") {
    // A masked copy says only whether someone was assigned, and their initials.
    const assigned = event.to ? true : event.assigned === true;
    const name = event.toName?.trim() || event.toEmail?.trim() || (event.to ? `Staff ·${event.to.slice(-4)}` : "");
    const you = Boolean(event.to) && event.to === currentUid;
    body = <div style={rowText}>{assigned ? <>Assigned to {name || "a staff member"}{you && " (you)"}</> : "Unassigned"}</div>;
  } else if (event.type === "escalation") {
    const overdue = overdueText(event.overdue);
    body = (
      <div style={rowText}>
        {overdue ? <><span aria-hidden="true">⏱ </span>{overdue.short}<span style={{ display: "block", fontWeight: 400, color: "#cbd5e1" }}>{overdue.long}</span></>
          : <><span aria-hidden="true">✓ </span>No longer overdue</>}
      </div>
    );
    if (!event.officerUid) actor = event.actor?.trim() || "Automatic service-target check";
  } else if (event.type === "document_replaced") {
    body = <div style={rowText}><span aria-hidden="true">↻ </span>New copy uploaded: {event.kind ? kindLabel(event.kind) : "document"}</div>;
    if (!event.officerUid) actor = event.actor?.trim() || "Reporter";
  } else if (event.kind === "status") {
    body = (
      <div style={{ display: "flex", gap: "0.4rem", flexWrap: "wrap", alignItems: "center" }}>
        <span className="sr-only">Status changed from</span>
        {event.before ? <StatusBadge status={event.before} /> : <NotProvided label="Unknown" />}
        <span aria-hidden="true" style={{ color: "#94a3b8" }}>→</span>
        <span className="sr-only">to</span>
        {event.after ? <StatusBadge status={event.after} /> : <NotProvided label="Unknown" />}
      </div>
    );
  } else {
    body = <div style={rowText}>{event.kind === "note" ? "Case note added" : "Case updated"}</div>;
  }
  const quoted = event.kind === "status" || event.type === "document_review" || event.type === "assignment";
  return (
    <li>
      {body}
      {quoted && event.reason && (
        <p style={{ margin: "0.35rem 0 0", fontSize: "0.85rem", color: "#e5e7eb", overflowWrap: "anywhere" }}>“{event.reason}”</p>
      )}
      <small style={{ display: "block", marginTop: "0.25rem", color: "#94a3b8" }}>
        {actor} · <EventTime at={event.at} />
      </small>
    </li>
  );
}

// Service targets and assignment, as stored (ms). A masked copy carries the
// overdue state and assignee initials only, so absent dates are not shown.
function CaseTargets({ ticket, currentUid }: { ticket: Ticket; currentUid: string | undefined }) {
  const overdue = overdueText(ticket.overdue), assignee = assigneeText(ticket, currentUid);
  const acknowledged = typeof ticket.firstActionAt === "number" ? ticket.firstActionAt : null;
  return (
    <>
      {overdue && (
        <p className="dossier-overdue">
          <span aria-hidden="true">⏱ </span><strong>{overdue.short}.</strong> {overdue.long}
          {typeof ticket.overdueSince === "number" && <> · since {formatMs(ticket.overdueSince)}</>}
        </p>
      )}
      <dl className="dossier-targets">
        <div><dt>Assigned to</dt><dd>{assignee ?? <NotProvided label="Nobody yet" />}</dd></div>
        {typeof ticket.ackDueAt === "number" && (
          <div>
            <dt>Acknowledge by</dt>
            <dd>
              {formatMs(ticket.ackDueAt)}
              {acknowledged !== null && <span style={{ color: "#86efac" }}> · <span aria-hidden="true">✓ </span>first staff action {formatMs(acknowledged)}</span>}
            </dd>
          </div>
        )}
        {typeof ticket.resolveDueAt === "number" && <div><dt>Resolve by</dt><dd>{formatMs(ticket.resolveDueAt)}</dd></div>}
      </dl>
    </>
  );
}

function Detail({ label, children, valueStyle }: { label: string; children: ReactNode; valueStyle?: CSSProperties }) {
  return (
    <div style={styles.detailRow}>
      <span style={styles.detailLabel}>{label}</span>
      <span style={{ ...styles.detailValue, ...valueStyle }}>{children}</span>
    </div>
  );
}

// One dialog for loading, error and content, so the backdrop and focus do not
// jump when the case arrives. The page behind is inert while it is open, so
// save errors, confirmations and the session warning all render inside it.
export function Dossier({ portal }: { portal: Portal }) {
  const { selectedId, selectedTicket: ticket, setSelectedTicket, detailError, retryDetail, selectedDecision, officerEmail, currentUid,
    statusReason, setStatusReason, newOfficerNote, setNewOfficerNote, saveError, clearSaveError, savingKind,
    handleUpdateStatus, handleAddNote, events, notes, moreNotes, notesBusy, loadOlderNotes, notice, showNotice, dismissNotice,
    readOnly, isAdmin, staff, assignReason, setAssignReason, handleAssign, maskedDocuments } = portal;
  const close = () => setSelectedTicket(null);
  const [printedAt, setPrintedAt] = useState(() => new Date());
  const [preparingPrint, setPreparingPrint] = useState(false);
  // Browser print (Ctrl+P) as well as the button: stamp the header at print time.
  useEffect(() => {
    const stamp = () => flushSync(() => setPrintedAt(new Date()));
    window.addEventListener("beforeprint", stamp);
    return () => window.removeEventListener("beforeprint", stamp);
  }, []);
  async function handlePrint() {
    if (preparingPrint) return;
    setPreparingPrint(true);
    try {
      let more = moreNotes;
      for (let page = 0; more && page < PRINT_PAGE_CAP; page++) more = await loadOlderNotes();
      await new Promise(resolve => setTimeout(resolve, 50)); // let the loaded notes render first
    } finally { setPreparingPrint(false); }
    window.print();
  }

  const dispute = ticket?.dispute;
  const notifies = ticket?.whatsappUpdates === true && ticket?.phoneVerified === true;
  const legacyNotes = ticket?.officerNotes?.filter(note => typeof note === "string" && note.trim()) ?? [];

  return (
    <Modal label={ticket?.subject ? `Case dossier: ${ticket.subject}` : "Case dossier"} className="dossier-dialog" onClose={close}>
      <div
        className="dossier-container"
        style={styles.modalContainer}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Modal Top Ribbon */}
        <div className="dossier-head" style={styles.modalHeader}>
          <div style={{ display: "flex", alignItems: "center", gap: "10px", flexWrap: "wrap", minWidth: 0 }}>
            <span style={styles.ticketIdPill}>{ticket?.id ?? selectedId}</span>
            {ticket && (ticket.source === "whatsapp-hotline" ? (
              <span style={styles.whatsappSourcePill}>WhatsApp hotline submission</span>
            ) : (
              <span style={styles.webSourcePill}>Web form submission</span>
            ))}
          </div>
          <button type="button" className="icon-btn" onClick={close} style={styles.closeModalBtn} aria-label="Close dossier">
            ✕
          </button>
        </div>
        <div className="dossier-banner"><SessionExpiryBanner /></div>

        {/* Modal Body: the only scroll area */}
        <div className="dossier-body" style={styles.modalBody}>
          {!ticket ? (
            detailError ? (
              <div role="alert" style={{ ...styles.emptyCard, borderColor: "rgba(239, 68, 68, 0.4)", padding: "2rem 1rem" }}>
                <h2 style={{ margin: 0, fontSize: "1.1rem", color: "#fca5a5" }}>Could not open this case</h2>
                <p style={{ margin: "0.5rem 0 1rem", color: "#cbd5e1", fontSize: "0.9rem" }}>{detailError}</p>
                <div style={{ display: "flex", gap: "0.75rem", justifyContent: "center", flexWrap: "wrap" }}>
                  <button type="button" className="portal-btn" style={styles.modalPrimaryBtn} onClick={retryDetail}>Retry</button>
                  <button type="button" className="portal-btn" style={styles.modalSecondaryBtn} onClick={close}>Close</button>
                </div>
              </div>
            ) : (
              <div role="status" style={{ display: "grid", gap: "1rem" }}>
                <span className="sr-only">Loading the case…</span>
                <div className="portal-skeleton short" style={{ width: "40%" }} />
                <div className="portal-skeleton short" style={{ width: "75%" }} />
                <div className="portal-skeleton" style={{ height: 140 }} />
                <div className="portal-skeleton" style={{ height: 180 }} />
              </div>
            )
          ) : (
            <>
              <div className="print-only print-header">
                Land Dispute · Case dossier · Ref {ticket.id} · Printed {formatGovClock(printedAt)} IST by {officerEmail || "signed-in staff"}
                <br />
                <strong>{readOnly ? "CONFIDENTIAL: masked copy, personal data hidden." : "CONFIDENTIAL: contains personal data."} Not an official legal record.</strong>
                {moreNotes && <div>Only {notes.length} of {ticket.noteCount ?? "all"} notes are included in this printout.</div>}
              </div>
              {detailError && <p role="alert" style={{ ...styles.fieldError, marginTop: 0 }}>{detailError}</p>}
              {/* The page behind the dialog is inert, so the viewer banner repeats here. */}
              {readOnly && <ReadOnlyBanner />}

              <div className={readOnly ? "dossier-layout dossier-layout--single" : "dossier-layout"}>
                <div className="dossier-main">
                  {/* Summary */}
                  <section style={styles.modalSectionCard} aria-labelledby="dossier-title">
                    <span style={{ fontSize: "0.75rem", color: "#22c55e", fontWeight: 700, letterSpacing: "0.08em" }}>CASE DOSSIER</span>
                    <h2 id="dossier-title" style={{ margin: "0.25rem 0 0.6rem", fontSize: "1.35rem", color: "#f9fafb", overflowWrap: "anywhere" }}>
                      {ticket.subject || <NotProvided label="No subject recorded" />}
                    </h2>
                    <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap", alignItems: "center" }}>
                      <StatusBadge status={ticket.status} long />
                      {selectedDecision && (
                        <span style={{ ...styles.aiPriorityBadge, ...decisionTone(selectedDecision.priority), padding: "0.2rem 0.6rem", fontSize: "0.7rem" }}>
                          Triage: {selectedDecision.priority}
                        </span>
                      )}
                    </div>
                    <p style={{ margin: "0.6rem 0 0", fontSize: "0.8rem", color: "#94a3b8" }}>
                      Filed {formatTimestamp(ticket.createdAt)} · Last updated {formatTimestamp(ticket.updatedAt)}
                    </p>
                    <CaseTargets ticket={ticket} currentUid={currentUid} />
                  </section>

                  {/* Verbatim Narrative */}
                  <section style={styles.modalSectionCard}>
                    <SectionTitle color="#86efac" title="Description submitted by the reporter">
                      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                      <polyline points="14 2 14 8 20 8" />
                      <line x1="16" y1="13" x2="8" y2="13" />
                      <line x1="16" y1="17" x2="8" y2="17" />
                    </SectionTitle>
                    <div style={styles.verbatimTextBox}>
                      {dispute?.description || ticket.messages?.map((m) => m.body).join("\n\n") || <NotProvided label="No narrative provided." />}
                    </div>
                  </section>

                  {/* Explainable per-ticket decision support */}
                  {selectedDecision && (
                    <section style={styles.aiDecisionCard}>
                      <div style={styles.aiDecisionHeader}>
                        <div>
                          <div style={styles.aiEyebrow}>EXPLAINABLE TRIAGE RULES</div>
                          <h3 style={styles.aiHeading}>Evidence-based ticket triage</h3>
                          <p style={styles.aiDisclaimer}>
                            Advisory only — staff review all evidence and make the final decision.
                          </p>
                        </div>
                        <div style={{ ...styles.aiPriorityBadge, ...decisionTone(selectedDecision.priority) }}>
                          {selectedDecision.priority} priority
                        </div>
                      </div>

                      <div style={styles.aiSummaryGrid}>
                        <div style={styles.aiSummaryBox}>
                          <span style={styles.aiSummaryLabel}>Recommended next action</span>
                          <strong style={styles.aiSummaryValue}>{selectedDecision.recommendedAction}</strong>
                        </div>
                        <div style={styles.aiSummaryBox}>
                          <span style={styles.aiSummaryLabel}>Suggested review target (not a legal deadline)</span>
                          <strong style={styles.aiSummaryValue}>{selectedDecision.responseWindow}</strong>
                        </div>
                        <div style={styles.aiSummaryBox}>
                          <span style={styles.aiSummaryLabel}>Assessment method</span>
                          <strong style={styles.aiSummaryValue}>Deterministic rules</strong>
                        </div>
                      </div>

                      <p style={styles.aiRationale}>{selectedDecision.rationale}</p>

                      <div style={styles.aiTwoColumn}>
                        <div>
                          <div style={styles.aiSubheading}>Decision path</div>
                          <ol style={styles.aiPathList}>
                            {selectedDecision.path.map((step, index) => (
                              <li key={step} style={styles.aiPathItem}>
                                <span style={styles.aiPathNumber}>{index + 1}</span>
                                <span>{step}</span>
                              </li>
                            ))}
                          </ol>
                        </div>
                        <div>
                          <div style={styles.aiSubheading}>Factors evaluated</div>
                          <div style={styles.aiFactorList}>
                            {selectedDecision.factors.map((factor) => (
                              <div key={factor.label} style={styles.aiFactorRow}>
                                <span style={styles.aiFactorLabel}>{factor.label}</span>
                                <span style={{ ...styles.aiFactorValue, color: factor.signal === "risk" ? "#fca5a5" : factor.signal === "protective" ? "#86efac" : "#cbd5e1" }}>
                                  {factor.value}
                                </span>
                              </div>
                            ))}
                          </div>
                        </div>
                      </div>

                      {selectedDecision.dataGaps.length > 0 && (
                        <div style={styles.aiDataGaps}>
                          <strong>Complete before final action:</strong> {selectedDecision.dataGaps.join(" · ")}
                        </div>
                      )}
                    </section>
                  )}

                  {/* Parties */}
                  <div style={styles.twoColGrid}>
                    <section style={styles.partyCard} aria-labelledby="party-reporter">
                      <div style={styles.partyCardHeader}>
                        <svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#22c55e" strokeWidth="2">
                          <path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2" />
                          <circle cx="12" cy="7" r="4" />
                        </svg>
                        <h3 id="party-reporter" style={{ ...styles.partyHeading, margin: 0 }}>Reporter</h3>
                      </div>
                      <Detail label={readOnly ? "Initials" : "Full name"}>{dispute?.reporterName || <NotProvided />}</Detail>
                      <Detail label="Capacity">{dispute?.reporterType || <NotProvided />}</Detail>
                      <Detail label="Phone / WhatsApp" valueStyle={ticket.waFrom ? { color: "#22c55e", fontWeight: 600 } : undefined}>
                        {ticket.waFrom || <NotProvided />}
                      </Detail>
                      {/* The masked copy carries neither, so a viewer would see a false "Not verified". */}
                      {!readOnly && (
                        <>
                          <Detail label="Phone check" valueStyle={{ color: ticket.phoneVerified === true ? "#4ade80" : "#fbbf24", fontWeight: 600 }}>
                            {ticket.phoneVerified === true ? <><span aria-hidden="true">✓ </span>Verified</> : <><span aria-hidden="true">! </span>Not verified</>}
                          </Detail>
                          <Detail label="WhatsApp updates">
                            {notifies ? "Opted in" : ticket.whatsappUpdates === false || ticket.phoneVerified === true ? "Not opted in" : <NotProvided label="Not recorded" />}
                          </Detail>
                        </>
                      )}
                    </section>

                    <section style={styles.partyCard} aria-labelledby="party-other">
                      <div style={styles.partyCardHeader}>
                        <svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#f87171" strokeWidth="2">
                          <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
                          <circle cx="9" cy="7" r="4" />
                          <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
                          <path d="M16 3.13a4 4 0 0 1 0 7.75" />
                        </svg>
                        <h3 id="party-other" style={{ ...styles.partyHeading, margin: 0, color: "#f87171" }}>Other party named</h3>
                      </div>
                      <Detail label={readOnly ? "Initials" : "Name"}>{dispute?.otherPartyName || <NotProvided />}</Detail>
                      <Detail label="Type">{dispute?.otherPartyType || <NotProvided />}</Detail>
                      <Detail label="Dispute category" valueStyle={dispute?.disputeType ? { color: "#fbbf24" } : undefined}>
                        {dispute?.disputeType || <NotProvided />}
                      </Detail>
                    </section>
                  </div>

                  {/* Location */}
                  <section style={styles.modalSectionCard}>
                    <SectionTitle color="#93c5fd" title="Location">
                      <polygon points="1 6 1 22 8 18 16 22 23 18 23 2 16 6 8 2 1 6" />
                      <line x1="8" y1="2" x2="8" y2="18" />
                      <line x1="16" y1="6" x2="16" y2="22" />
                    </SectionTitle>
                    <div style={styles.geoGrid}>
                      <div style={styles.geoBox}>
                        <div style={styles.geoLabel}>STATE</div>
                        <div style={styles.geoValue}>{dispute?.state || <NotProvided />}</div>
                      </div>
                      <div style={styles.geoBox}>
                        <div style={styles.geoLabel}>DISTRICT</div>
                        <div style={styles.geoValue}>{dispute?.district || <NotProvided />}</div>
                      </div>
                      <div style={styles.geoBox}>
                        <div style={styles.geoLabel}>VILLAGE / LANDMARK</div>
                        <div style={styles.geoValue}>{dispute?.village || <NotProvided />}</div>
                      </div>
                      <div style={styles.geoBox}>
                        <div style={styles.geoLabel}>{readOnly ? "MAP COORDINATES (APPROX.)" : "MAP COORDINATES"}</div>
                        <div style={{ ...styles.geoValue, fontVariantNumeric: "tabular-nums" }}>
                          {/* The masked copy is rounded to 2 decimals (about 1 km); never pad it to look precise. */}
                          {dispute?.location
                            ? `${dispute.location.latitude.toFixed(readOnly ? 2 : 6)}, ${dispute.location.longitude.toFixed(readOnly ? 2 : 6)}`
                            : <NotProvided label="No point selected" />}
                        </div>
                      </div>
                    </div>
                  </section>

                  <DocumentsSection ticket={ticket} currentUid={currentUid} onNotice={showNotice} masked={maskedDocuments} />

                  {!!dispute?.evidenceReferences?.length && (
                    <section style={styles.modalSectionCard}>
                      <SectionTitle color="#fcd34d" title="Evidence references supplied by the reporter">
                        <path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48" />
                      </SectionTitle>
                      <p style={{ ...styles.fieldHint, marginBottom: "0.5rem" }}>Staff must verify the referenced records.</p>
                      <ul style={styles.notesList}>
                        {dispute.evidenceReferences.map((reference, index) => <li key={index} style={{ ...styles.noteItem, overflowWrap: "anywhere" }}>{reference}</li>)}
                      </ul>
                    </section>
                  )}

                  {/* Message & Communication Trail */}
                  {ticket.messages && ticket.messages.length > 0 && (
                    <section style={styles.modalSectionCard}>
                      <SectionTitle color="#c4b5fd" title="Messages">
                        <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
                      </SectionTitle>
                      <div style={{ display: "grid", gap: "0.6rem" }}>
                        {ticket.messages.map((msg, idx) => (
                          <div
                            key={idx}
                            style={{
                              ...styles.messagePill,
                              background: msg.from === "officer" ? "rgba(34, 197, 94, 0.12)" : "rgba(255, 255, 255, 0.04)",
                              borderColor: msg.from === "officer" ? "rgba(34, 197, 94, 0.3)" : "rgba(255, 255, 255, 0.08)",
                            }}
                          >
                            <div style={{ display: "flex", justifyContent: "space-between", gap: "0.5rem", flexWrap: "wrap", marginBottom: "0.3rem", fontSize: "0.75rem", color: "#9ca3af" }}>
                              <strong style={{ color: msg.from === "officer" ? "#22c55e" : "#e5e7eb" }}>
                                {msg.from === "officer" ? "Staff reply" : msg.from === "system" ? "System message" : "Reporter message"}
                              </strong>
                              <span>{formatTimestamp(msg.at)}</span>
                            </div>
                            <p style={{ margin: 0, fontSize: "0.88rem", lineHeight: 1.5, color: "#f3f4f6", overflowWrap: "anywhere" }}>
                              {msg.body}
                            </p>
                          </div>
                        ))}
                      </div>
                    </section>
                  )}

                  {/* Case history timeline */}
                  <section style={styles.modalSectionCard}>
                    <SectionTitle color="#7dd3fc" title="Case history">
                      <circle cx="12" cy="12" r="10" />
                      <polyline points="12 6 12 12 16 14" />
                    </SectionTitle>
                    <p style={{ ...styles.fieldHint, marginBottom: "0.75rem" }}>Latest 50 recorded changes. Earlier legacy actions may have no audit entry.</p>
                    {events.length ? (
                      <ol className="dossier-history">
                        {events.map(event => <HistoryEntry key={event.id} event={event} currentUid={currentUid} />)}
                      </ol>
                    ) : <p style={styles.fieldHint}>No audit entries recorded yet.</p>}
                  </section>

                  {/* Case notes */}
                  <section style={styles.modalSectionCard}>
                    <SectionTitle color="#fde68a" title="Case notes">
                      <path d="M12 20h9" />
                      <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z" />
                    </SectionTitle>
                    {notes.length ? (
                      <ol className="dossier-history">
                        {notes.map(note => (
                          <li key={note.id}>
                            <p style={{ margin: 0, fontSize: "0.88rem", color: "#e5e7eb", whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>{note.text}</p>
                            <small style={{ display: "block", marginTop: "0.25rem", color: "#94a3b8" }}>
                              {staffIdentityLabel(note, currentUid)} · <EventTime at={note.at} />
                            </small>
                          </li>
                        ))}
                      </ol>
                    ) : <p style={styles.fieldHint}>No case notes yet.</p>}
                    {moreNotes && (
                      <div className="dossier-edit-control" style={{ display: "flex", gap: "0.75rem", alignItems: "center", flexWrap: "wrap", marginTop: "0.75rem" }}>
                        <button type="button" className="portal-btn" style={styles.modalSecondaryBtn} disabled={notesBusy || preparingPrint} onClick={() => void loadOlderNotes()}>
                          {notesBusy ? <><Spinner /> Loading…</> : "Load older notes"}
                        </button>
                        <span style={styles.fieldHint}>Showing the latest {notes.length} notes. Print loads older notes automatically.</span>
                      </div>
                    )}
                    {legacyNotes.length > 0 && (
                      <>
                        <h4 style={{ margin: "1rem 0 0.4rem", fontSize: "0.85rem", color: "#cbd5e1" }}>Earlier notes (imported)</h4>
                        <ul style={styles.notesList}>
                          {legacyNotes.map((note, i) => <li key={i} style={{ ...styles.noteItem, overflowWrap: "anywhere" }}>{note}</li>)}
                        </ul>
                      </>
                    )}
                  </section>
                </div>

                {/* Actions: sticky beside the case on wide screens. Viewers get none. */}
                {!readOnly && (
                  <aside className="dossier-actions dossier-edit-control" aria-label="Case actions">
                    <AssignmentPanel
                      ticket={ticket}
                      currentUid={currentUid}
                      isAdmin={isAdmin}
                      staff={staff}
                      reason={assignReason}
                      setReason={setAssignReason}
                      saveError={saveError}
                      clearSaveError={clearSaveError}
                      savingKind={savingKind}
                      onAssign={handleAssign}
                    />
                    <DossierActions
                      ticket={ticket}
                      statusReason={statusReason}
                      setStatusReason={setStatusReason}
                      newNote={newOfficerNote}
                      setNewNote={setNewOfficerNote}
                      saveError={saveError}
                      clearSaveError={clearSaveError}
                      savingKind={savingKind}
                      onUpdateStatus={handleUpdateStatus}
                      onAddNote={handleAddNote}
                    />
                  </aside>
                )}
              </div>
            </>
          )}
        </div>

        {/* Phones and tablets: jump to the action forms below the case */}
        {ticket && !readOnly && (
          <div className="dossier-mobile-bar dossier-edit-control">
            <button type="button" className="portal-btn" style={styles.modalSecondaryBtn} onClick={() => focusField("next-status")}>Update status</button>
            <button type="button" className="portal-btn" style={styles.modalSecondaryBtn} onClick={() => focusField("case-note")}>Add note</button>
          </div>
        )}

        {/* Modal Footer Actions */}
        <div className="dossier-foot" style={styles.modalFooter}>
          <div style={{ fontSize: "0.8rem", color: "#9ca3af", overflowWrap: "anywhere" }}>
            Reference ID: <code>{ticket?.id ?? selectedId}</code>
          </div>
          <div className="dossier-foot-actions">
            <button type="button" className="portal-btn" onClick={() => void handlePrint()} disabled={!ticket || preparingPrint} style={styles.modalSecondaryBtn}>
              {preparingPrint ? <><Spinner /> Preparing…</> : (
                <>
                  <svg aria-hidden="true" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <polyline points="6 9 6 2 18 2 18 9" />
                    <path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2" />
                    <rect width="12" height="8" x="6" y="14" />
                  </svg>
                  Print dossier
                </>
              )}
            </button>
            <button type="button" className="portal-btn" onClick={close} style={styles.modalPrimaryBtn}>
              Close
            </button>
          </div>
        </div>
        <NoticeRegion notice={notice} onDismiss={dismissNotice} />
      </div>
    </Modal>
  );
}
