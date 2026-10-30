import { useState } from "react";
import type { Ticket } from "../tickets/types";
import { STATUS_ORDER, TERMINAL_STATUSES, isKnownStatus, statusLabel } from "../tickets/ticketStatus";
import { StatusBadge } from "../tickets/StatusBadge";
import { Spinner } from "../auth/Spinner";
import { MAX_NOTE_LENGTH, type SaveError, type SaveKind } from "./useOfficerPortal";
import { styles } from "./portal.styles";

const NOTE_WARN_AT = 1400;

// Both buttons remove this box, so focus goes back to the field it describes
// instead of falling out to the page.
export function FieldError({ id, fieldId, error, onRetry, onDismiss }: { id: string; fieldId: string; error: SaveError; onRetry?: () => void; onDismiss: () => void }) {
  const then = (action: () => void) => () => { document.getElementById(fieldId)?.focus(); action(); };
  return (
    <div role="alert" id={id} style={styles.fieldError}>
      <span>{error.message}</span>
      <span style={{ display: "flex", gap: "0.4rem" }}>
        {onRetry && <button type="button" className="portal-btn" style={{ ...styles.resetFiltersBtn, padding: "0 0.85rem" }} onClick={then(onRetry)}>Retry</button>}
        <button type="button" className="icon-btn" aria-label="Dismiss error" style={{ ...styles.clearSearchBtn, color: "#fecaca" }} onClick={then(onDismiss)}>✕</button>
      </span>
    </div>
  );
}

