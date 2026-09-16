import { onRequest } from "firebase-functions/v2/https";
import { createHmac, timingSafeEqual } from "node:crypto";
import { WHATSAPP_WEBHOOK_VERIFY_TOKEN, WHATSAPP_APP_SECRET, DISPUTE_OTP_SECRET } from "../../platform/secrets";
import { recordReceipt, stopNotifications } from "./receipts";

export function hasValidMetaSignature(rawBody: Buffer | undefined, header: unknown, appSecret: string) {
  if (!rawBody || typeof header !== "string" || !header.startsWith("sha256=")) return false;
  const expected = Buffer.from("sha256=" + createHmac("sha256", appSecret).update(rawBody).digest("hex"));
  const received = Buffer.from(header);
  return received.length === expected.length && timingSafeEqual(received, expected);
}
export const whatsappWebhook = onRequest({ invoker: "public", region: "asia-south1", timeoutSeconds: 540,
  secrets: [WHATSAPP_WEBHOOK_VERIFY_TOKEN, WHATSAPP_APP_SECRET, DISPUTE_OTP_SECRET] }, async (request, response) => {
  if (request.method === "GET") {
    if (request.query["hub.mode"] === "subscribe" && request.query["hub.verify_token"] === WHATSAPP_WEBHOOK_VERIFY_TOKEN.value() &&
        typeof request.query["hub.challenge"] === "string") response.status(200).send(request.query["hub.challenge"]);
    else response.sendStatus(403);
    return;
  }
  if (request.method !== "POST") { response.set("Allow", "GET, POST").sendStatus(405); return; }
  if (!hasValidMetaSignature(request.rawBody, request.get("x-hub-signature-256"), WHATSAPP_APP_SECRET.value())) { response.sendStatus(403); return; }
  const entries = Array.isArray(request.body?.entry) ? request.body.entry : [];
  try {
    for (const entry of entries) for (const change of Array.isArray(entry?.changes) ? entry.changes : []) {
      for (const receipt of Array.isArray(change?.value?.statuses) ? change.value.statuses : []) await recordReceipt(receipt);
      for (const message of Array.isArray(change?.value?.messages) ? change.value.messages : []) {
        if (typeof message?.text?.body === "string" && /^(stop|unsubscribe)$/i.test(message.text.body.trim())) await stopNotifications(message.from, message.timestamp);
      }
    }
    response.sendStatus(200);
  } catch {
    console.error("WhatsApp receipt or preference storage failed");
    response.sendStatus(503);
  }
});
