import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import contract from "../../shared/contracts/dispute.json";
import { Spinner } from "../auth/Spinner";
import { STATUS_ORDER, statusLabel } from "../tickets/ticketStatus";
import { REGISTRY_CAP } from "../tickets/useLiveTickets";
import { useOfficerPortal } from "./useOfficerPortal";
import { formatShortDate, relativeTime } from "./presentation";
import { styles } from "./portal.styles";
import { TicketCard } from "./TicketCard";
import { PortalHeader } from "./PortalHeader";
import { Dossier } from "./Dossier";
import { NoticeRegion } from "./NoticeRegion";
import "./portal.css";

const { acknowledgeDays, resolveDays } = contract.serviceTargets;

// Re-renders itself every 30 s so the rest of the registry does not.
function UpdatedAgo({ at }: { at: number | null }) {
  const [, setTick] = useState(0);
  useEffect(() => {
    const timer = setInterval(() => setTick(tick => tick + 1), 30_000);
    return () => clearInterval(timer);
  }, []);
  return <span style={{ fontSize: "0.78rem", color: "#94a3b8" }}>{at ? `Updated ${relativeTime(at)}` : "Not loaded yet"}</span>;
}

/* Access to this component is gated by <ProtectedRoute> in App.tsx, which
 * requires a real Firebase Auth session belonging to an allow-listed staff
 * account (see the `officers/{uid}` check there and in firestore.rules).
 */
