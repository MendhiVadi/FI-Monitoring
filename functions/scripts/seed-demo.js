/**
 * Demo data for the LOCAL Firebase emulators (vault/Wave-2-Spec.md section 9):
 * four staff accounts (admin, two officers, a read-only viewer) and 40
 * synthetic cases that cover every status, dispute category, ageing band and
 * overdue state, with matching status events, notes, assignments, document
 * records and re-upload requests.
 *
 * Nothing in it is real. Names, villages, ID numbers and files are made up,
 * phones are +91 00000 xxxxx (three cases use +1 202 555 0xxx, the only numbers
 * the browser harness lets through, so /track can be tried end to end), and no
 * Storage objects are created: document records carry metadata only. Every
 * record is flagged `demo: true`, which is what --purge removes.
 *
 * Refuses to run unless FIRESTORE_EMULATOR_HOST and FIREBASE_AUTH_EMULATOR_HOST
 * are both set, or the project id contains "demo".
 *
 * Usage, from functions/ with the emulators running (firestore + auth):
 *   FIRESTORE_EMULATOR_HOST=127.0.0.1:8080 FIREBASE_AUTH_EMULATOR_HOST=127.0.0.1:9099 \
 *     GCLOUD_PROJECT=demo-forestwatch npm run seed:demo
 *   (same variables) npm run seed:demo:purge      remove all demo data and accounts
 *   node scripts/seed-demo.js --dry-run           build and check the data; touches nothing
 *   --project=<id>                                overrides the project (default demo-forestwatch)
 * Rerunning replaces the previous demo data. Field names mirror what the
 * callables write (disputes/service.ts, tickets/handlers.ts, cases/*,
 * documents/service.ts); keep them in step when those change.
 */
"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { createHash, createHmac } = require("node:crypto");

const DAY = 86_400_000, MINUTE = 60_000;
const DEFAULT_PROJECT = "demo-forestwatch";

// --- arguments and the emulator guard ---------------------------------------

const argv = process.argv.slice(2);
const projectArg = argv.find(arg => arg.startsWith("--project="));
const PURGE = argv.includes("--purge"), DRY_RUN = argv.includes("--dry-run");

function refuse(message) {
  console.error("seed-demo: " + message);
  process.exit(1);
}

function resolveTarget() {
  const stray = argv.filter(arg => arg !== "--purge" && arg !== "--dry-run" && arg !== projectArg);
  if (stray.length) refuse("unknown argument " + stray[0] + ". Use --purge, --dry-run or --project=<id>.");
  const named = (projectArg && projectArg.slice("--project=".length)) || process.env.GCLOUD_PROJECT ||
    process.env.GOOGLE_CLOUD_PROJECT || process.env.FIREBASE_PROJECT;
  const firestore = Boolean(process.env.FIRESTORE_EMULATOR_HOST), auth = Boolean(process.env.FIREBASE_AUTH_EMULATOR_HOST);
  // Half-emulated would write cases to the emulator and accounts to the real project (or the reverse).
  if (firestore !== auth) refuse("set both FIRESTORE_EMULATOR_HOST and FIREBASE_AUTH_EMULATOR_HOST; with only one, part of the run would reach a real project.");
  // Without emulators the project must be named outright: no default that could reach a real backend.
  const projectId = named || (firestore ? DEFAULT_PROJECT : "");
  if (!firestore && !/demo/i.test(projectId)) {
    refuse(`refusing to run against project "${projectId || "(none set)"}". Start the Firestore and Auth emulators and set FIRESTORE_EMULATOR_HOST and ` +
      "FIREBASE_AUTH_EMULATOR_HOST, or use a project id containing \"demo\".");
  }
  return { projectId, emulated: firestore };
}

// --- contract and rules mirrored from the functions code --------------------

function loadContract() {
  const candidates = [path.join(__dirname, "..", "..", "contracts", "dispute.json"),
    path.join(__dirname, "..", "src", "platform", "contracts", "dispute.json")];
  const file = candidates.find(candidate => fs.existsSync(candidate));
  if (!file) throw new Error("contracts/dispute.json was not found.");
  return JSON.parse(fs.readFileSync(file, "utf8"));
}
const contract = loadContract();
const ACK_MS = contract.serviceTargets.acknowledgeDays * DAY, RESOLVE_MS = contract.serviceTargets.resolveDays * DAY;
const REPLACEMENT_TTL_MS = contract.documents.replacementTtlDays * DAY, RETENTION_MS = contract.documents.retentionDaysAfterClose * DAY;
const KINDS = new Map(contract.documents.kinds.map((kind, index) => [kind.id, { ...kind, order: index }]));

// tickets/status.ts
const STATUS_LABELS = {
  open: "Open / Awaiting Review", investigating: "Under Investigation", inspection_scheduled: "Field Inspection Scheduled",
  resolved: "Grievance resolved", rejected: "Grievance closed without resolution",
};
const TERMINAL = ["resolved", "rejected"];

// cases/targets.ts computeOverdue: terminal -> null; no staff action past the
// acknowledge target -> "acknowledge"; past the resolve target -> "resolve".
function computeOverdue(ticket, now) {
  if (TERMINAL.includes(ticket.status)) return null;
  if (ticket.firstActionAt == null && ticket.ackDueAt < now) return "acknowledge";
  if (ticket.resolveDueAt < now) return "resolve";
  return null;
}

// documents/rules.ts documentSummary
const sortKinds = values => [...new Set(values)].sort((a, b) =>
  (KINDS.get(a)?.order ?? KINDS.size) - (KINDS.get(b)?.order ?? KINDS.size) || a.localeCompare(b));
const isFlagged = risk => risk === "high" || risk === "altered";
const documentSummary = (caseType, docs) => ({ caseType, count: docs.length, kinds: sortKinds(docs.map(doc => doc.kind)),
  flagged: docs.filter(doc => isFlagged(doc.risk)).length });

// otp/identity.ts hashId. The browser harness runs with this synthetic secret;
// with another one the +1 202 555 0xxx demo reporters simply cannot answer a
// re-upload request.
const HASH_SECRET = process.env.DISPUTE_OTP_SECRET || "synthetic-browser-secret";
const hashId = value => createHmac("sha256", HASH_SECRET).update(value).digest("hex");
const sha256 = value => createHash("sha256").update(value).digest("hex");

// --- staff accounts ----------------------------------------------------------

