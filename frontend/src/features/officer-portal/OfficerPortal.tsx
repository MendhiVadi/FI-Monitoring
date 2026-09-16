import { Modal } from "../../shared/ui/Modal";
import { PortalClock } from "./PortalClock";
import { useOfficerPortal } from "./useOfficerPortal";
import { renderStatusBadge, decisionTone, formatTimestamp } from "./presentation";
import { styles } from "./portal.styles";

/* Access to this component is gated by <ProtectedRoute> in App.tsx, which
 * requires a real Firebase Auth session belonging to an allow-listed officer
 * (see the `officers/{uid}` check there and in firestore.rules).
 */
export function OfficerPortal() {
  const { setSaveError, officerEmail, selectedTicket, setSelectedTicket, statusFilter, setStatusFilter, disputeFilter, setDisputeFilter, searchQuery, setSearchQuery, newOfficerNote, setNewOfficerNote, handleLogout, ticketsLoading, ticketsError, saveError, handleUpdateStatus, handleAddNote, filteredTickets, stats, selectedDecision, hasMore, loadMore, refresh, saving, statusReason, setStatusReason, notes, moreNotes, notesBusy, loadOlderNotes, detailError, selectedId, events } = useOfficerPortal();

  /* ========================================================================= */
  /* SCREEN 2: AUTHORIZED GOVERNMENT OFFICER DASHBOARD                         */
  /* ========================================================================= */
  return (
    <div className="officer-portal" style={styles.portalContainer}>
      {/* Top Government Navigation Bar */}
      <header style={styles.portalHeader}>
        <div style={styles.portalHeaderInner}>
          <div style={{ display: "flex", alignItems: "center", gap: "14px", flexWrap: "wrap" }}>
            <div style={styles.crestMiniCircle}>
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#22c55e" strokeWidth="2.2">
                <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
                <path d="m9 12 2 2 4-4" />
              </svg>
            </div>
            <div>
              <div style={{ display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap" }}>
                <span style={{ fontWeight: 800, fontSize: "clamp(0.92rem, 2.6vw, 1.1rem)", letterSpacing: "-0.01em", color: "#f3f4f6" }}>
                  Forest Rights Redressal Portal
                </span>
                <span style={styles.liveBadge}>STAFF PORTAL</span>
              </div>
              <div style={{ fontSize: "0.75rem", color: "#9ca3af" }}>
                Forest Watch project • FRA implementation monitoring
              </div>
            </div>
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: "clamp(0.5rem, 2vw, 18px)", flexWrap: "wrap" }}>
            {/* Realtime clock */}
            <div style={styles.headerTimeBox}>
              <span style={{ color: "#22c55e", marginRight: "6px" }}>●</span>
              <PortalClock />
            </div>

            {/* Officer Badge */}
            <div style={styles.officerProfilePill}>
              <div style={styles.avatarCircle}>FO</div>
              <div style={{ textAlign: "left", fontSize: "0.75rem", lineHeight: 1.2 }}>
                <div style={{ fontWeight: 700, color: "#f3f4f6" }}>Designated Officer</div>
                <div style={{ color: "#9ca3af", maxWidth: 160, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {officerEmail}
                </div>
              </div>
            </div>

            {/* Sign Out */}
            <button
              onClick={handleLogout}
              style={styles.signOutBtn}
              title="Sign out of Government Portal"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
                <polyline points="16 17 21 12 16 7" />
                <line x1="21" y1="12" x2="9" y2="12" />
              </svg>
              Logout
            </button>
          </div>
        </div>
      </header>

      {/* Main Content Area */}
      <main style={styles.portalMain}>
        {saveError && (
          <div
            role="alert"
            style={{
              background: "rgba(239, 68, 68, 0.15)",
              border: "1px solid rgba(239, 68, 68, 0.4)",
              borderRadius: 8,
              padding: "0.75rem 1rem",
              marginBottom: "1.25rem",
              color: "#fca5a5",
              fontSize: "0.88rem",
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: "0.75rem",
            }}
          >
            <span>⚠️ {saveError}</span>
            <button
              type="button"
              onClick={() => setSaveError(null)}
              style={{ background: "none", border: "none", color: "#fca5a5", cursor: "pointer", fontSize: "0.9rem" }}
            >
              ✕
            </button>
          </div>
        )}
        {/* Hero & Metrics Bar */}
        <div style={styles.metricsGrid}>
          <div style={styles.metricCard}>
            <div style={styles.metricHeader}>
              <span style={styles.metricLabel}>Total Grievance Tickets</span>
              <span style={{ fontSize: "1.2rem" }}>📋</span>
            </div>
            <div style={styles.metricValue}>{stats?.total ?? "—"}</div>
            <div style={styles.metricSub}>Recorded in Project Registry</div>
          </div>

          <div style={{ ...styles.metricCard, borderLeft: "4px solid #ef4444" }}>
            <div style={styles.metricHeader}>
              <span style={styles.metricLabel}>Pending Initial Action</span>
              <span style={{ fontSize: "1.2rem" }}>⚠️</span>
            </div>
            <div style={{ ...styles.metricValue, color: "#f87171" }}>{stats?.open ?? "—"}</div>
            <div style={styles.metricSub}>Awaiting officer assignment</div>
          </div>

          <div style={{ ...styles.metricCard, borderLeft: "4px solid #f59e0b" }}>
            <div style={styles.metricHeader}>
              <span style={styles.metricLabel}>Under Active Investigation</span>
              <span style={{ fontSize: "1.2rem" }}>🔍</span>
            </div>
            <div style={{ ...styles.metricValue, color: "#fbbf24" }}>{stats?.investigating ?? "—"}</div>
            <div style={styles.metricSub}>Field & SDLC hearings in progress</div>
          </div>

          <div style={{ ...styles.metricCard, borderLeft: "4px solid #22c55e" }}>
            <div style={styles.metricHeader}>
              <span style={styles.metricLabel}>Disputes Resolved</span>
              <span style={{ fontSize: "1.2rem" }}>✅</span>
            </div>
            <div style={{ ...styles.metricValue, color: "#4ade80" }}>{stats?.resolved ?? "—"}</div>
            <div style={styles.metricSub}>Closed grievance reports; no title certification</div>
          </div>
        </div>

        {/* Filter & Search Toolbar */}
        <div style={styles.toolbarCard}>
          <div style={styles.searchRow}>
            {/* Search Box */}
            <div style={styles.searchBox}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#9ca3af" strokeWidth="2">
                <circle cx="11" cy="11" r="8" />
                <line x1="21" y1="21" x2="16.65" y2="16.65" />
              </svg>
              <input
                type="text"
                placeholder="Search by Ticket ID, Citizen Name, Phone, State, or District…"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                style={styles.searchInput}
              />
              {searchQuery && (
                <button
                  type="button"
                  onClick={() => setSearchQuery("")}
                  style={styles.clearSearchBtn}
                >
                  ✕
                </button>
              )}
            </div>

            {/* Status Filter */}
            <div style={styles.filterWrapper}>
              <label style={styles.filterLabel}>Status:</label>
              <select
                aria-label="Filter by status" value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value)}
                style={styles.filterSelect}
              >
                <option value="all">All Statuses</option>
                <option value="open">Open / Unassigned</option>
                <option value="investigating">Under Investigation</option>
                <option value="inspection_scheduled">Inspection Scheduled</option>
                <option value="resolved">Resolved</option>
                <option value="rejected">Rejected</option>
              </select>
            </div>

            {/* Dispute Type Filter */}
            <div style={styles.filterWrapper}>
              <label style={styles.filterLabel}>Dispute Category:</label>
              <select
                aria-label="Filter by dispute category" value={disputeFilter}
                onChange={(e) => setDisputeFilter(e.target.value)}
                style={styles.filterSelect}
              >
                <option value="all">All Categories</option>
                <option value="Delayed or stalled FRA claim">Delayed or stalled FRA claim</option>
                <option value="Land record mismatch">Land record mismatch</option>
                <option value="Boundary or encroachment dispute">Boundary or encroachment dispute</option>
                <option value="Ownership dispute">Ownership dispute</option>
                <option value="Compensation or rehabilitation dispute">Compensation / Rehabilitation</option>
                <option value="Other">Other</option>
              </select>
            </div>
          </div>
        </div>

        {/* Tickets Registry View */}
        <div style={{ marginTop: "1.5rem" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1rem" }}>
            <div>
              <h2 style={{ fontSize: "1.25rem", fontWeight: 700, margin: 0, color: "#f9fafb" }}>
                Submitted Grievances & FRA Dispute Records
              </h2>
              <p style={{ margin: "0.2rem 0 0", fontSize: "0.85rem", color: "#9ca3af" }}>
                Open a report to review its narrative, selected coordinates and staff actions.
              </p>
            </div>
            <div style={{ fontSize: "0.85rem", color: "#9ca3af" }}>
              <strong>{filteredTickets.length}</strong> matching records loaded · Registry total: {stats?.total ?? "…"}
            </div>
          </div>

          {ticketsError ? (
            <div style={{ ...styles.emptyCard, borderColor: "rgba(239, 68, 68, 0.4)" }}>
              <div style={{ fontSize: "2.5rem", marginBottom: "0.75rem" }}>⚠️</div>
              <h3 style={{ margin: 0, color: "#fca5a5" }}>Could not load the ticket registry</h3>
              <p style={{ margin: "0.5rem 0 1.25rem", color: "#9ca3af", fontSize: "0.9rem" }}>
                No records are shown because the live connection failed — this is not an empty
                registry. Reload the page, and if it persists contact the portal administrator.
              </p>
              <code style={{ color: "#9ca3af", fontSize: "0.8rem" }}>{ticketsError}</code>
            </div>
          ) : ticketsLoading ? (
            <div style={styles.emptyCard}>
              <h3 style={{ margin: 0, color: "#e5e7eb" }}>Loading the ticket registry…</h3>
            </div>
          ) : filteredTickets.length === 0 ? (
            <div style={styles.emptyCard}>
              <div style={{ fontSize: "2.5rem", marginBottom: "0.75rem" }}>📂</div>
              <h3 style={{ margin: 0, color: "#e5e7eb" }}>No dispute tickets found</h3>
              <p style={{ margin: "0.5rem 0 1.25rem", color: "#9ca3af", fontSize: "0.9rem" }}>
                {stats?.total === 0
                  ? "No grievance tickets have been filed yet."
                  : hasMore ? "No matches in the pages searched so far. Continue searching older cases below."
                  : "No records match your selected filter criteria."}
              </p>
              <button
                type="button"
                onClick={() => {
                  setStatusFilter("all");
                  setDisputeFilter("all");
                  setSearchQuery("");
                }}
                style={styles.resetFiltersBtn}
              >
                Clear all filters
              </button>
            </div>
          ) : (
            <div style={styles.ticketGrid}>
              {filteredTickets.map((ticket) => (
                <div
                  key={ticket.id}
                  onClick={() => setSelectedTicket(ticket)}
                  style={{
                    ...styles.ticketCard,
                    borderColor: selectedTicket?.id === ticket.id ? "#22c55e" : "rgba(255,255,255,0.08)",
                  }}
                >
                  {/* Card Header */}
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: "10px" }}>
                    <div>
                      <div style={{ display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap" }}>
                        <span style={styles.ticketIdPill}>{ticket.id}</span>
                        {ticket.source === "whatsapp-hotline" ? (
                          <span style={styles.whatsappSourcePill}>WhatsApp Hotline</span>
                        ) : (
                          <span style={styles.webSourcePill}>Web Dispute Form</span>
                        )}
                        {ticket.priority === "critical" && (
                          <span style={styles.criticalPill}>High Urgency</span>
                        )}
                      </div>
                      <h3 style={styles.ticketTitle}>{ticket.subject}</h3>
                    </div>
                    <div>{renderStatusBadge(ticket.status)}</div>
                  </div>

                  {/* Citizen details & Location row */}
                  <div style={styles.ticketMetaRow}>
                    <div style={styles.metaItem}>
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
                        <circle cx="12" cy="7" r="4" />
                      </svg>
                      <span>
                        {ticket.dispute?.reporterName || "Anonymous Reporter"}
                        <span style={{ opacity: 0.65, marginLeft: "4px" }}>
                          ({ticket.dispute?.reporterType || "Citizen"})
                        </span>
                      </span>
                    </div>

                    <div style={styles.metaItem}>
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z" />
                        <circle cx="12" cy="10" r="3" />
                      </svg>
                      <span>
                        {ticket.dispute?.district
                          ? `${ticket.dispute.district}, ${ticket.dispute.state}`
                          : "Project Registry"}
                      </span>
                    </div>

                    {ticket.waFrom && (
                      <div style={styles.metaItem}>
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                          <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z" />
                        </svg>
                        <span>{ticket.waFrom}</span>
                      </div>
                    )}
                  </div>

                  {/* Verbatim summary teaser */}
                  <p style={styles.ticketSnippet}>
                    {ticket.dispute?.description || ticket.messages?.[0]?.body || "Open the dossier to read the report."}
                  </p>

                  {/* Card Action Footer */}
                  <div style={styles.ticketCardFooter}>
                    <span style={{ fontSize: "0.75rem", color: "#9ca3af" }}>
                      {formatTimestamp(ticket.createdAt || ticket.updatedAt)}
                    </span>
                    <button
                      type="button"
                      style={styles.pursueTicketBtn}
                      onClick={(e) => {
                        e.stopPropagation();
                        setSelectedTicket(ticket);
                      }}
                    >
                      <span>Pursue & Review Details</span>
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <path d="M5 12h14M12 5l7 7-7 7" />
                      </svg>
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
        <div style={{ display: "flex", gap: "1rem", marginTop: "1rem", alignItems: "center" }}><button type="button" disabled={ticketsLoading} onClick={refresh}>Refresh registry</button>{hasMore && <button type="button" disabled={ticketsLoading} onClick={loadMore}>{searchQuery.trim() ? "Continue searching older cases" : "Load older cases"}</button>}<span>{filteredTickets.length} results loaded{hasMore ? " · more cases remain" : " · end of results"}</span></div>
      </main>

      {/* ========================================================================= */}
      {/* SCREEN 3: DEEP TICKET DETAIL INSPECTOR (MODAL / OVERLAY)                  */}
      {/* ========================================================================= */}
      {selectedId && !selectedTicket && <Modal label="Dispute dossier" onClose={() => setSelectedTicket(null)}><div style={{ padding: "2rem", background: "#071224" }}><p role="status">{detailError || "Loading the current case…"}</p><button onClick={() => setSelectedTicket(null)}>Close</button></div></Modal>}
      {selectedTicket && (
        <Modal label="Dispute dossier" className="dossier-dialog" onClose={() => setSelectedTicket(null)}>
          <div
            style={styles.modalContainer}
            onClick={(e) => e.stopPropagation()}
          >
            {/* Modal Top Ribbon */}
            <div style={styles.modalHeader}>
              <div style={{ display: "flex", alignItems: "center", gap: "10px", flexWrap: "wrap" }}>
                <span style={styles.ticketIdPill}>{selectedTicket.id}</span>
                {renderStatusBadge(selectedTicket.status)}
                {selectedTicket.source === "whatsapp-hotline" ? (
                  <span style={styles.whatsappSourcePill}>WhatsApp Verified Submission</span>
                ) : (
                  <span style={styles.webSourcePill}>Web Dispute Form Submission</span>
                )}
              </div>
              <button
                type="button"
                onClick={() => setSelectedTicket(null)}
                style={styles.closeModalBtn}
                title="Close Inspector"
              >
                ✕
              </button>
            </div>

            {/* Modal Body */}
            <div className="dossier-body" style={styles.modalBody}>
              {detailError && <p role="alert">{detailError}</p>}
              {/* Title & Status Controller */}
              <div style={styles.modalSectionCard}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: "1rem", flexWrap: "wrap" }}>
                  <div>
                    <span style={{ fontSize: "0.8rem", color: "#22c55e", fontWeight: 700, letterSpacing: "0.08em" }}>
                      SUBMITTED DISPUTE DOSSIER
                    </span>
                    <h2 style={{ margin: "0.25rem 0 0", fontSize: "1.35rem", color: "#f9fafb" }}>
                      {selectedTicket.subject}
                    </h2>
                  </div>

                  <label className="dossier-edit-control" style={{ display: "block", width: "100%", marginTop: "1rem" }}>Reason for status change<input aria-label="Reason for status change" value={statusReason} onChange={e => setStatusReason(e.target.value)} maxLength={1500} style={{ width: "100%", padding: "0.6rem", marginTop: "0.4rem" }} /></label>
                  {/* Officer Status Control Dropdown */}
                  <div className="dossier-edit-control" style={styles.statusActionBox}>
                    <label style={{ fontSize: "0.75rem", color: "#9ca3af", display: "block", marginBottom: "0.25rem", fontWeight: 600 }}>
                      Change Investigation Status:
                    </label>
                    <select
                      aria-label="Change investigation status" disabled={saving} value={selectedTicket.status}
                      onChange={(e) => handleUpdateStatus(selectedTicket.id, e.target.value)}
                      style={styles.modalStatusSelect}
                    >
                      <option value="open">Open / Awaiting Review</option>
                      <option value="investigating">Under Investigation (Active)</option>
                      <option value="inspection_scheduled">Field Inspection Scheduled</option>
                      <option value="resolved">Grievance resolved</option>
                      <option value="rejected">Closed without resolution</option>
                    </select>
                  </div>
                </div>
              </div>

              {/* Explainable per-ticket decision support */}
              {selectedDecision && (
                <div style={styles.aiDecisionCard}>
                  <div style={styles.aiDecisionHeader}>
                    <div>
                      <div style={styles.aiEyebrow}>EXPLAINABLE TRIAGE RULES</div>
                      <h3 style={styles.aiHeading}>Evidence-based ticket triage</h3>
                      <p style={styles.aiDisclaimer}>
                        Advisory only — the designated officer reviews all evidence and makes the final decision.
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
                </div>
              )}

              {/* Two Column Grid: Reporter vs Opposing Party */}
              <div style={styles.twoColGrid}>
                {/* Column 1: Applicant / Reporter Details */}
                <div style={styles.partyCard}>
                  <div style={styles.partyCardHeader}>
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#22c55e" strokeWidth="2">
                      <path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2" />
                      <circle cx="12" cy="7" r="4" />
                    </svg>
                    <span style={styles.partyHeading}>Aggrieved Citizen / Gram Sabha</span>
                  </div>

                  <div style={styles.detailRow}>
                    <span style={styles.detailLabel}>Full Name:</span>
                    <span style={styles.detailValue}>
                      {selectedTicket.dispute?.reporterName || "Not Provided"}
                    </span>
                  </div>

                  <div style={styles.detailRow}>
                    <span style={styles.detailLabel}>Capacity:</span>
                    <span style={styles.detailValue}>
                      {selectedTicket.dispute?.reporterType || "Individual"}
                    </span>
                  </div>

                  <div style={styles.detailRow}>
                    <span style={styles.detailLabel}>Phone / WhatsApp:</span>
                    <span style={{ ...styles.detailValue, color: "#22c55e", fontWeight: 600 }}>
                      {selectedTicket.waFrom || "Not Provided"}
                    </span>
                  </div>

                  <div style={styles.detailRow}>
                    <span style={styles.detailLabel}>Phone Check:</span>
                    <span style={{ ...styles.detailValue, color: "#4ade80" }}>
                      {selectedTicket.phoneVerified === true ? "Phone verification recorded" : "Phone verification not recorded"}
                    </span>
                  </div>
                </div>

                {/* Column 2: Other Party Details */}
                <div style={styles.partyCard}>
                  <div style={styles.partyCardHeader}>
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#f87171" strokeWidth="2">
                      <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
                      <circle cx="9" cy="7" r="4" />
                      <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
                      <path d="M16 3.13a4 4 0 0 1 0 7.75" />
                    </svg>
                    <span style={{ ...styles.partyHeading, color: "#f87171" }}>Opposing Party / Department</span>
                  </div>

                  <div style={styles.detailRow}>
                    <span style={styles.detailLabel}>Entity Name:</span>
                    <span style={styles.detailValue}>
                      {selectedTicket.dispute?.otherPartyName || "Not Provided"}
                    </span>
                  </div>

                  <div style={styles.detailRow}>
                    <span style={styles.detailLabel}>Entity Classification:</span>
                    <span style={styles.detailValue}>
                      {selectedTicket.dispute?.otherPartyType || "Government Department"}
                    </span>
                  </div>

                  <div style={styles.detailRow}>
                    <span style={styles.detailLabel}>Dispute Category:</span>
                    <span style={{ ...styles.detailValue, color: "#fbbf24" }}>
                      {selectedTicket.dispute?.disputeType || "General FRA Grievance"}
                    </span>
                  </div>
                </div>
              </div>

              {/* Geographic Hierarchy Card */}
              <div style={styles.modalSectionCard}>
                <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "0.75rem" }}>
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#60a5fa" strokeWidth="2">
                    <polygon points="1 6 1 22 8 18 16 22 23 18 23 2 16 6 8 2 1 6" />
                    <line x1="8" y1="2" x2="8" y2="18" />
                    <line x1="16" y1="6" x2="16" y2="22" />
                  </svg>
                  <h3 style={{ margin: 0, fontSize: "1rem", color: "#93c5fd" }}>
                    Geographic & Administrative Jurisdiction
                  </h3>
                </div>

                <div style={styles.geoGrid}>
                  <div style={styles.geoBox}>
                    <div style={styles.geoLabel}>STATE</div>
                    <div style={styles.geoValue}>{selectedTicket.dispute?.state || "India"}</div>
                  </div>
                  <div style={styles.geoBox}>
                    <div style={styles.geoLabel}>DISTRICT</div>
                    <div style={styles.geoValue}>{selectedTicket.dispute?.district || "N/A"}</div>
                  </div>
                  <div style={styles.geoBox}>
                    <div style={styles.geoLabel}>VILLAGE / FOREST COMPARTMENT</div>
                    <div style={styles.geoValue}>
                      {selectedTicket.dispute?.village || "Boundary not specified"}
                      {selectedTicket.dispute?.location && <p>Coordinates: {selectedTicket.dispute.location.latitude.toFixed(6)}, {selectedTicket.dispute.location.longitude.toFixed(6)}</p>}
                    </div>
                  </div>
                </div>
              </div>

              {/* Verbatim Citizen Narrative */}
              <div style={styles.modalSectionCard}>
                <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "0.75rem" }}>
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#22c55e" strokeWidth="2">
                    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                    <polyline points="14 2 14 8 20 8" />
                    <line x1="16" y1="13" x2="8" y2="13" />
                    <line x1="16" y1="17" x2="8" y2="17" />
                    <polyline points="10 9 9 9 8 9" />
                  </svg>
                  <h3 style={{ margin: 0, fontSize: "1rem", color: "#86efac" }}>
                    Complete Verbatim Description Submitted by Citizen
                  </h3>
                </div>
                <div style={styles.verbatimTextBox}>
                  {selectedTicket.dispute?.description ||
                    selectedTicket.messages?.map((m) => m.body).join("\n\n") ||
                    "No narrative provided."}
                </div>
              </div>

              {!!selectedTicket.dispute?.evidenceReferences?.length && <section style={styles.modalSectionCard}><h3>Evidence references supplied by the reporter</h3><p>Staff must verify the referenced records.</p><ul>{selectedTicket.dispute.evidenceReferences.map((reference, index) => <li key={index}>{reference}</li>)}</ul></section>}
              <section style={styles.modalSectionCard}><h3>Recent case history</h3><p>Latest 50 recorded changes. Earlier legacy actions may have no audit entry.</p><ul>{events.map(event => <li key={event.id}><p>{event.kind === "status" ? (event.before + " → " + event.after + ": " + event.reason) : "Case note added"}</p><small>Officer {event.officerUid} · {event.at ? new Date(event.at.seconds * 1000).toLocaleString("en-IN") : "Saving date…"}</small></li>)}</ul>{!events.length && <p>No audit entries recorded yet.</p>}</section>
              {/* Message & Communication Trail */}
              {selectedTicket.messages && selectedTicket.messages.length > 0 && (
                <div style={styles.modalSectionCard}>
                  <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "0.75rem" }}>
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#a78bfa" strokeWidth="2">
                      <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
                    </svg>
                    <h3 style={{ margin: 0, fontSize: "1rem", color: "#c4b5fd" }}>
                      Communication History & Citizen Transcripts
                    </h3>
                  </div>
                  <div style={{ display: "grid", gap: "0.6rem" }}>
                    {selectedTicket.messages.map((msg, idx) => (
                      <div
                        key={idx}
                        style={{
                          ...styles.messagePill,
                          background:
                            msg.from === "officer"
                              ? "rgba(34, 197, 94, 0.12)"
                              : "rgba(255, 255, 255, 0.04)",
                          borderColor:
                            msg.from === "officer"
                              ? "rgba(34, 197, 94, 0.3)"
                              : "rgba(255, 255, 255, 0.08)",
                        }}
                      >
                        <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "0.3rem", fontSize: "0.75rem", color: "#9ca3af" }}>
                          <strong style={{ color: msg.from === "officer" ? "#22c55e" : "#e5e7eb" }}>
                            {msg.from === "officer" ? "Officer Reply" : "Citizen Message"}
                          </strong>
                          <span>{msg.at ? formatTimestamp(msg.at) : ""}</span>
                        </div>
                        <p style={{ margin: 0, fontSize: "0.88rem", lineHeight: 1.5, color: "#f3f4f6" }}>
                          {msg.body}
                        </p>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Officer Investigation Log & Remarks */}
              <div style={styles.modalSectionCard}>
                <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "0.75rem" }}>
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#f59e0b" strokeWidth="2">
                    <path d="M12 20h9" />
                    <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z" />
                  </svg>
                  <h3 style={{ margin: 0, fontSize: "1rem", color: "#fde68a" }}>
                    Official Investigation Log & Field Notes
                  </h3>
                </div>

                {selectedTicket.officerNotes && selectedTicket.officerNotes.length > 0 ? (
                  <ul style={styles.notesList}>
                    {selectedTicket.officerNotes.map((note, i) => (
                      <li key={i} style={styles.noteItem}>
                        {note}
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p style={{ fontSize: "0.85rem", color: "#9ca3af", fontStyle: "italic", margin: "0.25rem 0 0.75rem" }}>
                    No older-format notes recorded.
                  </p>
                )}

                <ul style={styles.notesList}>{notes.map(note => <li key={note.id} style={styles.noteItem}><p>{note.text}</p><small>Officer {note.officerUid} · {note.at ? new Date(note.at.seconds * 1000).toLocaleString("en-IN") : "Saving date…"}</small></li>)}</ul>
                {moreNotes && <button type="button" disabled={notesBusy} onClick={loadOlderNotes}>Load older notes</button>}
                {moreNotes && <p>Showing {notes.length} loaded notes. Load older notes before printing if you need the full history.</p>}
                {/* Add new note */}
                <div style={{ display: "flex", gap: "0.6rem", marginTop: "0.75rem" }}>
                  <input
                    type="text"
                    placeholder="Add official inquiry remark, SDLC hearing note, or team order…"
                    aria-label="Add a case note" maxLength={1500} disabled={saving} value={newOfficerNote}
                    onChange={(e) => setNewOfficerNote(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        handleAddNote(selectedTicket.id);
                      }
                    }}
                    style={styles.noteInput}
                  />
                  <button
                    type="button"
                    disabled={saving || !newOfficerNote.trim()} onClick={() => handleAddNote(selectedTicket.id)}
                    style={styles.addNoteBtn}
                  >
                    Append Remark
                  </button>
                </div>
              </div>
            </div>

            {/* Modal Footer Actions */}
            <div className="dossier-edit-control" style={styles.modalFooter}>
              <div style={{ fontSize: "0.8rem", color: "#9ca3af" }}>
                Reference ID: <code>{selectedTicket.id}</code>
              </div>
              <div style={{ display: "flex", gap: "0.75rem" }}>
                <button
                  type="button"
                  onClick={() => {
                    window.print();
                  }}
                  style={styles.modalSecondaryBtn}
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <polyline points="6 9 6 2 18 2 18 9" />
                    <path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2" />
                    <rect width="12" height="8" x="6" y="14" />
                  </svg>
                  Print Dossier
                </button>
                <button
                  type="button"
                  onClick={() => setSelectedTicket(null)}
                  style={styles.modalPrimaryBtn}
                >
                  Close Review
                </button>
              </div>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}
