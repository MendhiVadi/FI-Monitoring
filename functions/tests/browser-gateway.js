// Opt-in local browser harness: actual callable handlers + Auth/Firestore emulators.
// It never sends WhatsApp messages or touches a real Firebase project.
const assert = require('node:assert/strict');
const http = require('node:http');
assert.equal(process.env.FIRESTORE_EMULATOR_HOST, '127.0.0.1:8080');
assert.equal(process.env.FIREBASE_AUTH_EMULATOR_HOST, '127.0.0.1:9099');
process.env.GCLOUD_PROJECT = 'demo-forestwatch';
process.env.GOOGLE_CLOUD_PROJECT = 'demo-forestwatch';
process.env.FIREBASE_CONFIG = JSON.stringify({ projectId: 'demo-forestwatch' });
process.env.DISPUTE_OTP_SECRET = 'synthetic-browser-secret';
process.env.DISPUTE_OTP_REQUIRED = 'true';
process.env.WHATSAPP_ACCESS_TOKEN = 'synthetic-never-valid';
process.env.WHATSAPP_PHONE_NUMBER_ID = 'synthetic-never-valid';
const otps = new Map(), originalFetch = global.fetch;
global.fetch = async (url, options) => {
  const target = new URL(url);
  if (target.hostname === 'graph.facebook.com') {
    const payload = JSON.parse(options.body);
    if (!/^\+12025550\d{3}$/.test(payload.to)) throw new Error('Only synthetic test numbers allowed');
    if (payload.template.name === 'otp_code') otps.set(payload.to, payload.template.components[0].parameters[0].text);
    return Response.json({ messages: [{ id: 'synthetic-message-' + Date.now() }] });
  }
  if (!['127.0.0.1', 'localhost'].includes(target.hostname)) throw new Error('External requests are disabled in the browser harness');
  return originalFetch(url, options);
};
const admin = require('firebase-admin');
const handlers = require('../lib/index.js');
const { db } = require('../lib/platform/firebase.js');
const contract = require('../lib/platform/contracts/dispute.json');
const allowed = ['requestDisputeOtp', 'verifyDisputeOtp', 'submitDispute', 'listTickets', 'updateTicketStatus', 'addTicketNote'];
async function start() {
  let user;
  try { user = await admin.auth().getUserByEmail('staff@example.invalid'); }
  catch { user = await admin.auth().createUser({ uid: 'browser-officer', email: 'staff@example.invalid', password: 'SyntheticPass123!' }); }
  await db.collection('officers').doc(user.uid).set({ email: user.email });
  const batch = db.batch();
  for (let i = 0; i < 65; i++) batch.set(db.collection('tickets').doc('BROWSER-CASE-' + String(i + 1).padStart(8, '0')), {
    status: 'open', revision: 0, noteCount: 0, phoneVerified: true, whatsappUpdates: false, source: 'web-dispute-form',
    subject: 'Synthetic case ' + (i + 1), createdAt: admin.firestore.Timestamp.fromMillis(Date.now() - i * 86400000), updatedAt: admin.firestore.Timestamp.fromMillis(Date.now() - i * 1000),
    dispute: { reporterName: 'Synthetic reporter ' + (i + 1), otherPartyName: 'Synthetic opposing party', reporterType: contract.reporterTypes[0], otherPartyType: contract.partyTypes[0], disputeType: contract.disputeTypes[0], state: 'Maharashtra', district: 'Pune', description: 'Synthetic browser test. No eviction or violence reported.', location: { latitude: 18.52, longitude: 73.85 }, immediateRisk: 'no', evidenceReferences: [] },
  });
  await batch.commit();
  const server = http.createServer(async (req, res) => {
    const origin = req.headers.origin || '';
    if (/^http:\/\/(127\.0\.0\.1|localhost):\d+$/.test(origin)) res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Firebase-AppCheck');
    res.setHeader('Content-Type', 'application/json');
    if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }
    const url = new URL(req.url, 'http://127.0.0.1');
    if (url.pathname === '/_test/otp') { res.end(JSON.stringify({ code: otps.get(url.searchParams.get('phone')) || null })); return; }
    const name = url.pathname.split('/').at(-1);
    if (!allowed.includes(name) || req.method !== 'POST') { res.writeHead(404); res.end('{}'); return; }
    try {
      let body = '';
      for await (const chunk of req) { body += chunk; if (body.length > 65536) throw new Error('Body too large'); }
      const bearer = (req.headers.authorization || '').replace(/^Bearer /, '');
      const token = bearer ? await admin.auth().verifyIdToken(bearer) : null;
      const auth = token ? { uid: token.uid, token } : undefined;
      const result = await handlers[name].run({ auth, data: JSON.parse(body).data, rawRequest: { ip: '192.0.2.50' } });
      res.end(JSON.stringify({ result }));
    } catch (error) {
      res.writeHead(400);
      res.end(JSON.stringify({ error: { status: (error.code || 'internal').replaceAll('-', '_').toUpperCase(), message: error.message || 'Synthetic harness failure' } }));
    }
  });
  server.listen(5001, '127.0.0.1', () => console.log('Synthetic browser gateway ready on 127.0.0.1:5001. No external messages.'));
}
start().catch(error => { console.error(error.message); process.exitCode = 1; });