// Emulator-only credentials: the Auth emulator accepts any password and these
// accounts exist nowhere else. Only the email addresses are ever printed.
const ACCOUNTS = {
  admin: { uid: "demo-admin", email: "demo.admin@forestwatch.test", password: "Demo-Admin-Local-2026",
    displayName: "Demo Admin", role: "Administrator", access: "admin" },
  officer: { uid: "demo-officer", email: "demo.officer@forestwatch.test", password: "Demo-Officer-Local-2026",
    displayName: "Demo Officer", role: "Divisional Forest Officer", access: "officer" },
  officer2: { uid: "demo-officer-2", email: "demo.officer2@forestwatch.test", password: "Demo-Officer2-Local-2026",
    displayName: "Demo Officer Two", role: "Tribal Welfare Officer", access: "officer" },
  viewer: { uid: "demo-viewer", email: "demo.viewer@forestwatch.test", password: "Demo-Viewer-Local-2026",
    displayName: "Demo Viewer", role: "Read-only observer", access: "viewer" },
};
// What every new staff write stores (tickets/authorization.ts staffStamp).
const stamp = account => ({ officerUid: account.uid, officerEmail: account.email, officerName: account.displayName, officerRole: account.role });

// --- scenario data -----------------------------------------------------------

// Approximate district centres, so a pin lands in the right part of the state.
const PLACES = {
  "Madhya Pradesh": [["Mandla", 22.6, 80.4], ["Dindori", 22.9, 81.1], ["Balaghat", 21.8, 80.2], ["Betul", 21.9, 77.9], ["Seoni", 22.1, 79.5]],
  "Odisha": [["Koraput", 18.8, 82.7], ["Rayagada", 19.2, 83.4], ["Kandhamal", 20.5, 84.2], ["Mayurbhanj", 21.9, 86.7], ["Kalahandi", 19.9, 83.2]],
  "Chhattisgarh": [["Bastar (Jagdalpur)", 19.1, 82.0], ["Kanker (Uttar Bastar)", 20.3, 81.5], ["Surguja (Ambikapur)", 23.1, 83.2], ["Dhamtari", 20.7, 81.5]],
  "Maharashtra": [["Gadchiroli", 20.2, 80.0], ["Nandurbar", 21.4, 74.2], ["Chandrapur", 19.9, 79.3], ["Pune", 18.5, 73.9]],
  "Jharkhand": [["West Singhbhum (Chaibasa)", 22.5, 85.8], ["Gumla", 23.0, 84.5], ["Latehar", 23.7, 84.5], ["Dumka", 24.3, 87.2]],
  "Telangana": [["Adilabad", 19.7, 78.5], ["Bhadradri Kothagudem", 17.6, 80.6], ["Mulugu", 18.2, 79.9]],
  "Andhra Pradesh": [["Alluri Sitharama Raju", 18.1, 82.7], ["Parvathipuram Manyam", 18.8, 83.4], ["Visakhapatnam", 17.7, 83.2]],
  "Karnataka": [["Chamarajanagar", 11.9, 76.9], ["Uttara Kannada (Karwar)", 14.8, 74.1], ["Mysuru (Mysore)", 12.3, 76.6]],
  "Rajasthan": [["Udaipur", 24.6, 73.7], ["Banswara", 23.5, 74.4], ["Dungarpur", 23.8, 73.7]],
  "Gujarat": [["Dang", 20.8, 73.7], ["Narmada", 21.9, 73.5], ["Tapi", 21.1, 73.4]],
  "Kerala": [["Wayanad", 11.7, 76.1], ["Palakkad", 10.8, 76.7]],
  "Assam": [["Karbi Anglong", 25.9, 93.4], ["Kokrajhar", 26.4, 90.3]],
};
const VILLAGES = ["Demo Nagar", "Sample Pada", "Test Gaon", "Demopur", "Sampleguda", "Testwadi", "Example Tola", "Dummy Para"];
const FIRST_NAMES = ["Asha", "Birsa", "Chandra", "Devi", "Eknath", "Fatima", "Gopal", "Hira", "Indu", "Jagdish", "Kavita", "Laxman", "Meena",
  "Nanda", "Omkar", "Padma", "Qadir", "Radha", "Suresh", "Tara", "Uday", "Vimala", "Wangchuk", "Yashoda", "Zubin", "Anita", "Bhima", "Champa",
  "Dilip", "Ela", "Farid", "Gauri", "Hemant", "Ishwar", "Jyoti", "Kiran", "Lata", "Mohan", "Nirmala", "Om"];
const OFFICES = { "Forest Department": "Demo Range Forest Office", "Revenue Department": "Demo Tehsil Office",
  "Gram Panchayat / local government": "Demo Gram Panchayat Office", "Other government body": "Demo District Land Office",
  "Not sure": "Demo Unidentified Office" };

// One pair per dispute type (contract.disputeTypes order); {other} is the other party.
const NARRATIVES = [
  ["The boundary stones on the eastern side of our plot were moved overnight. {other} now says the strip belongs to the adjoining holding.",
    "A new fence has been put up across the footpath we use to reach the forest produce. {other} claims the land inside it."],
  ["{other} is cultivating land recorded in our family's name for generations and refuses to show any papers.",
    "Two parties hold documents for the same plot. We have possession; {other} holds an older deed."],
  ["Our individual forest rights claim was filed with the Gram Sabha last year and has not moved. No hearing date has been given by {other}.",
    "The claim was approved by the Gram Sabha but the title was never issued. {other} has not responded to our reminders."],
  ["The land record extract shows a different area and owner than the plot we hold. {other} has not corrected the entry.",
    "The survey number in the record of rights does not match the number on our patta, and {other} will not reconcile them."],
  ["We were displaced for a road project and the compensation offered by {other} is far below the assessed value of the land.",
    "Rehabilitation plots promised after the relocation were never allotted by {other}."],
  ["Access to the community grazing land has been blocked, and {other} says it is not responsible.",
    "The notice we received from {other} does not say which plot it refers to. Please advise."],
];
const SYNTHETIC_TAIL = " (Synthetic demo case.)";
const NOTES = [
  "Spoke to the reporter; they will bring the original papers to the office.",
  "The plot appears in the 2019 survey. Awaiting the sketch map from the range office.",
  "Gram Sabha secretary contacted; the meeting date is still to be fixed.",
  "Reminder sent to the revenue inspector for the mutation entry.",
  "Both sides agreed to a joint site visit.",
  "Photographs of the boundary pillars filed with the dossier.",
  "Waiting for a reply from the sub-divisional office.",
  "Reporter called back; no change in the situation on the ground.",
];
const REASONS = {
  investigating: ["Taken up for review; records requested from the local office.", "Verification started; the range office was asked for the survey sketch."],
  inspection_scheduled: ["Field inspection scheduled with the range officer and the Gram Sabha.", "Joint site visit fixed with both sides."],
  resolved: ["Boundary marked jointly and accepted by both sides; closed as resolved.", "Records corrected by the competent office; the reporter confirmed."],
  rejected: ["Outside the scope of this grievance process; the reporter was advised on the proper forum.", "Duplicate of a grievance already under review."],
  reopened: ["Reopened after the reporter sent new papers."],
};

