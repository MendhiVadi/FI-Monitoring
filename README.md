# 🌲 Forest Watch
### *Every claim. Every acre. Every anomaly — seen.*

**Forest Watch** is an AI-augmented decision-support platform built to bring
order, speed, and accountability to the implementation of India's **Forest
Rights Act (FRA)** — a law meant to secure land rights for millions of forest
communities, but one whose progress is buried across fragmented state
records, paper trails, and disconnected offices.

We put it all on one screen.

---

## ✨ Why Forest Watch

FRA claims today are tracked the way they were tracked twenty years ago:
scattered spreadsheets, siloed departments, and no single source of truth.
Delays go unnoticed. Mismatched land records go unflagged. Communities wait
years for answers nobody can give them.

Forest Watch turns that into a live, explorable, judge-this-in-thirty-seconds
system:

- 🌍 **A scroll-driven globe-to-India experience** — zoom from the planet, to
  the subcontinent, to a single district, in one fluid motion.
- 🗺️ **A WebGIS-style claims map**, districts colour-coded by FRA claim
  status, ready to drill into.
- 🚨 **An anomaly layer** that automatically flags delayed claims and
  mismatched land records — with a plain-language, AI-assisted explanation of
  *why* a case was flagged, not just that it was.
- 📊 **A decision-support dashboard** summarizing state-wise progress and
  pointing an official straight at where to investigate next.
- 📱 **A no-login citizen reporting flow** — anyone can raise a land dispute
  from a phone, no form-filling, no bureaucracy.
- 🔔 **Live WhatsApp status notifications** — the moment a reported ticket's
  status changes, the reporter is messaged automatically, in real time,
  straight from our Cloud Functions backend.
- 🔐 **A hardened officer portal** — CAPTCHA-verified, Firebase-Auth-gated,
  server-side allow-listed, built so that only verified FRA officers ever see
  a citizen's raw dispute data.

This isn't a mockup of a monitoring system. It's a working one.

---

## 🧠 How it thinks

Forest Watch treats AI as an *explainer*, not an oracle. Anomalies are
surfaced through **deterministic, testable rules** — a claim delayed past
threshold, a land record that doesn't reconcile — and only *then* does an
AI layer put that evidence into language a human can act on in seconds. No
hallucinated facts. No black-box verdicts. Just fast, defensible answers to
"why is this flagged?"

---

## 🛠️ What's under the hood

| Layer | Stack |
|---|---|
| Frontend | React 19 + TypeScript + Vite, React Three Fiber (the globe), GSAP scroll choreography |
| Maps | Leaflet, OpenStreetMap land-use overlays, Bhuvan/NRSC WMS integration |
| Backend | Firebase Cloud Functions (Node 20), Firestore |
| Messaging | WhatsApp Cloud API — automated ticket-status notifications |
| Auth | Firebase Auth with a server-side officer allow-list enforced in Firestore security rules |
| Mobile | Capacitor-wrapped Android build |

---

## 📱 Also on Android

Forest Watch isn't just a website — it's shipped as a native-feeling Android
app via Capacitor, so field workers and officers can carry the same map,
ticket feed, and reporting flow in their pocket, no browser required.

---

## 🔐 Security, taken seriously from day one

This isn't bolted-on security — it shaped how the system was built:

- **Fail-closed officer access** — the officer portal isn't just
  login-gated, it's allow-list gated. A signed-in account with no matching
  `officers/{uid}` Firestore record is refused, and if the allow-list itself
  can't be read, access fails closed rather than open.
- **Server-enforced, not just client-enforced** — every access rule (who can
  read an officer record, who can write a ticket) is duplicated in Firestore
  security rules, so the real gate is on the server — the frontend check is
  only ever for UX, never the actual line of defense.
- **Officer accounts can't be self-granted** — `officers/{uid}` documents can
  only ever be written by a trusted Admin SDK script, never by a client. No
  amount of poking the frontend can turn a regular account into a staff one.
- **CAPTCHA-verified staff login** — a canvas-rendered, per-session CAPTCHA
  gate sits in front of every officer authentication attempt.
- **HMAC-verified inbound webhooks** — WhatsApp webhook payloads are verified
  with a timing-safe SHA-256 HMAC comparison against the app secret before
  being trusted, closing off payload-spoofing.
- **Per-reporter rate limiting** — dispute submissions are capped per phone
  number in a rolling 24-hour window via a Firestore transaction, so one
  number can't flood the tickets dashboard.
- **Tickets are read-only from the client** — every ticket is written only
  by trusted Cloud Functions using the Admin SDK; a client can read but can
  never write or tamper with a ticket directly.
- **Secrets never touch source control** — WhatsApp and Firebase credentials
  are held in Firebase Secret Manager, injected at runtime, never hardcoded
  or committed.

---

## 🚧 Roadmap — what's next

We're building toward a full closed-loop grievance system. Two pieces are
designed and scoped, not yet live in this build:

- **A ₹5 refundable verification deposit** on dispute submissions — a small,
  fully-refunded token payment designed purely to filter out frivolous or
  spam complaints, without putting a real cost on genuine reporters.
- **An AI adjudication assistant** for officers — a model that reviews both
  sides of a dispute and flags likely authenticity issues in submitted
  documents, so staff spend their time deciding, not searching.

Both are near-term roadmap items, not shipped features — we'd rather tell you
that straight than have a demo click land on nothing.

---

## 📎 A note on the data

Mock FRA claim records are used for demo purposes and are always clearly
labeled as synthetic. Real district boundaries and land-use base layers come
from OpenStreetMap and Bhuvan/NRSC/ISRO — see in-app attribution and the
Dataset & Sources page for full provenance.

---

*Built for the FRA monitoring hackathon brief. Because forest rights
shouldn't depend on which office answers the phone first.*
