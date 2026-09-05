import React, { useEffect, useId, useMemo, useState } from "react";
import { doc, updateDoc } from "firebase/firestore";
import { onAuthStateChanged } from "firebase/auth";
import { auth, db } from "../lib/firebase";
import { signOutQuietly } from "../lib/auth";
import { formatGovClock } from "../lib/formatDate";
import { useLiveTickets, type Ticket as OfficerTicket } from "../lib/useLiveTickets";
import { evaluateTicket, type DecisionPriority } from "../lib/ticketDecisionTree";

// Seed dataset representing diverse FRA disputes across India
const SAMPLE_TICKETS: OfficerTicket[] = [
  {
    id: "FW-2026-0841",
    subject: "Delayed or stalled FRA claim — Birsa Munda Gram Sabha vs Forest Department",
    status: "investigating",
    waFrom: "+91 98450 12890",
    source: "web-dispute-form",
    priority: "critical",
    createdAt: { seconds: Math.floor(Date.now() / 1000) - 86400 * 2 },
    updatedAt: { seconds: Math.floor(Date.now() / 1000) - 3600 * 4 },
    dispute: {
      reporterName: "Birsa Munda Gram Sabha (Rameshwar Oraon)",
      reporterType: "Community or Gram Sabha",
      otherPartyName: "Divisional Forest Office (DFO) Rayagada",
      otherPartyType: "Forest Department",
      disputeType: "Delayed or stalled FRA claim",
      state: "Odisha",
      district: "Rayagada",
      village: "Kashipur Gram Panchayat, Tentulipadar",
      description:
        "Gram Sabha submitted Community Forest Rights (CFR) title claim for 420 hectares of ancestral forest land under Section 3(1)(i) of Forest Rights Act in March 2024. The Sub-Divisional Level Committee (SDLC) has not issued acknowledgment or verified boundaries despite multiple joint verification requests. Joint verification was scheduled twice by Revenue officials but Forest Dept representatives failed to attend, causing undue delay.",
    },
    messages: [
      {
        body: "Gram Sabha resolution copy and boundary GPS survey submitted with application. Over 180 tribal households depend on this minor forest produce (MFP) collection.",
        from: "user",
        at: new Date(Date.now() - 86400 * 2000).toISOString(),
      },
    ],
    officerNotes: [
      "Notified District Collector & Sub-Collector Rayagada on 03/09/2026.",
      "SDLC joint hearing scheduled for next Tuesday.",
    ],
  },
  {
    id: "FW-2026-0792",
    subject: "Land record mismatch — Devendra Korku vs Revenue Department",
    status: "open",
    waFrom: "+91 94251 77312",
    source: "web-dispute-form",
    priority: "high",
    createdAt: { seconds: Math.floor(Date.now() / 1000) - 86400 * 5 },
    updatedAt: { seconds: Math.floor(Date.now() / 1000) - 86400 * 1 },
    dispute: {
      reporterName: "Devendra Korku",
      reporterType: "Individual / private person",
      otherPartyName: "Tehsil Revenue Officer & Beat Guard",
      otherPartyType: "Revenue Department",
      disputeType: "Land record mismatch",
      state: "Madhya Pradesh",
      district: "Betul",
      village: "Chicholi, Khedi Saoligadh",
      description:
        "Patta issued under Individual Forest Rights (IFR) specifies survey parcel 114/2 measuring 2.4 acres. However, digital Bhulekh portal shows survey 114/2 registered as 'Chhote Jhad Ka Jungle' (State Forest buffer). The local Patwari has refused Khasra entry endorsement, stalling agricultural credit and input subsidy applications.",
    },
    messages: [
      {
        body: "I have physical copy of original FRA title signed by DLC in 2018. Please reconcile Bhulekh land records with Title Certificate 401/Betul.",
        from: "user",
        at: new Date(Date.now() - 86400 * 5000).toISOString(),
      },
    ],
    officerNotes: ["Flagged for GIS overlay against cadastral map."],
  },
  {
    id: "FW-2026-0715",
    subject: "Boundary or encroachment dispute — Gujjar Bakerwal Pastoralists vs Local Panchayat",
    status: "inspection_scheduled",
    waFrom: "+91 99068 33410",
    source: "web-dispute-form",
    priority: "high",
    createdAt: { seconds: Math.floor(Date.now() / 1000) - 86400 * 8 },
    updatedAt: { seconds: Math.floor(Date.now() / 1000) - 86400 * 2 },
    dispute: {
      reporterName: "Bashir Ahmed Choudhary",
      reporterType: "Community or Gram Sabha",
      otherPartyName: "Chinar Block Panchayat & Local Contractors",
      otherPartyType: "Gram Panchayat / local government",
      disputeType: "Boundary or encroachment dispute",
      state: "Jammu and Kashmir",
      district: "Anantnag",
      village: "Daksun / Sinthan Top Grazing Route",
      description:
        "Traditional seasonal transhumance livestock migratory corridor blocked by newly erected concrete fencing and commercial parking shed construction without Forest Rights Committee (FRC) NOC. Section 3(1)(d) community customary rights violated.",
    },
    messages: [
      {
        body: "Urgent intervention needed as monsoon return migration begins in 10 days with over 800 sheep and cattle herds.",
        from: "user",
        at: new Date(Date.now() - 86400 * 8000).toISOString(),
      },
    ],
    officerNotes: [
      "Stay order request drafted for District Magistrate.",
      "Field inspection team dispatched under ACF Forest Division.",
    ],
  },
  {
    id: "FW-2026-0689",
    subject: "WhatsApp Hotline Query — Claim status inquiry for Konda Reddi community",
    status: "resolved",
    waFrom: "+91 89781 44521",
    source: "whatsapp-hotline",
    priority: "medium",
    createdAt: { seconds: Math.floor(Date.now() / 1000) - 86400 * 14 },
    updatedAt: { seconds: Math.floor(Date.now() / 1000) - 86400 * 3 },
    dispute: {
      reporterName: "Surya Konda Reddi",
      reporterType: "Community or Gram Sabha",
      otherPartyName: "Integrated Tribal Development Agency (ITDA) Rampachodavaram",
      otherPartyType: "Other government body",
      disputeType: "Delayed or stalled FRA claim",
      state: "Andhra Pradesh",
      district: "Alluri Sitharama Raju",
      village: "Maredumilli, Valamuru",
      description:
        "Community claim filed for non-timber forest produce harvesting rights along Godavari river basin. Awaiting DLC certificate dispatch.",
    },
    messages: [
      {
        body: "Namaste Officer, our Gram Sabha wants to know when the physical title deed will be distributed by District Collector.",
        from: "user",
        at: new Date(Date.now() - 86400 * 14000).toISOString(),
      },
      {
        body: "Title deed approved at DLC meeting on 18th August. Sent via registered post to Gram Sabha Secretary.",
        from: "officer",
        at: new Date(Date.now() - 86400 * 3000).toISOString(),
      },
    ],
    officerNotes: ["Closed after beneficiary confirmed receipt of title certificate."],
  },
];