// Staff steps by days after filing: [type, day, status?]. "assign" gives the
// case to the row's assignee (skipped without one); steps must lie in the past.
const FLOWS = {
  none: [],
  ack: [["note", 1.2]],
  take: [["assign", 0.8]],
  inv: [["assign", 0.6], ["status", 1, "investigating"]],
  invNote: [["assign", 0.5], ["status", 1, "investigating"], ["note", 4]],
  insp: [["assign", 0.5], ["status", 1, "investigating"], ["note", 3], ["status", 8, "inspection_scheduled"]],
  res: [["assign", 0.5], ["status", 1, "investigating"], ["note", 4], ["status", 8, "inspection_scheduled"], ["status", 17, "resolved"]],
  // Closed after the resolve target: flagged "resolve" on day 30, cleared when it closes.
  resLate: [["assign", 0.5], ["status", 1, "investigating"], ["note", 6], ["status", 12, "inspection_scheduled"], ["status", 40, "resolved"]],
  rej: [["assign", 1], ["status", 2, "investigating"], ["note", 4], ["status", 7, "rejected"]],
  // First action only after the acknowledge target: flagged, then cleared by staff.
  late: [["assign", 6], ["status", 6.1, "investigating"]],
  lateLong: [["assign", 10], ["status", 10.1, "investigating"], ["note", 14]],
  reopen: [["assign", 0.5], ["status", 1, "investigating"], ["status", 10, "resolved"], ["status", 25, "investigating"]],
  handback: [["assign", 0.5], ["status", 1, "investigating"], ["note", 4], ["unassign", 20]],
};

// [age in days, flow, assignee, state, dispute type index, other party type, extras]. Row n is case n.
// States with fewer than 3 cases (Rajasthan, Kerala, Assam) fold into "Other" on the Insights page.
const row = (age, flow, assignee, state, dtype, party, extra = {}) => ({ age, flow, assignee, state, dtype, party, ...extra });
const INDIVIDUAL = "Individual / private person", FOREST = "Forest Department", REVENUE = "Revenue Department";
const PANCHAYAT = "Gram Panchayat / local government", OTHER_GOV = "Other government body", UNSURE = "Not sure";
const CASES = [
  row(0.2, "none", null, "Madhya Pradesh", 0, FOREST, { risk: "yes" }),
  row(0.9, "none", null, "Odisha", 2, FOREST),
  row(1.6, "none", null, "Chhattisgarh", 1, INDIVIDUAL),
  row(2.4, "none", null, "Maharashtra", 3, REVENUE, { guest: true }),
  row(3.5, "none", null, "Jharkhand", 0, INDIVIDUAL),
  row(5, "none", null, "Madhya Pradesh", 4, PANCHAYAT),
  row(9, "none", null, "Odisha", 2, FOREST),
  row(17, "none", null, "Telangana", 1, INDIVIDUAL, { guest: true }),
  row(41, "none", null, "Karnataka", 0, REVENUE),
  row(2, "take", "officer", "Madhya Pradesh", 5, OTHER_GOV),
  row(4, "inv", "officer2", "Andhra Pradesh", 2, FOREST, { guest: true }),
  row(6, "invNote", "officer", "Madhya Pradesh", 0, INDIVIDUAL),
  row(8, "inv", null, "Chhattisgarh", 3, REVENUE),
  row(12, "insp", "admin", "Odisha", 3, REVENUE),
  row(15, "insp", "officer", "Maharashtra", 0, FOREST),
  row(21, "invNote", "officer2", "Jharkhand", 3, PANCHAYAT, { phone: "+12025550103" }),
  row(27, "inv", "officer", "Andhra Pradesh", 2, FOREST, { phone: "+12025550102" }),
  row(33, "inv", "officer", "Madhya Pradesh", 4, OTHER_GOV, { phone: "+12025550101" }),
  row(38, "insp", "officer2", "Odisha", 0, INDIVIDUAL),
  row(52, "handback", "officer", "Chhattisgarh", 1, INDIVIDUAL),
  row(67, "inv", "officer", "Telangana", 4, REVENUE),
  row(85, "ack", null, "Rajasthan", 2, FOREST, { guest: true }),
  row(101, "insp", "officer2", "Gujarat", 0, FOREST),
  row(118, "inv", null, "Kerala", 3, REVENUE),
  row(14, "late", "officer", "Madhya Pradesh", 5, UNSURE),
  row(45, "lateLong", "officer2", "Odisha", 2, FOREST),
  row(20, "res", "officer", "Karnataka", 0, FOREST),
  row(31, "res", "officer2", "Maharashtra", 4, PANCHAYAT, { guest: true }),
  row(48, "resLate", "officer", "Chhattisgarh", 1, INDIVIDUAL),
  row(63, "res", "admin", "Jharkhand", 3, REVENUE),
  row(90, "res", "officer", "Madhya Pradesh", 2, FOREST),
  row(10, "rej", null, "Telangana", 5, OTHER_GOV),
  row(29, "rej", null, "Gujarat", 5, FOREST),
  row(55, "rej", "officer2", "Odisha", 5, UNSURE, { guest: true }),
  row(74, "rej", null, "Rajasthan", 1, INDIVIDUAL),
  row(60, "reopen", "officer", "Andhra Pradesh", 0, FOREST),
  row(7, "inv", "officer", "Karnataka", 2, FOREST, { risk: "yes" }),
  row(3.2, "ack", null, "Assam", 0, PANCHAYAT),
  row(24, "insp", "officer", "Maharashtra", 3, REVENUE),
  row(11, "none", null, "Gujarat", 5, UNSURE, { guest: true }),
];

