/**
 * Demo helper: creates a throwaway ticket for each configured phone number,
 * then updates its status, so real WhatsApp messages go out via the deployed
 * notifyWhatsAppOnTicketCreated (template "request_created") and
 * notifyWhatsAppOnTicketUpdate (template "status_update") functions.
 *
 * Needs: `gcloud auth application-default login` once, and billing/Secret
 * Manager already set up on the Firebase project (see docs/OTP_WHATSAPP_OPERATIONS.md).
 *
 * Usage:
 *   npm run demo:whatsapp
 *   npm run demo:whatsapp -- +919820166830 +918910063931
 */
const admin = require("firebase-admin");

const DEFAULT_NUMBERS = ["+919820166830", "+918910063931"];
const numbers = process.argv.slice(2).length ? process.argv.slice(2) : DEFAULT_NUMBERS;

for (const phone of numbers) {
  if (!/^\+[1-9]\d{6,14}$/.test(phone)) {
    console.error(`Invalid phone number "${phone}" - expected international format like +919820166830`);
    process.exit(1);
  }
}

admin.initializeApp({
  credential: admin.credential.applicationDefault(),
  projectId: "tree-top-d61c6",
});
const db = admin.firestore();

async function main() {
  for (const phone of numbers) {
    const ticketId = `demo-test-${phone.replace("+", "")}-${Date.now()}`;
    const ref = db.collection("tickets").doc(ticketId);

    console.log(`[${phone}] creating ${ticketId} (sends "request_created")...`);
    await ref.set({
      subject: "Demo WhatsApp template test",
      status: "open",
      notificationPhone: phone,
      whatsappUpdates: true,
      phoneVerified: true,
      revision: 0,
      noteCount: 0,
      source: "demo-script",
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    // Give the onCreate trigger a moment before the update fires onUpdate.
    await new Promise((r) => setTimeout(r, 5000));

    console.log(`[${phone}] updating ${ticketId} status -> investigating (sends "status_update")...`);
    await ref.update({
      status: "investigating",
      revision: 1,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    });
  }
  console.log("Done. Run `node scripts/check-delivery.js` to see send status in whatsappDeliveries.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
