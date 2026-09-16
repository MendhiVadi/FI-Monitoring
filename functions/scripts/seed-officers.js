/**
 * One-off admin script: creates (or updates) real Firebase Auth accounts for
 * FRA officers and adds each to the `officers/{uid}` Firestore allow-list
 * that firestore.rules requires for reading ticket data.
 *
 * "Access denied — your account is not on the FRA officer allow-list" on
 * /officer-portal means exactly one thing: the signed-in uid has no
 * `officers/{uid}` document. This script is the only supported way to add one.
 *
 * It has to run with Admin SDK credentials — it is NOT something the client
 * app can do (client writes to `officers` are blocked by rules on purpose, so
 * only this trusted, human-run path can grant officer access).
 *
 * Usage:
 *   Authenticate first, either with
 *     gcloud auth application-default login
 *   or by pointing GOOGLE_APPLICATION_CREDENTIALS at a service account key
 *   (Firebase console -> Project Settings -> Service Accounts).
 *
 *   Grant one specific account (the usual case — use the email and Account ID
 *   shown on the "Access denied" screen):
 *     node functions/scripts/seed-officers.js you@example.com "SomePassword1!" "Divisional Forest Officer (DFO)"
 *
 *   An existing account keeps its current password; omit the password to
 *   allow-list an account that already exists:
 *     node functions/scripts/seed-officers.js you@example.com
 *
 *   Seed the default demo roster instead:
 *     node functions/scripts/seed-officers.js --defaults
 */

const admin = require("firebase-admin");

// Demo roster, used only with --defaults. Change these passwords before using
// them anywhere beyond a local demo.
const DEFAULT_OFFICERS = [
  { email: "officer@forestwatch.gov.in", password: "CHANGE_ME_1!", role: "Divisional Forest Officer (DFO)" },
  { email: "sdlc.rayagada@forestwatch.gov.in", password: "CHANGE_ME_2!", role: "SDLC Committee Officer" },
  { email: "tribal.desk@forestwatch.gov.in", password: "CHANGE_ME_3!", role: "Tribal Welfare Officer" },
];

function parseArgs(argv) {
  if (argv.includes("--defaults")) return DEFAULT_OFFICERS;

  const [email, password, role] = argv.filter((a) => !a.startsWith("--"));
  if (!email) {
    console.error(
      "Usage: node functions/scripts/seed-officers.js <email> [password] [role]\n" +
        "   or: node functions/scripts/seed-officers.js --defaults"
    );
    process.exit(1);
  }
  return [{ email, password, role: role || "FRA Officer" }];
}

function resolveProjectId() {
  const fromEnv =
    process.env.GOOGLE_CLOUD_PROJECT ||
    process.env.GCLOUD_PROJECT ||
    process.env.FIREBASE_PROJECT;
  if (fromEnv) return fromEnv;
  try {
    const rc = require("path").join(__dirname, "..", "..", ".firebaserc");
    return JSON.parse(require("fs").readFileSync(rc, "utf8")).projects.default;
  } catch {
    console.error("Could not determine the Firebase project. Set GOOGLE_CLOUD_PROJECT.");
    process.exit(1);
  }
}

async function main() {
  const officers = parseArgs(process.argv.slice(2));

  // Application-default credentials from `gcloud auth application-default
  // login` carry no project, so resolve it explicitly from .firebaserc (with
  // the usual env vars taking precedence) rather than letting the Admin SDK
  // fall through to the GCE metadata server, which does not exist locally.
  admin.initializeApp({
    credential: admin.credential.applicationDefault(),
    projectId: resolveProjectId(),
  });
  const auth = admin.auth();
  const db = admin.firestore();

  for (const officer of officers) {
    let user;
    try {
      user = await auth.getUserByEmail(officer.email);
      console.log(`Existing account: ${officer.email} (${user.uid})`);
    } catch {
      if (!officer.password) {
        console.error(
          `No account exists for ${officer.email}. Re-run with a password to create one.`
        );
        process.exitCode = 1;
        continue;
      }
      user = await auth.createUser({ email: officer.email, password: officer.password, emailVerified: true });
      console.log(`Created account: ${officer.email} (${user.uid})`);
    }

    // merge:true so re-running never clobbers a role or notes an admin has
    // since edited by hand in the console.
    await db.doc(`officers/${user.uid}`).set(
      {
        email: officer.email,
        role: officer.role,
        addedAt: admin.firestore.FieldValue.serverTimestamp(),
      },
      { merge: true }
    );
    console.log(`  -> added to officers allow-list as "${officer.role}"`);
  }

  console.log("Done. Sign out and sign back in at /login to pick up the new access.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