// Document records for some cases, by case number. Required kinds come from the
// contract's case type (person-vs-person asks for five), `extras` are optional
// kinds. `profiles` picks a screening outcome per kind (default "clean").
// Reviews: `d` days after filing or `ago` days before now; `request: true`
// opens a re-upload request (14 days). `replace` answers it with a new copy.
const DOC_SETS = {
  3: { extras: ["selfie"], profiles: { ownership_deed: "medium" } },
  7: { extras: ["site_photo", "notice"], profiles: { aadhaar: "high", site_photo: "medium" } },
  12: { extras: [], profiles: { pan: "medium" }, reviews: [
    { kind: "aadhaar", decision: "accepted", reason: "Name and QR details match the report.", d: 2 },
    { kind: "pan", decision: "accepted", reason: "Readable; the editor note in the metadata is explained by the scan.", d: 2.1 }] },
  14: { extras: ["aadhaar_angle", "land_record"], profiles: { aadhaar: "altered", aadhaar_angle: "medium" }, reviews: [
    { kind: "aadhaar", decision: "rejected", reason: "The QR signature does not verify; the original e-Aadhaar was requested through the office.", d: 3 }] },
  16: { extras: ["land_record"], profiles: { land_record: "medium" }, reviews: [
    { kind: "land_record", decision: "reupload_requested", reason: "The extract is cropped; please send the full page.", ago: 9, request: true }],
    replace: { kind: "land_record", ago: 7 } },
  17: { extras: ["site_photo"], profiles: { site_photo: "medium" }, reviews: [
    { kind: "site_photo", decision: "reupload_requested", reason: "The photos are too dark to show the boundary; please send daylight photos.", ago: 12.5, request: true }] },
  18: { extras: ["notice"], profiles: { aadhaar: "medium" }, reviews: [
    { kind: "aadhaar", decision: "reupload_requested", reason: "The photo is blurry; please send a sharper copy or the e-Aadhaar PDF.", ago: 3, request: true }] },
  25: { extras: [], profiles: {}, reviews: [{ kind: "aadhaar", decision: "accepted", reason: "Clear copy; details match.", ago: 5 }] },
  27: { extras: ["notice"], profiles: {}, reviews: [
    { kind: "aadhaar", decision: "accepted", reason: "Clear copy; details match.", d: 3 },
    { kind: "notice", decision: "accepted", reason: "The notice names the plot in dispute.", d: 3.1 }] },
  29: { extras: [], profiles: {}, reviews: [
    { kind: "aadhaar", decision: "accepted", reason: "Details match the report.", d: 5 },
    { kind: "pan", decision: "accepted", reason: "Details match the report.", d: 5.1 },
    { kind: "ownership_deed", decision: "accepted", reason: "Deed names the reporter and the plot.", d: 6 },
    { kind: "land_record", decision: "accepted", reason: "Extract is current.", d: 6.1 }] },
  33: { extras: [], profiles: { aadhaar: "medium" }, reviews: [
    { kind: "aadhaar", decision: "rejected", reason: "Too unclear to verify; the grievance falls outside this process in any case.", d: 5 }] },
  36: { extras: [], profiles: {}, reviews: [{ kind: "aadhaar", decision: "accepted", reason: "Clear copy; details match.", d: 2 }] },
};

// --- screening records -------------------------------------------------------

const LABELS = {
  integrity: "File integrity", metadata: "Metadata", jpeg: "JPEG compression", ela: "Error level analysis", duplicates: "Duplicates",
  aadhaar_qr: "Aadhaar Secure QR", print_vs_qr: "Printed text vs QR", id_numbers: "ID numbers", name_match: "Name match", faces: "Faces",
  pdf_signature: "PDF digital signature", copy_move: "Copied regions (copy-move)", hologram: "Hologram (tilted photo)",
  liveness: "Selfie liveness", selfie_match: "Selfie matches the Aadhaar photo", kyc: "Identity (KYC) check",
};
// Points per warn/fail (screening/index.ts; the wave-2 checks are estimates). Bands: low < 25 <= medium < 55 <= high.
const WEIGHTS = {
  integrity: [10, 40], metadata: [15, 15], jpeg: [10, 10], ela: [15, 15], duplicates: [25, 60], aadhaar_qr: [15, 45], print_vs_qr: [10, 40],
  id_numbers: [10, 35], name_match: [10, 30], faces: [10, 30], pdf_signature: [15, 45], copy_move: [10, 10], hologram: [5, 5],
  liveness: [15, 40], selfie_match: [15, 40], kyc: [0, 0],
};
const SEVERITY = { fail: 4, warn: 3, pass: 2, info: 1, unavailable: 0 };
// Findings per profile, replacing the passing text of a check the document has.
const FLAWS = {
  clean: {},
  medium: { metadata: ["warn", "Saved by an image editor (Demo Photo Editor 2.1) after it was captured."],
    ela: ["warn", "Some regions recompress differently from the rest of the image."] },
  high: { duplicates: ["fail", "An identical file appears in 1 other report."], name_match: ["warn", "The printed name differs from the reporter's name."] },
  altered: { aadhaar_qr: ["fail", "The QR signature does not verify against UIDAI's certificate."],
    print_vs_qr: ["warn", "Printed details do not match the QR payload."] },
};
const PDF_KINDS = ["land_record", "encumbrance", "mutation", "ownership_deed", "notice", "police_court"];

function checksFor(kind, profile, pdf) {
  const flaws = FLAWS[profile], checks = [];
  const add = (id, result, detail) => checks.push({ id, label: LABELS[id], result, detail });
  const use = (id, passing) => (flaws[id] ? add(id, ...flaws[id]) : add(id, "pass", passing));
  use("integrity", "The file structure is consistent.");
  if (kind === "selfie") {
    add("liveness", "pass", "Three poses held (straight, left, right); one face in each frame and the head turn is real.");
    add("selfie_match", "pass", "The face matches the Aadhaar card photo and the QR photo.");
    add("kyc", "info", "Mock verification — not a real KYC check.");
    return checks;
  }
  use("metadata", "No editing software is recorded in the file.");
  if (!pdf) { use("jpeg", "Compression history looks like a single save."); use("ela", "No regions stand out under error level analysis."); }
  if (pdf && kind === "aadhaar") add("pdf_signature", "pass", "Signed by a synthetic demo signer; the signature verifies.");
  use("duplicates", "Not seen in other reports.");
  if (kind === "aadhaar") {
    use("aadhaar_qr", "The QR signature verifies (synthetic demo record).");
    use("print_vs_qr", "Printed details match the QR payload.");
    use("id_numbers", "The ID number is well formed.");
    use("name_match", "The printed name matches the reporter's name.");
    use("faces", "One face on the card; the QR photo agrees.");
  }
  if (kind === "pan") { use("id_numbers", "The ID number is well formed."); use("name_match", "The printed name matches the reporter's name."); }
  if (kind === "aadhaar_angle") {
    if (profile === "medium") add("hologram", "warn", "The colour shift is weaker than expected; the photo may be too flat to judge.");
    else add("hologram", "pass", "The regional colour shift between the two photos fits a genuine hologram.");
  }
  if (profile === "medium" && !pdf && ["site_photo", "ownership_deed", "land_record"].includes(kind)) {
    add("copy_move", "warn", "Two near-identical regions were found in the image.");
  }
  return checks;
}

// screening/index.ts summarise
function summarise(risk, score, checks) {
  if (risk === "altered") return "Altered: the Aadhaar QR signature does not verify against UIDAI's certificate.";
  const issues = checks.filter(check => check.result === "fail" || check.result === "warn")
    .sort((a, b) => SEVERITY[b.result] - SEVERITY[a.result] || WEIGHTS[b.id][1] - WEIGHTS[a.id][1]).slice(0, 3)
    .map(check => `${check.label}: ${check.detail.split(/(?<=\.)\s/)[0].replace(/\.$/, "")}`);
  const band = `${risk[0].toUpperCase()}${risk.slice(1)} risk (${score})`;
  return issues.length ? `${band}. ${issues.join("; ")}.` : `${band}. No problems found by the automated checks.`;
}

