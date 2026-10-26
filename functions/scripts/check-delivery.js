const admin = require("firebase-admin");
admin.initializeApp({ credential: admin.credential.applicationDefault(), projectId: "tree-top-d61c6" });
const db = admin.firestore();

async function main() {
  const snap = await db.collection("whatsappDeliveries").get();
  console.log(`Total docs: ${snap.size}`);
  snap.forEach((doc) => console.log(doc.id, JSON.stringify(doc.data())));
}
main().catch((e) => { console.error(e); process.exit(1); });
