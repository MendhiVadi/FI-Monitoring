/** Send one correctly-shaped test for every active WhatsApp template. */
const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID;
const accessToken = process.env.WHATSAPP_ACCESS_TOKEN;
const to = (process.argv[2] || "").replace(/\D/g, "");
const requestedNames = new Set(
  (process.env.WHATSAPP_TEMPLATE_NAMES || "")
    .split(",")
    .map((name) => name.trim())
    .filter(Boolean),
);

if (!phoneNumberId || !accessToken || !to) {
  console.error("Usage: set WHATSAPP_PHONE_NUMBER_ID and WHATSAPP_ACCESS_TOKEN, then pass a test phone number.");
  process.exit(1);
}

const tests = [
  ["task_assigned", "en", ["Review FRA dispute FW-TEST-001", "06 Sep 2026"]],
  ["payment_confirmation", "en", ["INR 0 (template test only)", "FW-TEST-002"]],
  ["schedule_update", "en", ["FRA field inspection", "11:00 AM IST", "06 Sep 2026"]],
  ["appointment_reminder", "en", ["FRA field inspection", "Rayagada District Office", "06 Sep 2026", "11:00 AM IST"]],
  ["appointment_confirmation", "en", ["FRA field inspection", "06 Sep 2026", "Rayagada District Office", "11:00 AM IST"]],
  ["action_required", "en", ["Forest Rights dispute", "FW-TEST-006", "Upload the Gram Sabha resolution", "06 Sep 2026"]],
  ["request_completed", "en", ["Forest Rights dispute", "FW-TEST-007", "05 Sep 2026"]],
  ["status_update", "en", ["Forest Rights dispute", "FW-TEST-008", "Under Investigation"]],
  ["request_created", "en", ["Forest Rights dispute", "FW-TEST-009", "Open / Awaiting Review"]],
  ["otp_code", "en", ["482913"]],
  ["hello_world", "en_US", []],
];

async function send([name, language, values]) {
  const components = values.length ? [{
    type: "body",
    parameters: values.map((text) => ({ type: "text", text })),
  }] : undefined;
  const response = await fetch(`https://graph.facebook.com/v20.0/${phoneNumberId}/messages`, {
    method: "POST",
    headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      messaging_product: "whatsapp",
      to,
      type: "template",
      template: { name, language: { code: language }, ...(components ? { components } : {}) },
    }),
  });
  const body = await response.json();
  return { name, ok: response.ok, status: response.status, messageId: body.messages?.[0]?.id, error: body.error?.message };
}

(async () => {
  const results = [];
  const selectedTests = requestedNames.size
    ? tests.filter(([name]) => requestedNames.has(name))
    : tests;
  for (const test of selectedTests) results.push(await send(test));
  for (const result of results) console.log(JSON.stringify(result));
  if (results.some((result) => !result.ok)) process.exitCode = 1;
})();