function screeningFor(ctx, kind, profile, pdf, uploadedAt) {
  const checks = checksFor(kind, profile, pdf);
  const points = checks.reduce((sum, check) => sum + (check.result === "fail" ? WEIGHTS[check.id][1] : check.result === "warn" ? WEIGHTS[check.id][0] : 0), 0);
  const altered = profile === "altered", score = altered ? 100 : Math.min(99, points);
  const risk = altered ? "altered" : score < 25 ? "low" : score < 55 ? "medium" : "high";
  const extracted = {};
  if (kind === "aadhaar") {
    extracted.qr = { signatureValid: !altered, name: profile === "high" ? "Different Name Sample" : ctx.reporterName, dob: "1990-01-01", gender: "F",
      last4: "0000", district: ctx.district, state: ctx.state, pincode: "000000", hasPhoto: true };
  }
  if (kind === "aadhaar" || kind === "pan") {
    extracted.ocr = { text: "SYNTHETIC DEMO DOCUMENT - NOT A REAL ID", aadhaarNumbers: kind === "aadhaar" ? ["000000000000"] : [],
      panNumbers: kind === "pan" ? ["DEMOX0000Z"] : [], dates: ["01/01/1990"] };
  }
  return { state: "done", risk, score, summary: summarise(risk, score, checks), checks, extracted, engineVersion: "demo-seed",
    completedAt: new At(uploadedAt + 20_000) };
}

// --- builder (pure: no Firebase) --------------------------------------------

// A Firestore Timestamp placeholder, converted when the record is written.
class At { constructor(ms) { this.ms = ms; } }

function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const pad = (value, width) => String(value).padStart(width, "0");
const ticketId = no => "DemoCase" + pad(no, 12);                       // 20 characters: also a valid /track reference
const documentId = (no, k) => "DemoDoc" + pad(no * 100 + k, 13);       // 20 characters
const requestId = (no, k) => "demo-reupload-request-" + pad(no, 4) + "-" + k;
const demoPhone = no => "+9100000" + pad(no, 5);

function reporterFor(no, spec) {
  const first = FIRST_NAMES[no % FIRST_NAMES.length];
  if (no === 30) return { type: "Government department or body", name: "Demo Welfare Office" };
  if (no % 5 === 2) return { type: "Community or Gram Sabha", name: first + " Sample Gram Sabha" };
  return { type: "Individual / private person", name: first + " Sample" };
}

function disputeFor(no, spec, ctx) {
  const reporter = reporterFor(no, spec);
  const otherName = spec.party === INDIVIDUAL ? FIRST_NAMES[(no + 17) % FIRST_NAMES.length] + " Example" : OFFICES[spec.party];
  const [district, lat, lon] = PLACES[spec.state][(ctx.placeCursor[spec.state] = (ctx.placeCursor[spec.state] ?? -1) + 1) % PLACES[spec.state].length];
  const contact = no % 7 === 2 ? ` You can reach me on +91 00000 ${pad(no, 5)}.` : no % 9 === 4 ? ` Email: demo.reporter${no}@example.test.`
    : no === 13 ? " Reference 0000 0000 0000." : "";
  const description = NARRATIVES[spec.dtype][no % 2].replace("{other}", otherName) + contact + SYNTHETIC_TAIL;
  const risk = spec.risk ?? (no % 6 === 0 ? "yes" : no % 3 === 0 ? "unknown" : "no");
  const evidence = no % 3 === 0 ? [] : no % 3 === 1 ? ["Gram Sabha resolution, demo ref " + no] : ["Khasra DEMO-" + no + "/1", "Photo set DEMO-" + no];
  const round = value => Math.round(value * 1e4) / 1e4;
  return { reporter, otherName, state: spec.state, district, dispute: {
    reporterName: reporter.name, reporterType: reporter.type, otherPartyName: otherName, otherPartyType: spec.party,
    disputeType: contract.disputeTypes[spec.dtype], state: spec.state, district, village: no % 11 === 0 ? "" : VILLAGES[no % VILLAGES.length],
    description, immediateRisk: risk, evidenceReferences: evidence,
    location: { latitude: round(lat + (ctx.rng() - 0.5) * 0.3), longitude: round(lon + (ctx.rng() - 0.5) * 0.3) },
  } };
}

function documentRecord(ctx, k, kind, profile, uploadedAt) {
  const { no, rng } = ctx;
  const pdf = PDF_KINDS.includes(kind) || (kind === "aadhaar" && no % 2 === 1);
  const idType = KINDS.get(kind).idNumber, id = documentId(no, k);
  const idNumberFull = idType === "aadhaar" ? "000000000000" : idType === "pan" ? "DEMOX0000Z" : null;
  const stitched = kind === "selfie";
  return { id, kind, data: {
    submissionId: ctx.submissionId, phoneHash: ctx.phoneHash, addressHash: ctx.addressHash, ticketId: ctx.ticketId, status: "attached",
    kind, side: KINDS.get(kind).side === "other_party" ? "other_party" : "reporter",
    fileName: `demo-${kind.replace(/_/g, "-")}-sample.${pdf ? "pdf" : "jpg"}`, contentType: pdf ? "application/pdf" : "image/jpeg",
    sizeBytes: Math.round(pdf ? 90_000 + rng() * 900_000 : 180_000 + rng() * 1_800_000),
    // No file exists, so nothing here can collide with a real upload in the duplicate checks.
    sha256: sha256("demo-document:" + id), dhash: null, dhashBands: [], idNumberHash: null, reporterNameNorm: null,
    width: pdf ? null : stitched ? 1440 : 1600, height: pdf ? null : stitched ? 480 : 1000, pageCount: pdf ? 1 + Math.floor(rng() * 3) : null,
    idNumberFull, idNumberMasked: idNumberFull ? (idType === "aadhaar" ? "XXXX XXXX 0000" : "DEMOX****Z") : null,
    uploadedAt: new At(uploadedAt), expiresAt: null, purgeAt: null, storage: {},
    screening: screeningFor(ctx, kind, profile, pdf, uploadedAt), review: null, demo: true,
  } };
}

