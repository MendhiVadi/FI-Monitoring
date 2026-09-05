import { Link } from "react-router-dom";

// Closing landing-page section: points at the WhatsApp ticketing flow that
// backs /report, so the page ends with a clear call to action rather than
// just trailing off into the footer.
export function WhatsAppCta() {
  return (
    <section
      style={{
        background: "#0d2818",
        padding: "4rem 1.5rem",
        textAlign: "center",
      }}
    >
      <h2 style={{ fontSize: "1.5rem", marginBottom: "0.75rem" }}>Seeing something in the field?</h2>
      <p style={{ opacity: 0.75, maxWidth: 480, margin: "0 auto 1.5rem" }}>
        Message our WhatsApp bot to raise a ticket directly — no forms, no login.
      </p>
      <Link
        to="/report"
        style={{
          display: "inline-block",
          background: "#2f9e64",
          color: "white",
          padding: "0.75rem 1.75rem",
          borderRadius: 999,
          textDecoration: "none",
          fontWeight: 600,
        }}
      >
        Raise a Dispute
      </Link>
      <p style={{ marginTop: "1rem", fontSize: "0.8rem", opacity: 0.6 }}>
        By messaging us you agree to our{" "}
        <Link to="/privacy-policy" style={{ color: "inherit", textDecoration: "underline" }}>
          Privacy Policy
        </Link>{" "}
        and{" "}
        <Link to="/terms-of-use" style={{ color: "inherit", textDecoration: "underline" }}>
          Terms of Use
        </Link>
        .
      </p>
    </section>
  );
}