// Status changes are an explicit, confirmed form (never commit-on-change): each
// one writes a permanent audit event and may message an opted-in reporter.
export function DossierActions({ ticket, statusReason, setStatusReason, newNote, setNewNote, saveError, clearSaveError, savingKind, onUpdateStatus, onAddNote }: {
  ticket: Ticket;
  statusReason: string;
  setStatusReason: (text: string) => void;
  newNote: string;
  setNewNote: (text: string) => void;
  saveError: SaveError | null;
  clearSaveError: () => void;
  savingKind: SaveKind | null;
  onUpdateStatus: (ticketId: string, status: string) => Promise<void>;
  onAddNote: (ticketId: string) => Promise<void>;
}) {
  // Local picks reset whenever the case or its saved status changes.
  const baseKey = ticket.id + ":" + ticket.status;
  const [pick, setPick] = useState({ key: baseKey, status: ticket.status, confirming: false });
  const current = pick.key === baseKey ? pick : { key: baseKey, status: ticket.status, confirming: false };
  const pendingStatus = current.status, confirming = current.confirming;
  const [pasteWarning, setPasteWarning] = useState<string | null>(null);
  const saving = savingKind !== null;
  const notifies = ticket.whatsappUpdates === true && ticket.phoneVerified === true;
  const reasonLength = statusReason.trim().length;
  const canSubmitStatus = pendingStatus !== ticket.status && reasonLength >= 3 && !saving;
  const statusError = saveError?.kind === "status" ? saveError : null;
  const noteError = saveError?.kind === "note" ? saveError : null;

  const submitStatus = (event?: { preventDefault(): void }) => {
    event?.preventDefault();
    if (!canSubmitStatus) return;
    if (TERMINAL_STATUSES.has(pendingStatus) && !confirming) { setPick({ ...current, confirming: true }); return; }
    void onUpdateStatus(ticket.id, pendingStatus);
  };
  const submitNote = (event?: { preventDefault(): void }) => {
    event?.preventDefault();
    if (saving || !newNote.trim()) return;
    setPasteWarning(null);
    void onAddNote(ticket.id);
  };

  return (
    <>
      <form id="dossier-status-form" style={styles.actionCard} onSubmit={submitStatus} aria-labelledby="status-form-title">
        <h3 id="status-form-title" style={styles.actionHeading}>Update status</h3>
        <div style={{ fontSize: "0.8rem", color: "#94a3b8", display: "flex", gap: "0.5rem", alignItems: "center", flexWrap: "wrap" }}>
          Current: <StatusBadge status={ticket.status} long />
        </div>
        <label htmlFor="next-status" style={styles.fieldLabel}>New status</label>
        <select
          id="next-status"
          value={pendingStatus}
          onChange={(e) => setPick({ key: baseKey, status: e.target.value, confirming: false })}
          style={styles.modalStatusSelect}
        >
          {!isKnownStatus(ticket.status) && <option value={ticket.status}>{statusLabel(ticket.status)}</option>}
          {STATUS_ORDER.map(status => <option key={status} value={status}>{statusLabel(status)}</option>)}
        </select>
        <label htmlFor="status-reason" style={styles.fieldLabel}>Reason (required, saved to case history)</label>
        <textarea
          id="status-reason"
          rows={3}
          maxLength={MAX_NOTE_LENGTH}
          value={statusReason}
          readOnly={savingKind === "status"}
          onChange={(e) => setStatusReason(e.target.value)}
          aria-invalid={statusError ? true : undefined}
          aria-describedby={"status-reason-hint status-reason-count" + (statusError ? " status-error" : "")}
          style={styles.noteInput}
        />
        <div style={styles.fieldMeta}>
          <p id="status-reason-hint" style={styles.fieldHint}>At least 3 characters. All staff can read it in the case history.</p>
          <span id="status-reason-count" style={styles.counter}>{statusReason.length}/{MAX_NOTE_LENGTH}</span>
        </div>
        {notifies && pendingStatus !== ticket.status && (
          <p style={styles.notifyHint}>This reporter opted in to WhatsApp updates and will be told the new status.</p>
        )}
        {confirming ? (
          <div role="group" aria-labelledby="status-confirm-text" style={styles.confirmBox}>
            <span id="status-confirm-text">
              Close this case as “{statusLabel(pendingStatus)}”?{notifies ? " The reporter will be notified on WhatsApp." : ""}
            </span>
            <span style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
              <button type="submit" className="portal-btn" style={styles.modalPrimaryBtn} disabled={saving} autoFocus>
                {savingKind === "status" ? <><Spinner /> Saving…</> : "Confirm"}
              </button>
              <button type="button" className="portal-btn" style={styles.modalSecondaryBtn} disabled={saving}
                onClick={() => { setPick({ ...current, confirming: false }); document.getElementById("next-status")?.focus(); }}>Cancel</button>
            </span>
          </div>
        ) : (
          <button type="submit" className="portal-btn" style={styles.modalPrimaryBtn} disabled={!canSubmitStatus}>
            {savingKind === "status" ? <><Spinner /> Saving…</> : "Update status"}
          </button>
        )}
        {statusError && (
          <FieldError id="status-error" fieldId="status-reason" error={statusError} onDismiss={clearSaveError}
            onRetry={statusError.retryable && pendingStatus !== ticket.status && !saving ? () => void onUpdateStatus(ticket.id, pendingStatus) : undefined} />
        )}
      </form>

      <form id="dossier-note-form" style={styles.actionCard} onSubmit={submitNote} aria-labelledby="case-note-label">
        <label id="case-note-label" htmlFor="case-note" style={{ ...styles.actionHeading, fontWeight: 700 }}>Add case note</label>
        <textarea
          id="case-note"
          rows={3}
          maxLength={MAX_NOTE_LENGTH}
          value={newNote}
          readOnly={savingKind === "note"}
          onChange={(e) => { setNewNote(e.target.value); if (pasteWarning) setPasteWarning(null); }}
          onKeyDown={(e) => {
            // Ctrl/Cmd+Enter only, and never mid-IME composition (Hindi and other scripts).
            if (e.key === "Enter" && (e.ctrlKey || e.metaKey) && !e.nativeEvent.isComposing) submitNote(e);
          }}
          onPaste={(e) => {
            const pasted = e.clipboardData.getData("text"), field = e.currentTarget;
            const room = MAX_NOTE_LENGTH - (field.value.length - (field.selectionEnd - field.selectionStart));
            setPasteWarning(pasted.length > room
              ? `The pasted text is ${pasted.length} characters but only ${Math.max(room, 0)} fit, so the end was cut off. Check the note before adding it.`
              : null);
          }}
          aria-invalid={noteError ? true : undefined}
          aria-describedby={"case-note-hint case-note-count" + (noteError ? " note-error" : "") + (pasteWarning ? " note-paste" : "")}
          style={styles.noteInput}
        />
        <div style={styles.fieldMeta}>
          <p id="case-note-hint" style={styles.fieldHint}>
            Notes are permanent and visible to all staff.{" "}
            {notifies
              ? "This reporter opted in to WhatsApp updates: they get an alert that the case was updated (the note text is not sent)."
              : "No WhatsApp alert is sent for this case: the reporter has no verified opt-in."}
            {" "}Press Ctrl+Enter to add.
          </p>
          <span id="case-note-count" style={{ ...styles.counter, color: newNote.length > NOTE_WARN_AT ? "#fbbf24" : "#94a3b8" }}>
            {newNote.length}/{MAX_NOTE_LENGTH}
          </span>
        </div>
        {pasteWarning && <p id="note-paste" role="alert" style={{ ...styles.fieldHint, color: "#fde68a" }}>{pasteWarning}</p>}
        <button type="submit" className="portal-btn" style={styles.addNoteBtn} disabled={saving || !newNote.trim()}>
          {savingKind === "note" ? <><Spinner color="#fbbf24" /> Saving…</> : "Add note"}
        </button>
        {noteError && (
          <FieldError id="note-error" fieldId="case-note" error={noteError} onDismiss={clearSaveError}
            onRetry={noteError.retryable && newNote.trim() && !saving ? () => void onAddNote(ticket.id) : undefined} />
        )}
      </form>
    </>
  );
}