function buildCase(spec, no, ctx) {
  const { now, rng } = ctx;
  const id = ticketId(no), createdAt = Math.round(now - spec.age * DAY);
  const ackDueAt = createdAt + ACK_MS, resolveDueAt = createdAt + RESOLVE_MS;
  const verified = !spec.guest, phone = verified ? spec.phone || demoPhone(no) : "";
  const { reporter, dispute } = (() => { const built = disputeFor(no, spec, { ...ctx, rng }); return { reporter: built.reporter, dispute: built.dispute, built }; })();
  const caseType = contract.documents.caseTypeByPartyType[spec.party];
  const phoneHash = verified ? hashId(phone) : null, addressHash = sha256("demo-address:" + no);

  // Documents (metadata only).
  const set = DOC_SETS[no], documents = [];
  const docCtx = { no, rng, submissionId: "demo-submission-" + pad(no, 4) + "-00000000", phoneHash, addressHash, ticketId: id,
    reporterName: reporter.name, state: dispute.state, district: dispute.district };
  if (set) {
    [...contract.documents.caseTypes[caseType].required, ...set.extras].forEach((kind, index) => {
      documents.push(documentRecord(docCtx, index + 1, kind, set.profiles[kind] ?? "clean", createdAt - (5 + index * 3) * MINUTE));
    });
  }
  const current = kind => documents.find(doc => doc.kind === kind && !doc.data.supersededBy);

  // Staff steps and the system's escalation ticks, in time order.
  const staffer = (index) => spec.assignee ? ACCOUNTS[spec.assignee] : ACCOUNTS[(no + index) % 2 ? "officer" : "officer2"];
  const steps = [];
  FLOWS[spec.flow].forEach(([type, day, status], index) => {
    if (type === "assign" && !spec.assignee) return;
    steps.push({ type, status, at: createdAt + Math.round(day * DAY), actor: type === "assign" && spec.assignee === "officer2" ? ACCOUNTS.admin : staffer(index) });
  });
  const at = item => item.ago !== undefined ? Math.round(now - item.ago * DAY) : createdAt + Math.round(item.d * DAY);
  (set?.reviews ?? []).forEach((review, index) => steps.push({ type: "review", ...review, at: at(review), index: index + 1, actor: staffer(index + 3) }));
  if (set?.replace) steps.push({ type: "replace", ...set.replace, at: at(set.replace), index: 1 });
  const staffSteps = steps.filter(step => step.type !== "replace").length;
  for (const due of [ackDueAt, resolveDueAt]) {
    const tick = due + Math.round(rng() * 55 * MINUTE);
    if (tick <= now) steps.push({ type: "tick", at: tick });
  }
  steps.push({ type: "tick", at: now });
  steps.sort((a, b) => a.at - b.at);

  const state = { status: "open", firstActionAt: null, ackDueAt, resolveDueAt, overdue: null, overdueSince: null, escalated: false, revision: 0,
    noteCount: 0, assigned: null, assignedAt: null, closedAt: null, statusLabel: null, updatedAt: createdAt, lastUpdatedBy: null, openRequests: 0 };
  const events = [], notes = [], requests = [];
  let seq = 0;
  const push = (tag, data, when, eventId) => events.push({ id: eventId ?? `demo-event-${pad(no, 4)}-${pad(++seq, 3)}-${tag}`, data: { ...data, at: new At(when) } });
  const settle = (when, actor) => {
    const next = computeOverdue(state, when);
    if (next === state.overdue) return;
    Object.assign(state, { overdue: next, overdueSince: next ? when : null, escalated: true });
    // A staff action that moves the state records it with their name (tickets/handlers.ts staffActionEffects).
    push("escalation", { type: "escalation", overdue: next, ...(actor ? stamp(actor) : {}) }, when + (actor ? 1 : 0));
  };
  const act = (step, mutate) => {
    state.revision++;
    if (state.firstActionAt == null) state.firstActionAt = step.at;
    mutate();
    state.updatedAt = step.at; state.lastUpdatedBy = step.actor.uid;
    settle(step.at, step.actor);
  };
  steps.forEach((step, index) => {
    const variant = (list) => list[(no + index) % list.length];
    if (step.type === "tick") return settle(step.at, null);
    if (step.type === "assign" || step.type === "unassign") {
      const to = step.type === "assign" ? ACCOUNTS[spec.assignee] : null, from = state.assigned;
      return act(step, () => {
        state.assigned = to; state.assignedAt = to ? step.at : null;
        push("assignment", { type: "assignment", from: from ? from.uid : null, to: to ? to.uid : null, toEmail: to ? to.email : null,
          toName: to ? to.displayName : null,
          reason: !to ? "Handing the case back for reassignment." : step.actor.uid !== to.uid ? "Assigned for field follow-up." : no % 2 ? "Taking this case." : null,
          ...stamp(step.actor), revision: state.revision }, step.at);
      });
    }
    if (step.type === "status") {
      const before = state.status, reopened = TERMINAL.includes(before) && !TERMINAL.includes(step.status);
      return act(step, () => {
        state.status = step.status; state.statusLabel = STATUS_LABELS[step.status];
        if (TERMINAL.includes(step.status)) state.closedAt = TERMINAL.includes(before) && state.closedAt != null ? state.closedAt : step.at;
        else state.closedAt = null;
        push("status", { kind: "status", before, after: step.status, reason: variant(REASONS[reopened ? "reopened" : step.status]),
          ...stamp(step.actor), revision: state.revision }, step.at);
      });
    }
    if (step.type === "note") {
      return act(step, () => {
        const noteId = `demo-event-${pad(no, 4)}-${pad(++seq, 3)}-note`;
        notes.push({ id: noteId, data: { text: variant(NOTES), ...stamp(step.actor), at: new At(step.at) } });
        state.noteCount++;
        push("note", { kind: "note", noteId, ...stamp(step.actor), revision: state.revision }, step.at, noteId);
      });
    }
    if (step.type === "review") {
      const doc = current(step.kind);
      return act(step, () => {
        const reviewId = step.request ? requestId(no, step.index) : `demo-document-review-${pad(no, 4)}-${pad(step.index, 2)}`;
        // A re-upload review carries its request's expiry (ms), as reviewCaseDocument stores it.
        doc.data.review = { decision: step.decision, reason: step.reason, by: step.actor.uid, byEmail: step.actor.email, ...stamp(step.actor), at: new At(step.at),
          ...(step.request ? { expiresAt: step.at + REPLACEMENT_TTL_MS } : {}) };
        push("review", { type: "document_review", documentId: doc.id, kind: doc.kind, decision: step.decision, reason: step.reason,
          actorUid: step.actor.uid, ...stamp(step.actor), revision: state.revision }, step.at, reviewId);
        if (step.request) {
          requests.push({ id: reviewId, data: { ticketId: id, documentId: doc.id, kind: doc.kind, requestedAt: step.at, expiresAt: step.at + REPLACEMENT_TTL_MS,
            fulfilledAt: null, fulfilledDocumentId: null, demo: true } });
          state.openRequests++;
        }
      });
    }
    if (step.type === "replace") {
      // The reporter's answer: not a staff action, so no revision, first action or escalation change.
      const request = requests.find(candidate => candidate.data.kind === step.kind && candidate.data.fulfilledAt === null), old = current(step.kind);
      const fresh = documentRecord(docCtx, 50 + step.index, step.kind, "clean", step.at);
      Object.assign(fresh.data, { replaces: old.id, supersededBy: null, replacementFor: request.id });
      old.data.supersededBy = fresh.id;
      documents.push(fresh);
      Object.assign(request.data, { fulfilledAt: step.at, fulfilledDocumentId: fresh.id });
      state.openRequests--; state.updatedAt = step.at;
      push("replaced", { type: "document_replaced", kind: step.kind, requestId: request.id, documentId: fresh.id }, step.at, "replaced_" + request.id);
    }
  });

  const live = documents.filter(doc => !doc.data.supersededBy).map(doc => ({ kind: doc.kind, risk: doc.data.screening.risk }));
  // A closed case's files carry its retention deadline; a reopened case's do not.
  for (const doc of documents) doc.data.purgeAt = state.closedAt != null ? state.closedAt + RETENTION_MS : null;
  const assigned = state.assigned;
  const ticket = {
    waFrom: phone, notificationPhone: phone, reporterUid: verified ? "phone-" + phoneHash : "guest-" + hashId("demo-address:" + no),
    phoneVerified: verified, whatsappUpdates: false,
    consent: { version: contract.version, acceptedAt: new At(createdAt), whatsappUpdates: false },
    subject: (dispute.disputeType + " — " + dispute.reporterName + " vs " + dispute.otherPartyName).slice(0, 160),
    messages: [], status: state.status, source: "web-dispute-form", dispute,
    revision: state.revision, noteCount: state.noteCount, createdAt: new At(createdAt), updatedAt: new At(state.updatedAt),
    ...(set ? { documents: documentSummary(caseType, live) } : {}),
    ackDueAt, resolveDueAt, firstActionAt: state.firstActionAt, overdue: state.overdue,
    assignedTo: assigned ? assigned.uid : null, assignedEmail: assigned ? assigned.email : null,
    assignedName: assigned ? assigned.displayName : null, assignedAt: state.assignedAt, openDocumentRequests: state.openRequests,
    ...(state.statusLabel ? { statusLabel: state.statusLabel } : {}), ...(state.lastUpdatedBy ? { lastUpdatedBy: state.lastUpdatedBy } : {}),
    ...(state.closedAt != null ? { closedAt: state.closedAt } : {}), ...(state.escalated ? { overdueSince: state.overdueSince } : {}),
    demo: true,
  };
  return { no, id, ticket, events, notes, documents, requests, staffSteps, createdAt, caseType };
}

