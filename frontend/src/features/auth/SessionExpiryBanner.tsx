import { useEffect, useState, type JSX } from "react";
import { useStaffSession } from "./staffSession";
import "./session-expiry.css";

const WARN_MS = 15 * 60_000, URGENT_MS = 2 * 60_000;

function formatEndTime(at: number) {
  // IST, to match the clock and timestamps elsewhere in the staff UI.
  return new Date(at).toLocaleTimeString("en-IN", { timeZone: "Asia/Kolkata", hour: "numeric", minute: "2-digit", hour12: true }) + " IST";
}

// Minutes left, rounded up, so the text (and the live region) only changes
// once a minute instead of on every tick.
function minutesLeft(expiresAt: number | null) {
  return expiresAt ? Math.max(0, Math.ceil((expiresAt - Date.now()) / 60_000)) : null;
}

// Warns before the eight-hour staff session ends, so nobody loses a note they
// are typing. Render it in the portal header and inside any open dialog: a
// modal dialog hides the rest of the page. It does not renew the session; the
// officer saves their work and signs in again afterwards.
export function SessionExpiryBanner(): JSX.Element | null {
  const { isStaff, expiresAt } = useStaffSession();
  const [minutes, setMinutes] = useState(() => minutesLeft(expiresAt));

  useEffect(() => {
    const update = () => setMinutes(minutesLeft(expiresAt));
    update();
    if (!expiresAt) return;
    const timer = setInterval(update, 5_000);
    return () => clearInterval(timer);
  }, [expiresAt]);

  if (!isStaff || !expiresAt || minutes === null) return null;

  const msLeft = minutes * 60_000;
  const endsAt = formatEndTime(expiresAt);
  const inText = minutes <= 1 ? "in less than a minute" : `in ${minutes} min`;

  // A new role="alert" element is announced at once; the polite region below
  // stays mounted (empty) so its first message is announced reliably too.
  if (msLeft <= URGENT_MS) {
    return (
      <div key="urgent" role="alert" className="session-expiry session-expiry--urgent">
        <strong>Your session ends {inText} ({endsAt}).</strong>{" "}
        Save your note or status change now. After that you will need to sign in again.
      </div>
    );
  }
  return (
    <div key="warning" role="status" className={msLeft <= WARN_MS ? "session-expiry" : "session-expiry session-expiry--idle"}>
      {msLeft <= WARN_MS && (
        <>
          <strong>Your session ends at {endsAt} ({inText}).</strong>{" "}
          Save your work before then; you will need to sign in again.
        </>
      )}
    </div>
  );
}
