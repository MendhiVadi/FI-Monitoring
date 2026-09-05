import { StaticPage } from "../StaticPage";

export function PrivacyPolicy() {
  return (
    <StaticPage title="Privacy Policy">
      <p>
        Forest Watch is a hackathon prototype for monitoring Forest Rights Act
        (FRA) claim implementation. This policy explains what data the demo
        collects and how it is used.
      </p>

      <h2 style={h2}>Data shown on the map and dashboard</h2>
      <p>
        Claim, approval, and land-record data displayed on the map and
        decision-support panel is <strong>synthetic mock data</strong>
        generated for demonstration purposes. It is clearly labelled as mock
        data in the app and is not sourced from, and does not represent, any
        official government record.
      </p>

      <h2 style={h2}>Data you submit</h2>
      <p>
        If you raise a dispute through the web form or our WhatsApp bot, we
        collect the details you provide (such as your message, phone number,
        and any location or photo you share) so the ticket can be tracked and
        followed up on. This information is stored in our Firebase/Firestore
        backend and is visible to people operating the ticket-monitoring
        dashboard.
      </p>
      <p>
        We do not sell your data, and we do not use it for advertising. We do
        not share it outside the project team except where required to
        resolve the dispute you raised.
      </p>

      <h2 style={h2}>Analytics and cookies</h2>
      <p>
        This demo does not use third-party advertising trackers. Basic
        hosting and error logs may be retained by our infrastructure
        providers for operational purposes.
      </p>

      <h2 style={h2}>Your choices</h2>
      <p>
        You can browse the map and dashboard without submitting any personal
        information. If you have raised a dispute and want your submission
        removed or corrected, contact us using the details on the{" "}
        <a href="/contact" style={{ color: "inherit" }}>
          Contact Us
        </a>{" "}
        page.
      </p>

      <h2 style={h2}>Changes to this policy</h2>
      <p>
        As this is an actively developed hackathon project, this policy may
        change as features are added. The version shown here always reflects
        current behavior of the deployed app.
      </p>
    </StaticPage>
  );
}

const h2: React.CSSProperties = { marginTop: "1.75rem", marginBottom: "0.5rem", fontSize: "1.1rem" };