function build(now) {
  const ctx = { now, rng: mulberry32(20261029), placeCursor: {} };
  return CASES.map((spec, index) => buildCase(spec, index + 1, ctx));
}

// Converts At markers to Timestamps and refuses undefined (Firestore would too).
function materialize(value, Timestamp, trail = "") {
  if (value === undefined) throw new Error("undefined field at " + trail);
  if (value instanceof At) return Timestamp.fromMillis(value.ms);
  if (Array.isArray(value)) return value.map((item, index) => materialize(item, Timestamp, trail + "[" + index + "]"));
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, materialize(item, Timestamp, trail + "." + key)]));
  }
  return value;
}

// Consistency checks against the rules the callables enforce; throws on the first mismatch.
function verify(cases, now) {
  const stub = { fromMillis: ms => ({ ms }) };
  const seen = new Set();
  const unique = (kind, key) => { assert(!seen.has(kind + key), `duplicate ${kind} ${key}`); seen.add(kind + key); };
  const ms = value => (value instanceof At ? value.ms : value);
  for (const c of cases) {
    const t = c.ticket, d = t.dispute, label = "case " + c.no;
    unique("ticket", c.id);
    assert.match(c.id, /^[A-Za-z0-9]{20}$/, label + " id");
    assert(contract.districts[d.state]?.includes(d.district), label + " district belongs to the state");
    assert(d.location.latitude > 6 && d.location.latitude < 38 && d.location.longitude > 68 && d.location.longitude < 98, label + " location is in India");
    assert(d.description.length >= contract.descriptionMin && d.description.length <= contract.descriptionMax, label + " description length");
    assert(d.reporterName.length >= 2 && d.otherPartyName.length >= 2 && d.reporterName.length <= contract.nameMax, label + " names");
    assert(contract.reporterTypes.includes(d.reporterType) && contract.partyTypes.includes(d.otherPartyType) && contract.disputeTypes.includes(d.disputeType), label + " types");
    assert.equal(t.ackDueAt, ms(t.createdAt) + ACK_MS); assert.equal(t.resolveDueAt, ms(t.createdAt) + RESOLVE_MS);
    assert.equal(t.revision, c.staffSteps, label + " revision counts staff writes");
    assert.equal(t.noteCount, c.notes.length, label + " noteCount");
    assert.equal(t.overdue, computeOverdue(t, now), label + " overdue matches the escalation rules");
    if (TERMINAL.includes(t.status)) {
      assert.equal(t.overdue, null, label + " closed case is not overdue");
      assert(typeof t.closedAt === "number" && now - t.closedAt < RETENTION_MS - 3 * DAY, label + " closed within the retention window");
    } else assert(!("closedAt" in t), label + " open case has no closedAt");
    assert.equal(t.firstActionAt === null, c.staffSteps === 0, label + " firstActionAt");
    assert(t.assignedTo === null ? t.assignedEmail === null && t.assignedAt === null : typeof t.assignedAt === "number", label + " assignment fields");
    assert(t.phoneVerified ? t.waFrom !== "" && t.reporterUid.startsWith("phone-") : t.waFrom === "" && t.reporterUid.startsWith("guest-"), label + " reporter identity");
    for (const event of c.events) {
      unique("event" + c.id, event.id);
      assert.match(event.id, /^[a-zA-Z0-9_-]{20,80}$/, label + " event id");
      assert(event.data.at.ms >= ms(t.createdAt) && event.data.at.ms <= now, label + " event time");
    }
    for (const note of c.notes) assert(c.events.some(event => event.id === note.id && event.data.kind === "note"), label + " note has its event");
    for (const doc of c.documents) { unique("document", doc.id); assert.match(doc.id, /^[A-Za-z0-9]{20}$/, label + " document id"); }
    const live = c.documents.filter(doc => !doc.data.supersededBy);
    if (t.documents) assert.deepEqual(t.documents, documentSummary(c.caseType, live.map(doc => ({ kind: doc.kind, risk: doc.data.screening.risk }))), label + " document summary");
    else assert.equal(c.documents.length, 0, label + " legacy case has no documents");
    const open = c.requests.filter(request => request.data.fulfilledAt === null);
    assert.equal(t.openDocumentRequests, open.length, label + " openDocumentRequests");
    for (const request of c.requests) {
      assert.match(request.id, /^[a-zA-Z0-9_-]{20,80}$/); assert(request.data.expiresAt > now, label + " request is still live");
      assert.equal(request.data.expiresAt, request.data.requestedAt + REPLACEMENT_TTL_MS);
    }
    if (c.requests.length) assert(t.phoneVerified, label + " re-upload requests need a verified reporter");
    for (const item of [t, ...c.events.map(e => e.data), ...c.notes.map(n => n.data), ...c.documents.map(doc => doc.data), ...c.requests.map(r => r.data)]) materialize(item, stub);
  }
  assert.equal(cases.length, 40);
}

