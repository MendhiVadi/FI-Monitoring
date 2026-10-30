// Shown to read-only viewers in the portal header, the insights page and the
// open dossier (the page behind a modal dialog is inert, so it repeats there).
export function ReadOnlyBanner() {
  return (
    <p className="portal-readonly-banner">
      <span aria-hidden="true" className="portal-readonly-glyph">◑</span>
      <span>
        <strong>Read-only · personal data masked</strong>
        <span className="portal-readonly-detail"> Names, phone numbers and contact details are hidden, and this account cannot change cases.</span>
      </span>
    </p>
  );
}
