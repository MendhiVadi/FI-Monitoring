// Only the non-PII reference number is kept, so a refresh on the confirmation
// (which wipes the in-memory draft) still leaves the reporter something, and
// the tracking page can offer it. Session storage: gone when the tab closes.
const LAST_TICKET_KEY = "land-dispute:last-ticket";

export function readLastTicket(): string | null {
  try { return sessionStorage.getItem(LAST_TICKET_KEY); } catch { return null; }
}

export function writeLastTicket(id: string | null) {
  try {
    if (id) sessionStorage.setItem(LAST_TICKET_KEY, id);
    else sessionStorage.removeItem(LAST_TICKET_KEY);
  } catch { /* storage blocked: the confirmation still shows it this time */ }
}

/** Router state for links to /track, so the reference never goes into a URL. */
export interface TrackLinkState { reference?: string }