/* ---------------- COMPONENT ----------------
 * Access to this component is gated entirely by <ProtectedRoute> in App.tsx,
 * which requires a real Firebase Auth session belonging to an allow-listed
 * officer (see the `officers/{uid}` check there and in firestore.rules).
 * There is no login UI or credential check here — by the time this renders,
 * the caller has already been verified.
 */
export function OfficerPortal() {
  const [officerEmail, setOfficerEmail] = useState<string | null>(auth.currentUser?.email ?? null);

  useEffect(() => {
    return onAuthStateChanged(auth, (user) => setOfficerEmail(user?.email ?? null));
  }, []);

  // Portal tickets & data states
  const [tickets, setTickets] = useState<OfficerTicket[]>(SAMPLE_TICKETS);
  const [selectedTicket, setSelectedTicket] = useState<OfficerTicket | null>(null);
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [disputeFilter, setDisputeFilter] = useState<string>("all");
  const [searchQuery, setSearchQuery] = useState<string>("");
  const [newOfficerNote, setNewOfficerNote] = useState<string>("");
  const [currentTime, setCurrentTime] = useState<string>("");

  const officerPortalId = useId();

  // Real-time clock for government portal header
  useEffect(() => {
    const updateTime = () => setCurrentTime(formatGovClock(new Date()));
    updateTime();
    const interval = setInterval(updateTime, 1000);
    return () => clearInterval(interval);
  }, []);

  // Handle Logout
  const handleLogout = async () => {
    await signOutQuietly();
    setSelectedTicket(null);
  };

  // Live Firestore tickets, merged with the realistic sample set so the
  // officer always has comprehensive records — falls back to samples alone
  // while signed out, offline, or before the collection has any documents.
  const { tickets: firestoreTickets, error: ticketsError } = useLiveTickets(Boolean(officerEmail));

  useEffect(() => {
    if (!officerEmail || ticketsError || firestoreTickets.length === 0) {
      setTickets(SAMPLE_TICKETS);
      return;
    }
    // Carry forward whatever is already in `tickets` state for any sample-only
    // id (not present in Firestore) instead of re-deriving it from the pristine
    // SAMPLE_TICKETS constant — otherwise any officer edit made to a mock
    // ticket (status/notes) gets silently discarded the next time this effect
    // re-runs, since firestoreTickets gets a new array reference on every
    // onSnapshot emission, including ones unrelated to the edited ticket.
    setTickets((prev) => {
      const merged = [...firestoreTickets];
      SAMPLE_TICKETS.forEach((sample) => {
        if (!merged.some((m) => m.id === sample.id)) {
          const existing = prev.find((p) => p.id === sample.id);
          merged.push(existing ?? sample);
        }
      });
      return merged;
    });
  }, [officerEmail, firestoreTickets, ticketsError]);

  // Officer-facing banner shown when an optimistic status/note update fails
  // to persist to Firestore (permission denied, offline, or a mock ticket id
  // that has no backing document) — previously swallowed silently.
  const [saveError, setSaveError] = useState<string | null>(null);

  // Update ticket status
  const handleUpdateStatus = async (ticketId: string, nextStatus: string) => {
    const prevStatus = tickets.find((t) => t.id === ticketId)?.status;
    setTickets((prev) =>
      prev.map((t) => (t.id === ticketId ? { ...t, status: nextStatus } : t))
    );
    if (selectedTicket && selectedTicket.id === ticketId) {
      setSelectedTicket((prev) => (prev ? { ...prev, status: nextStatus } : null));
    }

    try {
      const ref = doc(db, "tickets", ticketId);
      await updateDoc(ref, { status: nextStatus });
    } catch {
      setTickets((prev) =>
        prev.map((t) => (t.id === ticketId && prevStatus ? { ...t, status: prevStatus } : t))
      );
      if (selectedTicket && selectedTicket.id === ticketId && prevStatus) {
        setSelectedTicket((prev) => (prev ? { ...prev, status: prevStatus } : null));
      }
      setSaveError("Failed to save the status change — it was not persisted.");
    }
  };

  // Add officer investigation note
  const handleAddNote = async (ticketId: string) => {
    if (!newOfficerNote.trim()) return;
    const noteText = `[${new Date().toLocaleDateString("en-IN")}] ${newOfficerNote.trim()}`;
    const prevNotes = tickets.find((t) => t.id === ticketId)?.officerNotes;

    setTickets((prev) =>
      prev.map((t) => {
        if (t.id === ticketId) {
          const notes = t.officerNotes ? [...t.officerNotes, noteText] : [noteText];
          return { ...t, officerNotes: notes };
        }
        return t;
      })
    );

    if (selectedTicket && selectedTicket.id === ticketId) {
      setSelectedTicket((prev) =>
        prev
          ? {
              ...prev,
              officerNotes: prev.officerNotes
                ? [...prev.officerNotes, noteText]
                : [noteText],
            }
          : null
      );
    }

    setNewOfficerNote("");

    try {
      const ref = doc(db, "tickets", ticketId);
      const target = tickets.find((t) => t.id === ticketId);
      const existing = target?.officerNotes || [];
      await updateDoc(ref, { officerNotes: [...existing, noteText] });
    } catch {
      setTickets((prev) =>
        prev.map((t) => (t.id === ticketId ? { ...t, officerNotes: prevNotes } : t))
      );
      if (selectedTicket && selectedTicket.id === ticketId) {
        setSelectedTicket((prev) => (prev ? { ...prev, officerNotes: prevNotes } : null));
      }
      setSaveError("Failed to save the note — it was not persisted.");
    }
  };

  // Filtered tickets calculation
  const filteredTickets = useMemo(() => {
    return tickets.filter((t) => {
      // Status filter
      if (statusFilter !== "all" && t.status !== statusFilter) return false;

      // Dispute category filter
      if (disputeFilter !== "all") {
        if (t.dispute?.disputeType !== disputeFilter) return false;
      }

      // Search query
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        const idMatch = t.id.toLowerCase().includes(q);
        const subjectMatch = t.subject.toLowerCase().includes(q);
        const reporterMatch = t.dispute?.reporterName?.toLowerCase().includes(q);
        const partyMatch = t.dispute?.otherPartyName?.toLowerCase().includes(q);
        const stateMatch = t.dispute?.state?.toLowerCase().includes(q);
        const districtMatch = t.dispute?.district?.toLowerCase().includes(q);
        const phoneMatch = t.waFrom?.toLowerCase().includes(q);
        return (
          idMatch ||
          subjectMatch ||
          reporterMatch ||
          partyMatch ||
          stateMatch ||
          districtMatch ||
          phoneMatch
        );
      }

      return true;
    });
  }, [tickets, statusFilter, disputeFilter, searchQuery]);

  // Statistics calculation
  const stats = useMemo(() => {
    const total = tickets.length;
    const open = tickets.filter((t) => t.status === "open").length;
    const investigating = tickets.filter(
      (t) => t.status === "investigating" || t.status === "inspection_scheduled"
    ).length;
    const resolved = tickets.filter((t) => t.status === "resolved").length;
    return { total, open, investigating, resolved };
  }, [tickets]);

  const selectedDecision = useMemo(
    () => (selectedTicket ? evaluateTicket(selectedTicket) : null),
    [selectedTicket]
  );

  /* ========================================================================= */
  /* SCREEN 2: AUTHORIZED GOVERNMENT OFFICER DASHBOARD                         */
  /* ========================================================================= */
  return (
    <div style={styles.portalContainer} id={officerPortalId}>
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
                <span style={styles.liveBadge}>LIVE SYSTEM</span>
              </div>
              <div style={{ fontSize: "0.75rem", color: "#9ca3af" }}>
                Govt. of India • Tribal Affairs & FRA Implementation Monitoring
              </div>
            </div>
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: "clamp(0.5rem, 2vw, 18px)", flexWrap: "wrap" }}>
            {/* Realtime clock */}
            <div style={styles.headerTimeBox}>
              <span style={{ color: "#22c55e", marginRight: "6px" }}>●</span>
              {currentTime}
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
            <div style={styles.metricValue}>{stats.total}</div>
            <div style={styles.metricSub}>Recorded in National Registry</div>
          </div>

          <div style={{ ...styles.metricCard, borderLeft: "4px solid #ef4444" }}>
            <div style={styles.metricHeader}>
              <span style={styles.metricLabel}>Pending Initial Action</span>
              <span style={{ fontSize: "1.2rem" }}>⚠️</span>
            </div>
            <div style={{ ...styles.metricValue, color: "#f87171" }}>{stats.open}</div>
            <div style={styles.metricSub}>Awaiting officer assignment</div>
          </div>

          <div style={{ ...styles.metricCard, borderLeft: "4px solid #f59e0b" }}>
            <div style={styles.metricHeader}>
              <span style={styles.metricLabel}>Under Active Investigation</span>
              <span style={{ fontSize: "1.2rem" }}>🔍</span>
            </div>
            <div style={{ ...styles.metricValue, color: "#fbbf24" }}>{stats.investigating}</div>
            <div style={styles.metricSub}>Field & SDLC hearings in progress</div>
          </div>

          <div style={{ ...styles.metricCard, borderLeft: "4px solid #22c55e" }}>
            <div style={styles.metricHeader}>
              <span style={styles.metricLabel}>Disputes Resolved</span>
              <span style={{ fontSize: "1.2rem" }}>✅</span>
            </div>
            <div style={{ ...styles.metricValue, color: "#4ade80" }}>{stats.resolved}</div>
            <div style={styles.metricSub}>Verified and closed with titles</div>
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
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value)}
                style={styles.filterSelect}
              >
                <option value="all">All Statuses ({tickets.length})</option>
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
                value={disputeFilter}
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
                Click on any dispute ticket to pursue full applicant claims, survey boundaries, and investigation actions.
              </p>
            </div>
            <div style={{ fontSize: "0.85rem", color: "#9ca3af" }}>
              Showing <strong>{filteredTickets.length}</strong> of {tickets.length} records
            </div>
          </div>

          {filteredTickets.length === 0 ? (
            <div style={styles.emptyCard}>
              <div style={{ fontSize: "2.5rem", marginBottom: "0.75rem" }}>📂</div>
              <h3 style={{ margin: 0, color: "#e5e7eb" }}>No dispute tickets found</h3>
              <p style={{ margin: "0.5rem 0 1.25rem", color: "#9ca3af", fontSize: "0.9rem" }}>
                No records match your selected filter criteria.
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
                  role="button"
                  tabIndex={0}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      setSelectedTicket(ticket);
                    }
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
                          : "National Registry"}
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
                    {ticket.dispute?.description || ticket.messages?.[0]?.body || "No narrative details recorded."}
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
      </main>

      {/* ========================================================================= */}
      {/* SCREEN 3: DEEP TICKET DETAIL INSPECTOR (MODAL / OVERLAY)                  */}
      {/* ========================================================================= */}
      {selectedTicket && (
        <div
          style={styles.modalOverlay}
          onClick={() => setSelectedTicket(null)}
          role="dialog"
          aria-modal="true"
        >
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
            <div style={styles.modalBody}>
              {/* Title & Status Controller */}
              <div style={styles.modalSectionCard}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: "1rem", flexWrap: "wrap" }}>
                  <div>
                    <span style={{ fontSize: "0.8rem", color: "#22c55e", fontWeight: 700, letterSpacing: "0.08em" }}>
                      OFFICIAL DISPUTE DOSSIER
                    </span>
                    <h2 style={{ margin: "0.25rem 0 0", fontSize: "1.35rem", color: "#f9fafb" }}>
                      {selectedTicket.subject}
                    </h2>
                  </div>

                  {/* Officer Status Control Dropdown */}
                  <div style={styles.statusActionBox}>
                    <label style={{ fontSize: "0.75rem", color: "#9ca3af", display: "block", marginBottom: "0.25rem", fontWeight: 600 }}>
                      Change Investigation Status:
                    </label>
                    <select
                      value={selectedTicket.status}
                      onChange={(e) => handleUpdateStatus(selectedTicket.id, e.target.value)}
                      style={styles.modalStatusSelect}
                    >
                      <option value="open">Open / Awaiting Review</option>
                      <option value="investigating">Under Investigation (Active)</option>
                      <option value="inspection_scheduled">Field Inspection Scheduled</option>
                      <option value="resolved">Resolved / Title Confirmed</option>
                      <option value="rejected">Rejected / Invalid Dispute</option>
                    </select>
                  </div>
                </div>
              </div>

              {/* Explainable per-ticket decision support */}
              {selectedDecision && (
                <div style={styles.aiDecisionCard}>
                  <div style={styles.aiDecisionHeader}>
                    <div>
                      <div style={styles.aiEyebrow}>EXPLAINABLE DECISION-TREE MODEL · DT-FRA-1.0</div>
                      <h3 style={styles.aiHeading}>AI-assisted ticket triage</h3>
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
                      <span style={styles.aiSummaryLabel}>Response window</span>
                      <strong style={styles.aiSummaryValue}>{selectedDecision.responseWindow}</strong>
                    </div>
                    <div style={styles.aiSummaryBox}>
                      <span style={styles.aiSummaryLabel}>Model confidence</span>
                      <strong style={styles.aiSummaryValue}>{selectedDecision.confidence}%</strong>
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
                    <span style={styles.detailLabel}>Identity Check:</span>
                    <span style={{ ...styles.detailValue, color: "#4ade80" }}>
                      {selectedTicket.phoneVerified === true ? "Verified via SMS OTP" : "Phone verification not recorded"}
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
                    No internal officer notes logged yet.
                  </p>
                )}

                {/* Add new note */}
                <div style={{ display: "flex", gap: "0.6rem", marginTop: "0.75rem" }}>
                  <input
                    type="text"
                    placeholder="Add official inquiry remark, SDLC hearing note, or team order…"
                    value={newOfficerNote}
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
                    onClick={() => handleAddNote(selectedTicket.id)}
                    style={styles.addNoteBtn}
                  >
                    Append Remark
                  </button>
                </div>
              </div>
            </div>

            {/* Modal Footer Actions */}
            <div style={styles.modalFooter}>
              <div style={{ fontSize: "0.8rem", color: "#9ca3af" }}>
                Reference ID: <code>{selectedTicket.id}</code>
              </div>
              <div style={{ display: "flex", gap: "0.75rem" }}>
                <button
                  type="button"
                  onClick={() => {
                    alert(`Dispute dossier for ${selectedTicket.id} ready for print/export.`);
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
        </div>
      )}
    </div>
  );
}

