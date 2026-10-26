/**
 * Sends WhatsApp template messages directly via the Graph API, bypassing
 * Firebase entirely - useful for testing a token/number before wiring up
 * the deployed functions. Mirrors functions/src/features/whatsapp/client.ts.
 *
 * Reads credentials from environment variables (never hardcode a token here):
 *   WHATSAPP_ACCESS_TOKEN      - your Meta access token
 *   WHATSAPP_PHONE_NUMBER_ID   - your WhatsApp Business phone number id
 *
 * Usage (PowerShell):
 *   $env:WHATSAPP_ACCESS_TOKEN = "paste-your-token-here"
 *   $env:WHATSAPP_PHONE_NUMBER_ID = "your-phone-number-id"
 *   node scripts/send-whatsapp-local.js request_created +919820166830 "Forest Rights dispute" "TICKET-1" "Open / Awaiting Review"
 *
 * Args: <templateName> <toPhoneE164> <bodyParam1> [bodyParam2 ...]
 */
const GRAPH_API_VERSION = "v23.0";

const [templateName, to, ...params] = process.argv.slice(2);
const accessToken = process.env.WHATSAPP_ACCESS_TOKEN;
const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID || "1204619962744881";

if (!templateName || !to) {
  console.error("Usage: node scripts/send-whatsapp-local.js <templateName> <toPhoneE164> [bodyParam1 bodyParam2 ...]");
  process.exit(1);
}
if (!accessToken || !phoneNumberId) {
  console.error("Set WHATSAPP_ACCESS_TOKEN and WHATSAPP_PHONE_NUMBER_ID in your shell first.");
  process.exit(1);
}
if (!/^\+[1-9]\d{6,14}$/.test(to)) {
  console.error(`Invalid phone number "${to}" - expected international format like +919820166830`);
  process.exit(1);
}

async function send() {
  const url = `https://graph.facebook.com/${GRAPH_API_VERSION}/${phoneNumberId}/messages`;
  const res = await fetch(url, {
    method: "POST",
    signal: AbortSignal.timeout(15000),
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      messaging_product: "whatsapp",
      to,
      type: "template",
      template: {
        name: templateName,
        language: { code: "en" },
        components: [{
          type: "body",
          parameters: params.map((text) => ({ type: "text", text })),
        }, ...(templateName === "otp_code" ? [{
          type: "button", sub_type: "url", index: "0",
          parameters: [{ type: "text", text: params[0] }],
        }] : [])],
      },
    }),
  });
  const body = await res.json();
  if (!res.ok) {
    console.error(`Send failed: HTTP ${res.status}`, JSON.stringify(body));
    process.exit(1);
  }
  console.log(`Sent. Message id: ${body.messages?.[0]?.id}`);
}

send().catch((err) => {
  console.error(err);
  process.exit(1);
});
