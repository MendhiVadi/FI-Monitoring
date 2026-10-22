import type { Notice } from "./useOfficerPortal";
import { styles } from "./portal.styles";

// A polite live region that stays mounted so additions are announced. The
// portal renders one in the page and one inside the open dossier dialog (the
// page behind a modal dialog is inert), and passes the notice to only one.
export function NoticeRegion({ notice, onDismiss }: { notice: Notice | null; onDismiss: () => void }) {
  return (
    <div className="portal-toast" role="status" aria-live="polite">
      {notice && (
        <div key={notice.id} className="portal-toast-inner">
          <span>{notice.message}</span>
          <button type="button" className="icon-btn" aria-label="Dismiss message" style={{ ...styles.clearSearchBtn, color: "#bbf7d0" }} onClick={onDismiss}>
            ✕
          </button>
        </div>
      )}
    </div>
  );
}