/* ---------------- HELPER RENDERERS ---------------- */
function renderStatusBadge(status: string) {
  switch (status) {
    case "open":
      return <span style={styles.badgeOpen}>● Action Required</span>;
    case "investigating":
      return <span style={styles.badgeInvestigating}>● Under Investigation</span>;
    case "inspection_scheduled":
      return <span style={styles.badgeScheduled}>● Field Inspection</span>;
    case "resolved":
      return <span style={styles.badgeResolved}>● Resolved</span>;
    case "rejected":
      return <span style={styles.badgeRejected}>● Rejected</span>;
    default:
      return <span style={styles.badgeInvestigating}>{status}</span>;
  }
}

function decisionTone(priority: DecisionPriority): React.CSSProperties {
  const tones: Record<DecisionPriority, React.CSSProperties> = {
    Critical: { color: "#fecaca", background: "rgba(239, 68, 68, 0.18)", borderColor: "rgba(239, 68, 68, 0.45)" },
    High: { color: "#fed7aa", background: "rgba(249, 115, 22, 0.18)", borderColor: "rgba(249, 115, 22, 0.45)" },
    Medium: { color: "#fde68a", background: "rgba(245, 158, 11, 0.15)", borderColor: "rgba(245, 158, 11, 0.4)" },
    Routine: { color: "#bfdbfe", background: "rgba(59, 130, 246, 0.15)", borderColor: "rgba(59, 130, 246, 0.4)" },
    Closed: { color: "#bbf7d0", background: "rgba(34, 197, 94, 0.15)", borderColor: "rgba(34, 197, 94, 0.4)" },
  };
  return tones[priority];
}

