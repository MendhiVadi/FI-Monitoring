// Opt-in local browser harness: actual callable handlers + Auth/Firestore/Storage emulators.
// It never sends WhatsApp messages or touches a real Firebase project.
//
// Optional: SYNTHETIC_UIDAI_PEM holds a self-generated test public key or
// certificate (PEM text, or a path to a PEM file) so the Aadhaar QR signature
// check can run against synthetic QR payloads. Never a real UIDAI certificate.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const { createPublicKey, X509Certificate } = require('node:crypto');
assert.equal(process.env.FIRESTORE_EMULATOR_HOST, '127.0.0.1:8080');
assert.equal(process.env.FIREBASE_AUTH_EMULATOR_HOST, '127.0.0.1:9099');
assert.equal(process.env.FIREBASE_STORAGE_EMULATOR_HOST, '127.0.0.1:9199');
process.env.GCLOUD_PROJECT = 'demo-forestwatch';
process.env.GOOGLE_CLOUD_PROJECT = 'demo-forestwatch';
process.env.FIREBASE_CONFIG = JSON.stringify({ projectId: 'demo-forestwatch', storageBucket: 'demo-forestwatch.appspot.com' });
process.env.DISPUTE_OTP_SECRET = 'synthetic-browser-secret';
process.env.DISPUTE_OTP_REQUIRED = 'true';
process.env.WHATSAPP_ACCESS_TOKEN = 'synthetic-never-valid';
process.env.WHATSAPP_PHONE_NUMBER_ID = 'synthetic-never-valid';
// `.run()` skips App Check anyway; stated so the params never read as enforced.
process.env.APP_CHECK_ENFORCE = 'false';
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

const spki = pem => createPublicKey(pem).export({ type: 'spki', format: 'der' });
function syntheticUidaiPem() {
  const raw = process.env.SYNTHETIC_UIDAI_PEM;
  if (!raw) return null;
  const text = raw.includes('-----BEGIN') ? raw.replace(/\\n/g, '\n') : fs.readFileSync(raw, 'utf8');
  assert.match(text, /-----BEGIN (CERTIFICATE|PUBLIC KEY)-----/, 'SYNTHETIC_UIDAI_PEM must be a PEM public key or certificate');
  const key = spki(text);
  // Refuse the owner's configured UIDAI certificate and anything naming UIDAI:
  // the harness only ever verifies payloads signed with a self-generated key.
  const configured = path.join(__dirname, '..', 'assets', 'uidai', 'uidai-secure-qr.pem');
  if (fs.existsSync(configured)) {
    let real = null;
    try { real = spki(fs.readFileSync(configured, 'utf8')); } catch { real = null; }
    if (real && real.equals(key)) throw new Error('SYNTHETIC_UIDAI_PEM must be a synthetic test key, not the UIDAI certificate');
  }
  if (/-----BEGIN CERTIFICATE-----/.test(text)) {
    const certificate = new X509Certificate(text);
    if (/UIDAI|Unique Identification/i.test(certificate.subject + '\n' + certificate.issuer)) {
      throw new Error('SYNTHETIC_UIDAI_PEM must be a synthetic test key, not a UIDAI certificate');
    }
  }
  return text;
}
// Swapped on the cached module before any handler runs: the upload callables
// load the engine with require() and ask it for the certificate on first use.
const uidaiPem = syntheticUidaiPem();
if (uidaiPem) {
  const screening = require('../lib/features/documents/screening/index.js');
  screening.loadUidaiCertificate = () => uidaiPem;
  assert.equal(screening.loadUidaiCertificate(), uidaiPem);
}

const admin = require('firebase-admin');
const handlers = require('../lib/index.js');
const { db } = require('../lib/platform/firebase.js');
const contract = require('../lib/platform/contracts/dispute.json');
// Base64 of a 6 MiB file plus the JSON envelope; every other call stays small.
const UPLOAD_CALLABLES = ['uploadDisputeDocument', 'uploadReplacementDocument'];
const UPLOAD_BODY_LIMIT = 10 * 1024 * 1024, BODY_LIMIT = 65536;
const allowed = ['requestDisputeOtp', 'verifyDisputeOtp', 'submitDispute', 'listTickets', 'updateTicketStatus', 'addTicketNote',
  ...UPLOAD_CALLABLES, 'removeDisputeDocument', 'getCaseDocumentFile', 'reviewCaseDocument',
  'getCaseStatus', 'assignTicket', 'listOfficers', 'getInsights', 'getMaskedCase'];
async function readBody(req, limit) {
  const declared = Number(req.headers['content-length']);
  const tooLarge = () => Object.assign(new Error('Request body is too large for this call.'), { code: 'invalid-argument', httpStatus: 413 });
  if (Number.isFinite(declared) && declared > limit) throw tooLarge();
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > limit) throw tooLarge();
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString('utf8');
}
async function start() {
  const missing = allowed.filter(name => typeof handlers[name]?.run !== 'function');
  if (missing.length) console.warn('Not in this build (rebuild functions to enable): ' + missing.join(', '));
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
    if (!allowed.includes(name) || typeof handlers[name]?.run !== 'function' || req.method !== 'POST') { res.writeHead(404); res.end('{}'); return; }
    try {
      const body = await readBody(req, UPLOAD_CALLABLES.includes(name) ? UPLOAD_BODY_LIMIT : BODY_LIMIT);
      const bearer = (req.headers.authorization || '').replace(/^Bearer /, '');
      const token = bearer ? await admin.auth().verifyIdToken(bearer) : null;
      const auth = token ? { uid: token.uid, token } : undefined;
      const result = await handlers[name].run({ auth, data: JSON.parse(body).data, rawRequest: { ip: '192.0.2.50', headers: req.headers } });
      res.end(JSON.stringify({ result }));
    } catch (error) {
      // HttpsError codes are strings ("invalid-argument"); a rejected ID token
      // is unauthenticated; anything else (a Firestore numeric code, a
      // TypeError) is reported as internal.
      const badToken = typeof error?.code === 'string' && error.code.startsWith('auth/');
      const known = !badToken && typeof error?.code === 'string' && /^[a-z-]+$/.test(error.code);
      if (!known && !badToken) console.error('Synthetic harness call failed', { callable: name, error: error?.name || 'unknown' });
      res.writeHead(error?.httpStatus || 400);
      res.end(JSON.stringify({ error: { status: badToken ? 'UNAUTHENTICATED' : known ? error.code.replaceAll('-', '_').toUpperCase() : 'INTERNAL',
        message: badToken ? 'Sign in again.' : known ? error.message : 'Synthetic harness failure' } }));
    }
  });
  server.listen(5001, '127.0.0.1', () => console.log('Synthetic browser gateway ready on 127.0.0.1:5001. No external messages.' +
    (uidaiPem ? ' Synthetic UIDAI test key loaded.' : '')));
}
start().catch(error => { console.error(error.message); process.exitCode = 1; });
