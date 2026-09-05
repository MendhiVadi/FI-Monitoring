import { StaticPage } from "../StaticPage";

export function ContactUs() {
  return (
    <StaticPage title="Contact Us">
      <p>
        Forest Watch is a hackathon project built to demonstrate
        decision-support for Forest Rights Act (FRA) monitoring. For
        questions, feedback, data corrections, or accessibility issues, reach
        the project team:
      </p>

      <p style={{ marginTop: "1.25rem" }}>
        <strong>Email:</strong>{" "}
        <a href="mailto:medhanshkhattar05@gmail.com" style={{ color: "inherit" }}>
          medhanshkhattar05@gmail.com
        </a>
      </p>

      <h2 style={h2}>Field issues and disputes</h2>
      <p>
        To raise a dispute about a specific claim or land record, use{" "}
        <a href="/report" style={{ color: "inherit" }}>
          Raise a Dispute
        </a>{" "}
        or message our WhatsApp bot — this routes to our ticket-tracking
        system rather than email, so it can be followed up on directly.
      </p>

      <h2 style={h2}>Response time</h2>
      <p>
        As a hackathon prototype, this project is maintained on a best-effort
        basis and is not staffed by a government agency or official helpdesk.
      </p>
    </StaticPage>
  );
}

const h2: React.CSSProperties = { marginTop: "1.75rem", marginBottom: "0.5rem", fontSize: "1.1rem" };