function formatTimestamp(ts: unknown): string {
  if (!ts) return "Recently";
  if (typeof ts === "string") return new Date(ts).toLocaleDateString("en-IN");
  if (typeof ts === "object" && ts !== null && "seconds" in ts) {
    return new Date((ts as { seconds: number }).seconds * 1000).toLocaleDateString("en-IN", {
      day: "2-digit",
      month: "short",
      year: "numeric",
    });
  }
  return "Recently";
}

/* ---------------- STYLES ---------------- */
const styles: Record<string, React.CSSProperties> = {
  // Portal Dashboard Styles
  portalContainer: {
    minHeight: "100vh",
    background: "#040a17",
    color: "#f3f4f6",
    fontFamily: "system-ui, -apple-system, sans-serif",
  },
  portalHeader: {
    position: "sticky",
    top: 0,
    zIndex: 40,
    background: "rgba(4, 12, 28, 0.92)",
    backdropFilter: "blur(12px)",
    borderBottom: "1px solid rgba(255,255,255,0.1)",
    padding: "0.85rem clamp(1rem, 4vw, 2rem)",
  },
  portalHeaderInner: {
    maxWidth: 1400,
    margin: "0 auto",
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    flexWrap: "wrap",
    rowGap: "0.6rem",
  },
  crestMiniCircle: {
    width: 38,
    height: 38,
    borderRadius: "50%",
    background: "rgba(34, 197, 94, 0.12)",
    border: "1.5px solid rgba(34, 197, 94, 0.4)",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
  },
  liveBadge: {
    background: "rgba(34, 197, 94, 0.15)",
    color: "#4ade80",
    fontSize: "0.68rem",
    fontWeight: 800,
    letterSpacing: "0.08em",
    padding: "0.15rem 0.5rem",
    borderRadius: 999,
    border: "1px solid rgba(34, 197, 94, 0.3)",
  },
  headerTimeBox: {
    fontSize: "0.8rem",
    color: "#9ca3af",
    fontVariantNumeric: "tabular-nums",
    background: "rgba(255,255,255,0.04)",
    padding: "0.4rem 0.8rem",
    borderRadius: 8,
    border: "1px solid rgba(255,255,255,0.06)",
  },
  officerProfilePill: {
    display: "flex",
    alignItems: "center",
    gap: "8px",
    background: "rgba(255,255,255,0.05)",
    border: "1px solid rgba(255,255,255,0.08)",
    padding: "0.35rem 0.8rem 0.35rem 0.45rem",
    borderRadius: 999,
  },
  avatarCircle: {
    width: 28,
    height: 28,
    borderRadius: "50%",
    background: "#15803d",
    color: "#ffffff",
    fontSize: "0.75rem",
    fontWeight: 700,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
  },
  signOutBtn: {
    background: "rgba(239, 68, 68, 0.12)",
    border: "1px solid rgba(239, 68, 68, 0.3)",
    color: "#f87171",
    padding: "0.45rem 0.85rem",
    borderRadius: 8,
    fontSize: "0.82rem",
    fontWeight: 600,
    cursor: "pointer",
    display: "flex",
    alignItems: "center",
    gap: "6px",
  },

  portalMain: {
    maxWidth: 1400,
    margin: "0 auto",
    padding: "2rem clamp(1rem, 4vw, 2rem) 4rem",
  },
  metricsGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(min(240px, 100%), 1fr))",
    gap: "1.25rem",
    marginBottom: "1.75rem",
  },
  metricCard: {
    background: "rgba(10, 20, 40, 0.6)",
    border: "1px solid rgba(255,255,255,0.08)",
    borderRadius: 14,
    padding: "1.25rem 1.4rem",
    boxShadow: "0 4px 6px -1px rgba(0,0,0,0.2)",
  },
  metricHeader: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
  },
  metricLabel: {
    fontSize: "0.8rem",
    fontWeight: 600,
    color: "#9ca3af",
    textTransform: "uppercase",
    letterSpacing: "0.05em",
  },
  metricValue: {
    fontSize: "2.2rem",
    fontWeight: 800,
    color: "#f3f4f6",
    margin: "0.35rem 0 0.15rem",
  },
  metricSub: {
    fontSize: "0.75rem",
    color: "#6b7280",
  },

  toolbarCard: {
    background: "rgba(10, 22, 44, 0.7)",
    border: "1px solid rgba(255,255,255,0.08)",
    borderRadius: 14,
    padding: "1rem 1.25rem",
  },
  searchRow: {
    display: "flex",
    gap: "1rem",
    alignItems: "center",
    flexWrap: "wrap",
  },
  searchBox: {
    flex: "1 1 300px",
    display: "flex",
    alignItems: "center",
    gap: "10px",
    background: "rgba(2, 6, 23, 0.7)",
    border: "1px solid rgba(255,255,255,0.12)",
    borderRadius: 10,
    padding: "0.65rem 0.9rem",
  },
  searchInput: {
    flex: 1,
    background: "none",
    border: "none",
    color: "#ffffff",
    fontSize: "0.9rem",
    outline: "none",
  },
  clearSearchBtn: {
    background: "none",
    border: "none",
    color: "#9ca3af",
    cursor: "pointer",
    fontSize: "0.85rem",
  },
  filterWrapper: {
    display: "flex",
    alignItems: "center",
    gap: "8px",
  },
  filterLabel: {
    fontSize: "0.82rem",
    color: "#9ca3af",
    fontWeight: 600,
  },
  filterSelect: {
    background: "rgba(2, 6, 23, 0.8)",
    border: "1px solid rgba(255,255,255,0.12)",
    borderRadius: 8,
    color: "#f3f4f6",
    padding: "0.6rem 0.9rem",
    fontSize: "0.85rem",
    outline: "none",
    cursor: "pointer",
  },

  ticketGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fill, minmax(min(380px, 100%), 1fr))",
    gap: "1.25rem",
  },
  ticketCard: {
    background: "rgba(10, 20, 38, 0.7)",
    border: "1px solid rgba(255,255,255,0.08)",
    borderRadius: 14,
    padding: "1.4rem",
    cursor: "pointer",
    transition: "all 0.18s ease-in-out",
    display: "flex",
    flexDirection: "column",
    gap: "0.85rem",
  },
  ticketIdPill: {
    fontSize: "0.72rem",
    fontFamily: "monospace",
    fontWeight: 700,
    background: "rgba(255,255,255,0.08)",
    color: "#9ca3af",
    padding: "0.2rem 0.55rem",
    borderRadius: 6,
  },
  webSourcePill: {
    fontSize: "0.7rem",
    fontWeight: 600,
    background: "rgba(59, 130, 246, 0.12)",
    color: "#60a5fa",
    border: "1px solid rgba(59, 130, 246, 0.25)",
    padding: "0.15rem 0.5rem",
    borderRadius: 999,
  },
  whatsappSourcePill: {
    fontSize: "0.7rem",
    fontWeight: 600,
    background: "rgba(34, 197, 94, 0.12)",
    color: "#4ade80",
    border: "1px solid rgba(34, 197, 94, 0.25)",
    padding: "0.15rem 0.5rem",
    borderRadius: 999,
  },
  criticalPill: {
    fontSize: "0.7rem",
    fontWeight: 700,
    background: "rgba(239, 68, 68, 0.15)",
    color: "#f87171",
    border: "1px solid rgba(239, 68, 68, 0.3)",
    padding: "0.15rem 0.5rem",
    borderRadius: 999,
  },
  ticketTitle: {
    fontSize: "1.02rem",
    fontWeight: 700,
    margin: "0.4rem 0 0",
    color: "#f9fafb",
    lineHeight: 1.35,
  },
  ticketMetaRow: {
    display: "flex",
    flexWrap: "wrap",
    gap: "0.75rem",
    fontSize: "0.82rem",
    color: "#9ca3af",
  },
  metaItem: {
    display: "flex",
    alignItems: "center",
    gap: "5px",
  },
  ticketSnippet: {
    margin: 0,
    fontSize: "0.85rem",
    color: "#9ca3af",
    lineHeight: 1.5,
    overflow: "hidden",
    display: "-webkit-box",
    WebkitLineClamp: 2,
    WebkitBoxOrient: "vertical",
  },
  ticketCardFooter: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    borderTop: "1px solid rgba(255,255,255,0.06)",
    paddingTop: "0.75rem",
    marginTop: "auto",
  },
  pursueTicketBtn: {
    background: "rgba(34, 197, 94, 0.12)",
    border: "1px solid rgba(34, 197, 94, 0.3)",
    color: "#4ade80",
    padding: "0.35rem 0.75rem",
    borderRadius: 6,
    fontSize: "0.8rem",
    fontWeight: 600,
    display: "flex",
    alignItems: "center",
    gap: "6px",
    cursor: "pointer",
  },

  emptyCard: {
    background: "rgba(10, 20, 40, 0.5)",
    border: "1px dashed rgba(255,255,255,0.15)",
    borderRadius: 16,
    padding: "3.5rem 2rem",
    textAlign: "center",
  },
  resetFiltersBtn: {
    background: "rgba(255,255,255,0.08)",
    border: "1px solid rgba(255,255,255,0.15)",
    color: "#f3f4f6",
    padding: "0.6rem 1.2rem",
    borderRadius: 8,
    fontSize: "0.85rem",
    fontWeight: 600,
    cursor: "pointer",
  },

  // Status Badges
  badgeOpen: {
    background: "rgba(239, 68, 68, 0.15)",
    color: "#f87171",
    border: "1px solid rgba(239, 68, 68, 0.35)",
    padding: "0.2rem 0.65rem",
    borderRadius: 999,
    fontSize: "0.75rem",
    fontWeight: 700,
  },
  badgeInvestigating: {
    background: "rgba(245, 158, 11, 0.15)",
    color: "#fbbf24",
    border: "1px solid rgba(245, 158, 11, 0.35)",
    padding: "0.2rem 0.65rem",
    borderRadius: 999,
    fontSize: "0.75rem",
    fontWeight: 700,
  },
  badgeScheduled: {
    background: "rgba(139, 92, 246, 0.15)",
    color: "#c084fc",
    border: "1px solid rgba(139, 92, 246, 0.35)",
    padding: "0.2rem 0.65rem",
    borderRadius: 999,
    fontSize: "0.75rem",
    fontWeight: 700,
  },
  badgeResolved: {
    background: "rgba(34, 197, 94, 0.15)",
    color: "#4ade80",
    border: "1px solid rgba(34, 197, 94, 0.35)",
    padding: "0.2rem 0.65rem",
    borderRadius: 999,
    fontSize: "0.75rem",
    fontWeight: 700,
  },
  badgeRejected: {
    background: "rgba(107, 114, 128, 0.2)",
    color: "#9ca3af",
    border: "1px solid rgba(107, 114, 128, 0.35)",
    padding: "0.2rem 0.65rem",
    borderRadius: 999,
    fontSize: "0.75rem",
    fontWeight: 700,
  },

  // Modal Inspector Styles
  modalOverlay: {
    position: "fixed",
    inset: 0,
    zIndex: 100,
    background: "rgba(0, 0, 0, 0.75)",
    backdropFilter: "blur(8px)",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    padding: "1.5rem",
  },
  modalContainer: {
    background: "#071224",
    border: "1px solid rgba(255,255,255,0.18)",
    borderRadius: 20,
    width: "100%",
    maxWidth: 960,
    maxHeight: "92vh",
    display: "flex",
    flexDirection: "column",
    boxShadow: "0 25px 50px -12px rgba(0, 0, 0, 0.8)",
  },
  modalHeader: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    padding: "1.25rem 1.75rem",
    borderBottom: "1px solid rgba(255,255,255,0.1)",
    background: "rgba(10, 22, 44, 0.6)",
  },
  closeModalBtn: {
    background: "rgba(255,255,255,0.08)",
    border: "none",
    color: "#9ca3af",
    width: 32,
    height: 32,
    borderRadius: "50%",
    fontSize: "1rem",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    cursor: "pointer",
  },
  modalBody: {
    padding: "1.75rem",
    overflowY: "auto",
    display: "flex",
    flexDirection: "column",
    gap: "1.25rem",
  },
  modalSectionCard: {
    background: "rgba(255,255,255,0.025)",
    border: "1px solid rgba(255,255,255,0.08)",
    borderRadius: 14,
    padding: "1.25rem 1.4rem",
  },
  aiDecisionCard: {
    background: "linear-gradient(145deg, rgba(15, 42, 63, 0.96), rgba(7, 24, 44, 0.96))",
    border: "1px solid rgba(56, 189, 248, 0.34)",
    borderRadius: 14,
    padding: "1.35rem 1.4rem",
    boxShadow: "0 14px 34px rgba(2, 132, 199, 0.08)",
  },
  aiDecisionHeader: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "flex-start",
    gap: "1rem",
    flexWrap: "wrap",
  },
  aiEyebrow: {
    color: "#7dd3fc",
    fontSize: "0.7rem",
    fontWeight: 800,
    letterSpacing: "0.08em",
  },
  aiHeading: {
    margin: "0.25rem 0 0",
    color: "#f0f9ff",
    fontSize: "1.12rem",
  },
  aiDisclaimer: {
    margin: "0.3rem 0 0",
    color: "#94a3b8",
    fontSize: "0.78rem",
  },
  aiPriorityBadge: {
    border: "1px solid",
    borderRadius: 999,
    padding: "0.4rem 0.75rem",
    fontSize: "0.78rem",
    fontWeight: 800,
    textTransform: "uppercase",
    letterSpacing: "0.04em",
  },
  aiSummaryGrid: {
    display: "grid",
    gridTemplateColumns: "minmax(min(240px, 100%), 2fr) repeat(2, minmax(min(140px, 100%), 1fr))",
    gap: "0.75rem",
    marginTop: "1rem",
  },
  aiSummaryBox: {
    background: "rgba(2, 6, 23, 0.42)",
    border: "1px solid rgba(125, 211, 252, 0.14)",
    borderRadius: 10,
    padding: "0.75rem 0.85rem",
    display: "flex",
    flexDirection: "column",
    gap: "0.3rem",
  },
  aiSummaryLabel: {
    color: "#94a3b8",
    fontSize: "0.68rem",
    fontWeight: 700,
    textTransform: "uppercase",
    letterSpacing: "0.05em",
  },
  aiSummaryValue: { color: "#e0f2fe", fontSize: "0.86rem", lineHeight: 1.4 },
  aiRationale: { color: "#cbd5e1", fontSize: "0.86rem", lineHeight: 1.55, margin: "0.9rem 0" },
  aiTwoColumn: {
    display: "grid",
    gridTemplateColumns: "minmax(min(240px, 100%), 0.85fr) minmax(min(320px, 100%), 1.4fr)",
    gap: "1rem",
  },
  aiSubheading: { color: "#bae6fd", fontSize: "0.78rem", fontWeight: 800, marginBottom: "0.55rem" },
  aiPathList: { listStyle: "none", padding: 0, margin: 0, display: "grid", gap: "0.42rem" },
  aiPathItem: { display: "flex", alignItems: "center", gap: "0.55rem", color: "#dbeafe", fontSize: "0.78rem" },
  aiPathNumber: {
    width: 22,
    height: 22,
    borderRadius: "50%",
    background: "rgba(14, 165, 233, 0.2)",
    color: "#7dd3fc",
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    fontSize: "0.68rem",
    fontWeight: 800,
    flex: "0 0 auto",
  },
  aiFactorList: { display: "grid", gap: "0.35rem" },
  aiFactorRow: {
    display: "grid",
    gridTemplateColumns: "130px 1fr",
    gap: "0.6rem",
    borderBottom: "1px solid rgba(255,255,255,0.05)",
    paddingBottom: "0.32rem",
  },
  aiFactorLabel: { color: "#94a3b8", fontSize: "0.75rem" },
  aiFactorValue: { fontSize: "0.75rem", fontWeight: 600 },
  aiDataGaps: {
    marginTop: "0.9rem",
    padding: "0.65rem 0.8rem",
    borderRadius: 8,
    background: "rgba(245, 158, 11, 0.09)",
    border: "1px solid rgba(245, 158, 11, 0.2)",
    color: "#fde68a",
    fontSize: "0.76rem",
    lineHeight: 1.5,
  },
  statusActionBox: {
    background: "rgba(2, 6, 23, 0.6)",
    border: "1px solid rgba(255,255,255,0.12)",
    borderRadius: 10,
    padding: "0.6rem 0.9rem",
  },
  modalStatusSelect: {
    background: "#0d1b30",
    border: "1px solid rgba(255,255,255,0.2)",
    color: "#ffffff",
    borderRadius: 6,
    padding: "0.45rem 0.75rem",
    fontSize: "0.85rem",
    fontWeight: 600,
    outline: "none",
    cursor: "pointer",
  },
  twoColGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(min(320px, 100%), 1fr))",
    gap: "1.25rem",
  },
  partyCard: {
    background: "rgba(255,255,255,0.03)",
    border: "1px solid rgba(255,255,255,0.08)",
    borderRadius: 14,
    padding: "1.25rem",
    display: "flex",
    flexDirection: "column",
    gap: "0.75rem",
  },
  partyCardHeader: {
    display: "flex",
    alignItems: "center",
    gap: "8px",
    marginBottom: "0.25rem",
  },
  partyHeading: {
    fontSize: "0.95rem",
    fontWeight: 700,
    color: "#86efac",
  },
  detailRow: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    fontSize: "0.85rem",
    borderBottom: "1px solid rgba(255,255,255,0.04)",
    paddingBottom: "0.4rem",
  },
  detailLabel: {
    color: "#9ca3af",
  },
  detailValue: {
    color: "#f3f4f6",
    fontWeight: 500,
  },
  geoGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(min(200px, 100%), 1fr))",
    gap: "1rem",
  },
  geoBox: {
    background: "rgba(2, 6, 23, 0.5)",
    border: "1px solid rgba(255,255,255,0.08)",
    borderRadius: 10,
    padding: "0.85rem",
  },
  geoLabel: {
    fontSize: "0.7rem",
    color: "#9ca3af",
    fontWeight: 700,
    letterSpacing: "0.05em",
  },
  geoValue: {
    fontSize: "0.95rem",
    color: "#f3f4f6",
    fontWeight: 600,
    marginTop: "0.25rem",
  },
  verbatimTextBox: {
    background: "rgba(2, 6, 23, 0.75)",
    border: "1px solid rgba(255,255,255,0.1)",
    borderRadius: 10,
    padding: "1.25rem",
    fontSize: "0.92rem",
    lineHeight: 1.65,
    color: "#e5e7eb",
    whiteSpace: "pre-wrap",
    maxHeight: 250,
    overflowY: "auto",
  },
  messagePill: {
    border: "1px solid",
    borderRadius: 10,
    padding: "0.85rem 1rem",
  },
  notesList: {
    margin: 0,
    paddingLeft: "1.25rem",
    fontSize: "0.85rem",
    color: "#e5e7eb",
    lineHeight: 1.7,
  },
  noteItem: {
    marginBottom: "0.35rem",
  },
  noteInput: {
    flex: 1,
    background: "rgba(2, 6, 23, 0.7)",
    border: "1px solid rgba(255,255,255,0.15)",
    borderRadius: 8,
    color: "#ffffff",
    padding: "0.6rem 0.85rem",
    fontSize: "0.85rem",
    outline: "none",
  },
  addNoteBtn: {
    background: "rgba(245, 158, 11, 0.2)",
    border: "1px solid rgba(245, 158, 11, 0.4)",
    color: "#fbbf24",
    padding: "0.6rem 1rem",
    borderRadius: 8,
    fontSize: "0.82rem",
    fontWeight: 600,
    cursor: "pointer",
  },
  modalFooter: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    padding: "1.25rem 1.75rem",
    borderTop: "1px solid rgba(255,255,255,0.1)",
    background: "rgba(10, 22, 44, 0.6)",
  },
  modalSecondaryBtn: {
    background: "rgba(255,255,255,0.06)",
    border: "1px solid rgba(255,255,255,0.15)",
    color: "#e5e7eb",
    padding: "0.65rem 1.1rem",
    borderRadius: 8,
    fontSize: "0.85rem",
    fontWeight: 600,
    display: "flex",
    alignItems: "center",
    gap: "6px",
    cursor: "pointer",
  },
  modalPrimaryBtn: {
    background: "#15803d",
    border: "none",
    color: "#ffffff",
    padding: "0.65rem 1.25rem",
    borderRadius: 8,
    fontSize: "0.85rem",
    fontWeight: 700,
    cursor: "pointer",
  },
};
