/**
 * One-off admin script: creates (or updates) real Firebase Auth accounts for
 * FRA officers and adds each to the `officers/{uid}` Firestore allow-list
 * that firestore.rules now requires for reading ticket data.
 *
 * This has to run with Admin SDK credentials — it is NOT something the
 * client app can do (client writes to `officers` are blocked by rules on
 * purpose, so only this trusted, human-run path can grant officer access).
 *
 * Usage:
 *   1. Get a service account key for this Firebase project (Project
 *      Settings -> Service Accounts -> Generate new private key), save it
 *      locally, then:
 *
 *        GOOGLE_APPLICATION_CREDENTIALS=/path/to/serviceAccountKey.json \
 *          node functions/scripts/seed-officers.js
 *
 *      (or run `gcloud auth application-default login` first and omit the
 *      env var, if you prefer application-default credentials).
 *
 *   2. Edit OFFICERS below with real accounts before running — the
 *      passwords here are placeholders and MUST be changed (or omitted, see
 *      note below) before use in anything beyond a local demo.
 */

const admin = require("firebase-admin");

admin.initializeApp({ credential: admin.credential.applicationDefault() });

const OFFICERS = [
  { email: "officer@forestwatch.gov.in", password: "CHANGE_ME_1!", role: "Divisional Forest Officer (DFO)" },
  { email: "sdlc.rayagada@forestwatch.gov.in", password: "CHANGE_ME_2!", role: "SDLC Committee Officer" },
  { email: "tribal.desk@forestwatch.gov.in", password: "CHANGE_ME_3!", role: "Tribal Welfare Officer" },
];

async function main() {
  const auth = admin.auth();
  const db = admin.firestore();

  for (const officer of OFFICERS) {
    let user;
    try {
      user = await auth.getUserByEmail(officer.email);
      console.log(`Existing account: ${officer.email} (${user.uid})`);
    } catch {
      user = await auth.createUser({ email: officer.email, password: officer.password, emailVerified: true });
      console.log(`Created account: ${officer.email} (${user.uid})`);
    }

    await db.doc(`officers/${user.uid}`).set({
      email: officer.email,
      role: officer.role,
      addedAt: admin.firestore.FieldValue.serverTimestamp(),
    });
    console.log(`  -> added to officers allow-list`);
  }

  console.log("Done. Share each officer's password with them out-of-band and have them sign in at /login.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
