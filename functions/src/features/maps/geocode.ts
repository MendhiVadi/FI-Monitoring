import { createHash, randomUUID } from "node:crypto";
import { onRequest } from "firebase-functions/v2/https";
import { db } from "../../platform/firebase";

export async function reserveGeocodeSlot(now = Date.now(), owner = randomUUID()) {
  const ref = db.collection("mapServiceLimits").doc("nominatim");
  return db.runTransaction(async tx => {
    const previous = (await tx.get(ref)).data();
    if ((previous?.nextAllowedAt ?? 0) > now || (previous?.leaseUntil ?? 0) > now) return false;
    tx.set(ref, { nextAllowedAt: now + 1100, leaseUntil: now + 60_000, owner });
    return true;
  });
}
export async function releaseGeocodeSlot(owner: string, now = Date.now()) {
  const ref = db.collection("mapServiceLimits").doc("nominatim");
  await db.runTransaction(async tx => {
    if ((await tx.get(ref)).data()?.owner !== owner) return;
    tx.update(ref, { leaseUntil: 0, nextAllowedAt: now + 1100 });
  });
}
// All website/app instances share this reservation. No public Nominatim calls
// are made by the Vercel process or browser.
export const geocodePlace = onRequest({ invoker: "public", timeoutSeconds: 30 }, async (request, response) => {
  if (request.method !== "GET") { response.set("Allow", "GET").sendStatus(405); return; }
  const text = typeof request.query.q === "string" ? request.query.q.trim().replace(/\s+/g, " ") : "";
  if (text.length < 2 || text.length > 120) { response.status(400).json({ error: "Enter a place name." }); return; }
  const key = createHash("sha256").update(text.toLowerCase()).digest("hex");
  const ref = db.collection("geocodeCache").doc(key);
  const owner = randomUUID();
  let reserved = false;
  try {
    const cached = (await ref.get()).data();
    if (cached && cached.expiresAt > Date.now()) { response.json(cached.place); return; }
    reserved = await reserveGeocodeSlot(Date.now(), owner);
    if (!reserved) {
      response.set("Retry-After", "2").status(429).json({ error: "Place search is busy. Please retry in a moment." }); return;
    }
    const url = new URL("https://nominatim.openstreetmap.org/search");
    url.search = new URLSearchParams({ q: text, countrycodes: "in", limit: "1", format: "jsonv2" }).toString();
    const upstream = await fetch(url, { headers: { "User-Agent": "ForestWatch/1.0 (https://forest-watch-eight.vercel.app)" }, signal: AbortSignal.timeout(12_000) });
    if (!upstream.ok) { response.status(503).json({ error: "Place search is temporarily unavailable." }); return; }
    const places = await upstream.json() as { lat: string; lon: string; display_name: string }[];
    const result = Array.isArray(places) ? places[0] : undefined;
    const place = result && Number.isFinite(Number(result.lat)) && Number.isFinite(Number(result.lon)) ?
      { latitude: Number(result.lat), longitude: Number(result.lon), displayName: result.display_name } : {};
    await ref.set({ place, expiresAt: Date.now() + 86_400_000 });
    response.set("Cache-Control", "public, max-age=300").json(place);
  } catch { response.status(503).json({ error: "Place search is temporarily unavailable." }); }
  finally { if (reserved) await releaseGeocodeSlot(owner).catch(() => undefined); }
});
