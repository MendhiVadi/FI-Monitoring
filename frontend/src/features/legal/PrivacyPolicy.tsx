import { Link } from "react-router-dom";
import contract from "../../shared/contracts/dispute.json";
import { LegalPage } from "./LegalPage";
import { SITE } from "./siteInfo";

const DOCS = contract.documents;
const UNSENT_HOURS = DOCS.pendingTtlMinutes / 60;

export function PrivacyPolicy() {
  return (
    <LegalPage title="Privacy Policy">
      {/* contract.version is the consent version the server records, not an
          edit date: wording changes here do not move it, so it is not called "last updated". */}
      <p className="legal-updated">Notice version {contract.version}. This version is recorded with your consent when you submit a report.</p>
      <p>
        {SITE.name} is {SITE.summary}. The project is not a government helpdesk.
      </p>

      <h2>Demonstration data</h2>
      <p>
        The public FRA demonstration uses fictional claim and land-record data with sourced geographic
        boundaries. The staff portal contains submitted reports and is restricted to allow-listed staff.
      </p>

      <h2>Information in a report</h2>
      <p>The report form collects:</p>
      <ul>
        <li>the names and categories of the parties;</li>
        <li>your description of the dispute;</li>
        <li>the state and district, and the coordinates you select;</li>
        <li>optional evidence references;</li>
        <li>the documents you upload, and any Aadhaar number or PAN you type next to them; and</li>
        <li>the immediate risk you report.</li>
      </ul>
      <p>
        A verified phone number is retained with the ticket. Only authorized staff can read these records.
        Do not include unrelated personal details in evidence references.
      </p>

      <h2>Documents you upload</h2>
      <p>
        {SITE.name} is a demonstration project. The report form asks for identity cards, including your
        Aadhaar card or e-Aadhaar PDF and, for a dispute with a private person, your PAN card, and for
        property papers such as deeds, land record extracts, tax receipts, maps, notices and court papers.
        Upload only documents you are entitled to share.
      </p>
      <ul>
        <li>A file is sent to the project as soon as you choose it, before you submit. The draft in your tab keeps only its name and size.</li>
        <li>
          Each file is screened automatically for signs of tampering: its metadata (for example, the software that
          last saved it), how an image was compressed and re-saved, the UIDAI digital signature in the Aadhaar Secure QR code, the printed text (read by text
          recognition and compared with the QR code, the number you typed and your name), a comparison of the face
          on the card with the photo inside the QR code, and whether the same file or ID number appears in another report.
        </li>
        <li>Screening only flags documents for staff review. It never accepts or rejects a report on its own, and its results are shown only to staff. Staff may accept a document, reject it or ask for a new copy, and that decision is recorded in the case history.</li>
        <li>Files, the numbers you type, text read from the documents, face images cropped for the comparison and the screening results are stored with the report. Only allow-listed staff can open them; there is no public access to the files.</li>
        <li>Uploads that are not sent with a report expire after {UNSENT_HOURS} hours and are deleted by the daily clean-up, so within about a day. Removing a file deletes it straight away. A draft that clears after thirty minutes without edits also asks for its files to be deleted; that request fails once your phone verification has expired, and the daily clean-up then deletes them. Documents attached to a report are kept until {DOCS.retentionDaysAfterClose} days after the case is closed, then deleted by the same daily clean-up; reopening the case keeps them.</li>
      </ul>

      <h2>Your location on the report map</h2>
      <p>
        If you choose "Use my current location", your browser asks for permission and then shares your
        device's position with the page to place the pin. Nothing is sent to the project until you submit
        the report, and only the pin you confirm is stored. Map tiles for that area load from OpenStreetMap,
        as they do for any view.
      </p>

      <h2>Phone verification and optional messages</h2>
      <ul>
        <li>WhatsApp delivers verification codes through Meta.</li>
        <li>Codes are stored as keyed hashes and expire after five minutes.</li>
        <li>Successful verification creates a single-use proof valid for fifteen minutes.</li>
        <li>Verification does not subscribe you to report updates: the form has a separate, optional choice. Your consent version and time are saved.</li>
        <li>Reply STOP or unsubscribe to stop updates on existing reports. A new report offers a new, separate choice.</li>
      </ul>

      <h2>Storage and retention</h2>
      <ul>
        <li>Reports, notes and status history are stored in Firebase/Firestore for staff review. No automatic deletion period is configured for these case records; contact the project team for correction or deletion requests.</li>
        <li>Uploaded documents are stored in Firebase Cloud Storage and deleted {DOCS.retentionDaysAfterClose} days after the case closes; unsent uploads expire after {UNSENT_HOURS} hours and are deleted by a daily clean-up.</li>
        <li>Temporary verification, retry and rate-limit records expire and are processed by hourly cleanup.</li>
        <li>Delivery records are eligible for deletion after thirty days.</li>
        <li>Temporary opt-out markers expire after ninety days once the opt-out has been saved on existing tickets.</li>
        <li>Old duplicate contact profiles are eligible for cleanup after thirty days without an update.</li>
      </ul>

      <h2>In your browser</h2>
      <ul>
        <li>Drafts stay only in tab memory and clear after thirty minutes without edits, or when the tab closes or refreshes. Files already uploaded for a draft that is never sent expire on the server after {UNSENT_HOURS} hours and are deleted by its daily clean-up.</li>
        <li>After you submit, the tab keeps only the report's reference number (in session storage) so it can be shown again after a refresh. It is removed when the tab closes or you start another report.</li>
        <li>Staff sign-in expires eight hours after authentication. Remembering a sign-in uses browser local persistence and does not extend the limit.</li>
      </ul>

      <h2>Maps and infrastructure</h2>
      <p>
        Place searches pass through the project backend to OpenStreetMap Nominatim and are cached for up to
        a day. Enter place names without personal details. Map tiles and optional layers come from
        OpenStreetMap, Overpass and Bhuvan. Providers receive requests needed to display the chosen view.
        Hosting and error logs may be retained by infrastructure providers.
      </p>

      <h2>Your choices</h2>
      <p>
        You can browse the public demonstration without submitting a report. We do not sell report data or
        use it for advertising. For correction, deletion or data-handling questions,{" "}
        <Link to="/contact">contact the project team</Link> and quote your ticket reference.
      </p>
    </LegalPage>
  );
}