export function OfficerPortal() {
  const portal = useOfficerPortal();
  const { officerEmail, selectedId, setSelectedTicket, statusFilter, setStatusFilter, disputeFilter, setDisputeFilter, searchQuery, setSearchQuery,
    filtersActive, clearFilters, handleLogout, confirmLeave, ticketsLoading, ticketsError, ticketsErrorCode, isStale, lastLoadedAt, searchedBack,
    filteredTickets, stats, hasMore, capped, loadMore, refresh, notice, showNotice, dismissNotice, currentUid, readOnly,
    assigneeFilter, setAssigneeFilter, overdueOnly, setOverdueOnly, staff } = portal;
  const searchRef = useRef<HTMLInputElement>(null);
  const [refreshing, setRefreshing] = useState(false);
  const runRefresh = async () => { setRefreshing(true); try { await refresh(); } finally { setRefreshing(false); } };
  const activeFilterCount = [statusFilter !== "all", disputeFilter !== "all", searchQuery.trim() !== "", assigneeFilter !== "all", overdueOnly]
    .filter(Boolean).length;
  const sessionError = ticketsErrorCode === "functions/unauthenticated" || ticketsErrorCode === "functions/permission-denied";
  const firstLoad = ticketsLoading && filteredTickets.length === 0 && !ticketsError;

  const metrics = [
    { key: "all", label: "All cases", value: stats?.total, sub: "Every report in the registry", color: "#f3f4f6", accent: "rgba(255,255,255,0.25)" },
    { key: "open", label: "Open", value: stats?.open, sub: "Open, awaiting review", color: "#fbbf24", accent: "#f59e0b" },
    // The count spans both stages; the server filter matches one status, so the card selects Under Investigation.
    { key: "investigating", label: "In progress", value: stats?.investigating, sub: "Investigation or inspection; selects Under Investigation", color: "#60a5fa", accent: "#3b82f6" },
    { key: "resolved", label: "Resolved", value: stats?.resolved, sub: "Closed as resolved; no title certification", color: "#34d399", accent: "#10b981" },
    { key: "rejected", label: "Closed without resolution", value: stats?.rejected, sub: "Closed, unresolved", color: "#cbd5e1", accent: "#94a3b8" },
  ];
  const isPressed = (key: string) => key === "investigating"
    ? statusFilter === "investigating" || statusFilter === "inspection_scheduled" : statusFilter === key;
  // Overdue doubles as the Overdue-only toggle; the waiting counts have no server filter, so they are not buttons.
  const waitingMetrics = [
    { key: "waiting7", label: "Waiting over 7 days", value: stats?.waiting7, sub: "Not closed, filed more than 7 days ago", accent: "#64748b" },
    { key: "waiting30", label: "Waiting over 30 days", value: stats?.waiting30, sub: "Not closed, filed more than 30 days ago", accent: "#94a3b8" },
  ];

  // "Me" means nothing to a viewer (never assigned), and listOfficers is officer+,
  // so a viewer filters by Anyone / Unassigned only.
  const staffName = (uid: string, name: string | null, email: string | null) => name || email || `Staff ·${uid.slice(-4)}`;
  const otherStaff = staff.officers.filter(officer => officer.access !== "viewer" && officer.uid !== currentUid);
  const knownAssignee = ["all", "me", "unassigned"].includes(assigneeFilter) || otherStaff.some(officer => officer.uid === assigneeFilter);

  async function copyReportLink() {
    try {
      await navigator.clipboard.writeText(window.location.origin + "/report");
      showNotice("Public report link copied.");
    } catch { showNotice("Could not copy automatically. The link is " + window.location.origin + "/report"); }
  }

  return (
    <div className="officer-portal" style={styles.portalContainer}>
      <PortalHeader officerEmail={officerEmail} onLogout={() => void handleLogout()} confirmLeave={confirmLeave} />

      {/* Main Content Area */}
      <main style={styles.portalMain}>
        {/* Metrics double as quick status filters */}
        <div className="portal-metrics" role="group" aria-label="Case counts; select one to filter by status">
          {metrics.map(metric => (
            <button
              key={metric.key}
              type="button"
              className="portal-metric"
              aria-pressed={isPressed(metric.key)}
              style={{ borderLeftColor: metric.accent }}
              onClick={() => setStatusFilter(isPressed(metric.key) && metric.key !== "all" ? "all" : metric.key)}
            >
              <span className="portal-metric-label">{metric.label}</span>
              <span className="portal-metric-value" style={{ color: metric.color }}>{metric.value ?? "—"}</span>
              <span className="portal-metric-sub">{metric.sub}</span>
            </button>
          ))}
        </div>
        <div className="portal-metrics portal-metrics--targets" role="group" aria-label="Service targets">
          <button
            type="button"
            className="portal-metric"
            aria-pressed={overdueOnly}
            style={{ borderLeftColor: "#f97316" }}
            onClick={() => setOverdueOnly(on => !on)}
          >
            <span className="portal-metric-label"><span aria-hidden="true">⏱ </span>Overdue</span>
            <span className="portal-metric-value" style={{ color: "#fdba74" }}>{stats?.overdue ?? "—"}</span>
            <span className="portal-metric-sub">Past the {acknowledgeDays}-day acknowledge or {resolveDays}-day resolve target; selects Overdue only</span>
          </button>
          {waitingMetrics.map(metric => (
            <div key={metric.key} className="portal-metric portal-metric--static" style={{ borderLeftColor: metric.accent }}>
              <span className="portal-metric-label">{metric.label}</span>
              <span className="portal-metric-value" style={{ color: "#e5e7eb" }}>{metric.value ?? "—"}</span>
              <span className="portal-metric-sub">{metric.sub}</span>
            </div>
          ))}
        </div>

        {/* Filter & Search Toolbar */}
        <div style={styles.toolbarCard}>
          <div className="portal-toolbar">
            <div className="staff-search" style={styles.searchBox}>
              <svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#9ca3af" strokeWidth="2" style={{ flex: "none" }}>
                <circle cx="11" cy="11" r="8" />
                <line x1="21" y1="21" x2="16.65" y2="16.65" />
              </svg>
              {/* A viewer's search runs over the masked copy: initials, no phone numbers. */}
              <label htmlFor="registry-search" className="sr-only">
                {readOnly ? "Search cases by ID, initials, state or district" : "Search cases by ID, name, phone, state or district"}
              </label>
              <input
                ref={searchRef}
                id="registry-search"
                type="search"
                enterKeyHint="search"
                placeholder={readOnly ? "Search ID, initials, district" : "Search ID, name, phone, district"}
                maxLength={120}
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                style={styles.searchInput}
              />
              {searchQuery && (
                <button
                  type="button"
                  aria-label="Clear search"
                  onClick={() => { setSearchQuery(""); searchRef.current?.focus(); }}
                  style={styles.clearSearchBtn}
                >
                  ✕
                </button>
              )}
            </div>

            <div className="portal-filter">
              <label htmlFor="filter-status" style={styles.filterLabel}>Status</label>
              <select id="filter-status" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} style={styles.filterSelect}>
                <option value="all">All statuses</option>
                {STATUS_ORDER.map(status => <option key={status} value={status}>{statusLabel(status)}</option>)}
              </select>
            </div>

            <div className="portal-filter">
              <label htmlFor="filter-category" style={styles.filterLabel}>Category</label>
              <select id="filter-category" value={disputeFilter} onChange={(e) => setDisputeFilter(e.target.value)} style={styles.filterSelect}>
                <option value="all">All categories</option>
                {contract.disputeTypes.map(type => <option key={type} value={type}>{type}</option>)}
              </select>
            </div>

            <div className="portal-filter">
              <label htmlFor="filter-assignee" style={styles.filterLabel}>Assignee</label>
              <select id="filter-assignee" value={assigneeFilter} onChange={(e) => setAssigneeFilter(e.target.value)} style={styles.filterSelect}>
                <option value="all">Anyone</option>
                {!readOnly && <option value="me">Assigned to me</option>}
                <option value="unassigned">Unassigned</option>
                {/* A uid from the URL that the directory does not (yet) list. */}
                {!knownAssignee && (
                  <option value={assigneeFilter}>{assigneeFilter === currentUid ? "You" : staff.loading ? "Loading staff…" : "Selected staff member"}</option>
                )}
                {otherStaff.length > 0 && (
                  <optgroup label="Staff">
                    {otherStaff.map(officer => <option key={officer.uid} value={officer.uid}>{staffName(officer.uid, officer.displayName, officer.email)}</option>)}
                  </optgroup>
                )}
              </select>
            </div>

            <button type="button" className="portal-btn portal-toggle" aria-pressed={overdueOnly} onClick={() => setOverdueOnly(on => !on)}>
              <span aria-hidden="true">⏱</span> Overdue only
            </button>

            <div style={{ display: "flex", alignItems: "center", gap: "0.6rem", marginLeft: "auto", flexWrap: "wrap" }}>
              <UpdatedAgo at={lastLoadedAt} />
              <button type="button" className="portal-btn" style={styles.modalSecondaryBtn} disabled={ticketsLoading} onClick={() => void runRefresh()}>
                {refreshing ? <><Spinner /> Refreshing…</> : "Refresh"}
              </button>
            </div>
          </div>
          {activeFilterCount > 0 && (
            <div style={{ display: "flex", alignItems: "center", gap: "0.6rem", marginTop: "0.75rem", fontSize: "0.82rem", color: "#cbd5e1", flexWrap: "wrap" }}>
              <span>{activeFilterCount} filter{activeFilterCount === 1 ? "" : "s"} active</span>
              <button type="button" className="portal-btn" style={{ ...styles.resetFiltersBtn, padding: "0 0.85rem" }} onClick={() => { clearFilters(); searchRef.current?.focus(); }}>
                Clear filters
              </button>
            </div>
          )}
        </div>

        {/* Tickets Registry View */}
        <div style={{ marginTop: "1.5rem" }}>
          <div className="portal-registry-head">
            <div>
              <h2 style={{ fontSize: "1.25rem", fontWeight: 700, margin: 0, color: "#f9fafb" }}>
                Submitted cases
              </h2>
              <p style={{ margin: "0.2rem 0 0", fontSize: "0.85rem", color: "#9ca3af" }}>
                Open a case to review its narrative, selected location and staff actions.
              </p>
            </div>
            <div style={{ fontSize: "0.85rem", color: "#cbd5e1", textAlign: "right" }}>
              {/* No count beside the error card: the list kept on screen is from before the failure. */}
              {!ticketsError && (
                <div>
                  {filtersActive
                    ? `${filteredTickets.length} match${filteredTickets.length === 1 ? "" : "es"}${hasMore ? " so far" : ""}`
                    : `Showing ${filteredTickets.length} of ${stats?.total ?? "…"} cases`}
                </div>
              )}
              {filtersActive && hasMore && searchedBack !== null && !isStale && !ticketsError && (
                <div style={{ fontSize: "0.78rem", color: "#94a3b8" }}>Searched cases updated since {formatShortDate(searchedBack)}</div>
              )}
              <div role="status" style={{ fontSize: "0.78rem", color: "#93c5fd", minHeight: "1em" }}>
                {isStale && filteredTickets.length > 0 && !ticketsError ? "Updating results…" : ""}
              </div>
            </div>
          </div>

          {ticketsError ? (
            <div role="alert" style={{ ...styles.emptyCard, borderColor: "rgba(239, 68, 68, 0.4)", padding: "2.5rem 1.25rem" }}>
              <h3 style={{ margin: 0, color: "#fca5a5" }}>{sessionError ? "Your session ended" : "Could not reach the registry"}</h3>
              <p style={{ margin: "0.5rem 0 1.25rem", color: "#cbd5e1", fontSize: "0.9rem" }}>
                {sessionError
                  ? "Sign in again to keep reviewing cases."
                  : "No cases are shown because the connection failed. This is not an empty registry. Check your connection and retry."}
              </p>
              {sessionError ? (
                <button type="button" className="portal-btn" style={styles.modalPrimaryBtn} onClick={() => void handleLogout()}>Sign in again</button>
              ) : (
                <button type="button" className="portal-btn" style={styles.modalPrimaryBtn} disabled={ticketsLoading} onClick={() => void refresh()}>
                  {ticketsLoading ? <><Spinner /> Retrying…</> : "Retry"}
                </button>
              )}
            </div>
          ) : firstLoad ? (
            <div role="status" style={styles.ticketGrid}>
              <span className="sr-only">Loading the case registry…</span>
              {Array.from({ length: 4 }, (_, index) => <div key={index} className="portal-skeleton" />)}
            </div>
          ) : filteredTickets.length === 0 ? (
            <div style={{ ...styles.emptyCard, padding: "2.5rem 1.25rem" }}>
              {stats?.total === 0 && !filtersActive ? (
                <>
                  <h3 style={{ margin: 0, color: "#e5e7eb" }}>No reports yet</h3>
                  <p style={{ margin: "0.5rem 0 1.25rem", color: "#9ca3af", fontSize: "0.9rem" }}>
                    Share the public report form; new cases appear here after you refresh.
                  </p>
                  <div style={{ display: "flex", gap: "0.75rem", justifyContent: "center", flexWrap: "wrap" }}>
                    <button type="button" className="portal-btn" style={styles.modalPrimaryBtn} onClick={() => void copyReportLink()}>Copy public report link</button>
                    <Link to="/report" className="portal-btn" style={{ ...styles.modalSecondaryBtn, textDecoration: "none" }}>Open report form</Link>
                  </div>
                </>
              ) : (
                <>
                  <h3 style={{ margin: 0, color: "#e5e7eb" }}>{hasMore ? "No matches in the cases searched so far" : "No cases match these filters"}</h3>
                  <p style={{ margin: "0.5rem 0 1.25rem", color: "#9ca3af", fontSize: "0.9rem" }}>
                    {hasMore ? "Older cases have not been searched yet." : "Try a different search or clear the filters."}
                  </p>
                  <div style={{ display: "flex", gap: "0.75rem", justifyContent: "center", flexWrap: "wrap" }}>
                    {hasMore && (
                      <button type="button" className="portal-btn" style={styles.modalPrimaryBtn} disabled={ticketsLoading} onClick={() => void loadMore()}>
                        {ticketsLoading ? <><Spinner /> Searching…</> : "Search older cases"}
                      </button>
                    )}
                    {filtersActive && (
                      <button type="button" className="portal-btn" onClick={() => { clearFilters(); searchRef.current?.focus(); }} style={styles.resetFiltersBtn}>Clear filters</button>
                    )}
                  </div>
                </>
              )}
            </div>
          ) : (
            <div className={isStale ? "portal-grid-stale" : undefined} aria-busy={isStale || undefined} style={styles.ticketGrid}>
              {filteredTickets.map((ticket) => (
                <TicketCard key={ticket.id} ticket={ticket} selected={selectedId === ticket.id} onSelect={setSelectedTicket} currentUid={currentUid} />
              ))}
            </div>
          )}
        </div>
        {!ticketsError && filteredTickets.length > 0 && (
          <div style={{ display: "flex", gap: "1rem", marginTop: "1.25rem", alignItems: "center", justifyContent: "center", flexWrap: "wrap" }}>
            {hasMore ? (
              <button type="button" className="portal-btn" style={styles.modalSecondaryBtn} disabled={ticketsLoading || isStale} onClick={() => void loadMore()}>
                {ticketsLoading && !isStale && !refreshing ? <><Spinner /> Loading…</> : filtersActive ? "Search older cases" : "Load older cases"}
              </button>
            ) : capped ? (
              <p role="status" className="portal-cap-note">Showing the {REGISTRY_CAP} most recent matches — refine your search</p>
            ) : (
              <span style={{ fontSize: "0.82rem", color: "#94a3b8" }}>End of results</span>
            )}
          </div>
        )}
        <NoticeRegion notice={selectedId ? null : notice} onDismiss={dismissNotice} />
      </main>

      {selectedId && <Dossier portal={portal} />}
    </div>
  );
}