function summarize(cases, now) {
  const tally = (list, key) => list.reduce((out, item) => ((out[key(item)] = (out[key(item)] ?? 0) + 1), out), {});
  const open = cases.filter(c => !TERMINAL.includes(c.ticket.status));
  const aged = days => open.filter(c => c.createdAt < now - days * DAY).length;
  const docs = cases.flatMap(c => c.documents);
  return {
    cases: cases.length, byStatus: tally(cases, c => c.ticket.status), overdue: tally(cases, c => c.ticket.overdue ?? "none"),
    assignedTo: tally(cases, c => c.ticket.assignedName ?? "unassigned"),
    ageing: { d0_7: open.length - aged(7), d8_30: aged(7) - aged(30), d31_90: aged(30) - aged(90), d90p: aged(90) },
    byCaseType: tally(cases, c => c.caseType), guests: cases.filter(c => !c.ticket.phoneVerified).length,
    states: tally(cases, c => c.ticket.dispute.state),
    events: cases.reduce((n, c) => n + c.events.length, 0), notes: cases.reduce((n, c) => n + c.notes.length, 0),
    documents: docs.length, flagged: docs.filter(doc => isFlagged(doc.data.screening.risk)).length,
    reviewed: docs.filter(doc => doc.data.review).length, openRequests: cases.reduce((n, c) => n + c.ticket.openDocumentRequests, 0),
    requests: cases.reduce((n, c) => n + c.requests.length, 0),
  };
}

// --- Firestore and Auth ------------------------------------------------------

const BATCH = 400;
async function removeAll(db, refs) {
  for (let i = 0; i < refs.length; i += BATCH) {
    const batch = db.batch();
    refs.slice(i, i + BATCH).forEach(ref => batch.delete(ref));
    await batch.commit();
  }
  return refs.length;
}

// Every `demo: true` ticket (with its events and notes), case document and
// re-upload request, the demo officer entries and the demo Auth accounts.
async function purge(db, auth) {
  const demo = name => db.collection(name).where("demo", "==", true);
  const counts = { tickets: 0, documents: 0, requests: 0, accounts: 0 };
  for (;;) {
    const page = await demo("tickets").limit(100).get();
    if (page.empty) break;
    const refs = [];
    for (const doc of page.docs) {
      for (const sub of ["events", "notes"]) refs.push(...await doc.ref.collection(sub).listDocuments());
      // Records a demo session added to a demo case through the callables (a replacement upload, a new request) carry no demo flag.
      for (const [name, key] of [["caseDocuments", "documents"], ["documentRequests", "requests"]]) {
        const linked = await db.collection(name).where("ticketId", "==", doc.id).select().get();
        refs.push(...linked.docs.map(item => item.ref));
        counts[key] += linked.size;
      }
      refs.push(doc.ref);
    }
    await removeAll(db, refs);
    counts.tickets += page.size;
  }
  for (const [name, key] of [["caseDocuments", "documents"], ["documentRequests", "requests"]]) {
    for (;;) {
      const page = await demo(name).limit(300).get();
      if (page.empty) break;
      counts[key] += await removeAll(db, page.docs.map(doc => doc.ref));
    }
  }
  const officers = new Map();
  (await demo("officers").limit(100).get()).docs.forEach(doc => officers.set(doc.id, doc.ref));
  for (const account of Object.values(ACCOUNTS)) officers.set(account.uid, db.collection("officers").doc(account.uid));
  await removeAll(db, [...officers.values()]);
  for (const account of Object.values(ACCOUNTS)) {
    // By uid and by email: a hand-made account with a demo address would block creating the demo one.
    for (const lookup of [() => auth.getUser(account.uid), () => auth.getUserByEmail(account.email)]) {
      try {
        const user = await lookup();
        await auth.deleteUser(user.uid);
        counts.accounts++;
      } catch (err) {
        if (err.code !== "auth/user-not-found") throw err;
      }
    }
  }
  // Insights are cached for 10 minutes; a stale snapshot would hide the change.
  await db.collection("insightsCache").doc("current").delete();
  return counts;
}

async function createAccounts(admin, db, auth, now) {
  for (const account of Object.values(ACCOUNTS)) {
    await auth.createUser({ uid: account.uid, email: account.email, password: account.password, displayName: account.displayName, emailVerified: true });
    // Fields read by tickets/authorization.ts, officers.ts and the staff session.
    await db.collection("officers").doc(account.uid).set({ email: account.email, role: account.role, access: account.access,
      displayName: account.displayName, addedAt: admin.firestore.Timestamp.fromMillis(now), demo: true });
  }
}

async function writeCase(admin, db, c) {
  const { Timestamp } = admin.firestore, batch = db.batch(), ref = db.collection("tickets").doc(c.id);
  const put = (target, data) => batch.set(target, materialize(data, Timestamp));
  put(ref, c.ticket);
  c.events.forEach(event => put(ref.collection("events").doc(event.id), event.data));
  c.notes.forEach(note => put(ref.collection("notes").doc(note.id), note.data));
  c.documents.forEach(doc => put(db.collection("caseDocuments").doc(doc.id), doc.data));
  c.requests.forEach(request => put(db.collection("documentRequests").doc(request.id), request.data));
  await batch.commit();
}

async function main() {
  const now = Date.now();
  if (DRY_RUN) {
    const cases = build(now);
    verify(cases, now);
    console.log("seed-demo dry run: data built and checked, nothing written.");
    console.log(JSON.stringify(summarize(cases, now), null, 2));
    return;
  }
  const { projectId, emulated } = resolveTarget();
  // Built and checked before anything is touched, so a mistake cannot leave half a purge behind.
  const cases = PURGE ? [] : build(now);
  if (!PURGE) verify(cases, now);
  const admin = require("firebase-admin");
  admin.initializeApp({ projectId });
  const db = admin.firestore(), auth = admin.auth();
  console.log(`seed-demo: project ${projectId} (${emulated ? "emulators" : "demo project"})`);
  try {
    const removed = await purge(db, auth);
    console.log(`Removed previous demo data: ${removed.tickets} cases, ${removed.documents} documents, ${removed.requests} requests, ${removed.accounts} accounts.`);
    if (PURGE) return;
    await createAccounts(admin, db, auth, now);
    for (const c of cases) await writeCase(admin, db, c);
    await db.collection("insightsCache").doc("current").delete();
    const total = summarize(cases, now);
    console.log(`Seeded ${total.cases} cases, ${total.events} events, ${total.notes} notes, ${total.documents} documents, ${total.requests} re-upload requests.`);
    console.log("Demo accounts (sign in at /login; passwords are defined in this script, for the emulators only):");
    for (const account of Object.values(ACCOUNTS)) console.log(`  ${account.email}  (${account.access})`);
    console.log("Reporter phones for /track re-upload: +12025550101, +12025550102, +12025550103 (browser harness only).");
  } finally {
    await admin.app().delete();
  }
}

main().catch(err => {
  // Message only: nothing here should echo record contents.
  console.error("seed-demo failed:", err && err.code ? err.code + " " : "", err && err.message ? err.message : err);
  process.exit(1);
});
