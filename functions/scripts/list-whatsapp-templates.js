/**
 * Lists approved WhatsApp message templates for your business account, so you
 * can see the exact name + language code Meta has on file. Read-only.
 *
 * Usage (same shell where WHATSAPP_ACCESS_TOKEN is already set):
 *   node scripts/list-whatsapp-templates.js
 */
const GRAPH_API_VERSION = "v23.0";
const accessToken = process.env.WHATSAPP_ACCESS_TOKEN;
const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID || "1204619962744881";

if (!accessToken) {
  console.error("Set WHATSAPP_ACCESS_TOKEN in your shell first.");
  process.exit(1);
}

async function main() {
  console.log(`Using phone number id: ${phoneNumberId}`);
  const phoneRes = await fetch(
    `https://graph.facebook.com/${GRAPH_API_VERSION}/${phoneNumberId}?fields=id,display_phone_number,verified_name`,
    { headers: { Authorization: `Bearer ${accessToken}` } }
  );
  const phoneBody = await phoneRes.json();
  console.log("Phone number lookup:", JSON.stringify(phoneBody));

  const wabaFieldRes = await fetch(
    `https://graph.facebook.com/${GRAPH_API_VERSION}/${phoneNumberId}?fields=whatsapp_business_account`,
    { headers: { Authorization: `Bearer ${accessToken}` } }
  );
  const wabaFieldBody = await wabaFieldRes.json();
  console.log("WABA field lookup:", JSON.stringify(wabaFieldBody));
  if (wabaFieldBody.whatsapp_business_account?.id) {
    process.env.WHATSAPP_WABA_ID = wabaFieldBody.whatsapp_business_account.id;
  }

  const debugRes = await fetch(
    `https://graph.facebook.com/${GRAPH_API_VERSION}/debug_token?input_token=${accessToken}&access_token=${accessToken}`,
    { headers: { Authorization: `Bearer ${accessToken}` } }
  );
  const debugBody = await debugRes.json();
  console.log("Token debug:", JSON.stringify(debugBody, null, 2));

  let wabaId = process.env.WHATSAPP_WABA_ID;
  if (!wabaId) {
    const bizRes = await fetch(
      `https://graph.facebook.com/${GRAPH_API_VERSION}/me/businesses?fields=id,name`,
      { headers: { Authorization: `Bearer ${accessToken}` } }
    );
    const bizBody = await bizRes.json();
    console.log("Businesses:", JSON.stringify(bizBody));
    for (const biz of bizBody.data ?? []) {
      const ownedRes = await fetch(
        `https://graph.facebook.com/${GRAPH_API_VERSION}/${biz.id}/owned_whatsapp_business_accounts`,
        { headers: { Authorization: `Bearer ${accessToken}` } }
      );
      const ownedBody = await ownedRes.json();
      console.log(`  owned_whatsapp_business_accounts for ${biz.name} (${biz.id}):`, JSON.stringify(ownedBody));
      if (!wabaId && ownedBody.data?.[0]?.id) wabaId = ownedBody.data[0].id;

      const clientRes = await fetch(
        `https://graph.facebook.com/${GRAPH_API_VERSION}/${biz.id}/client_whatsapp_business_accounts`,
        { headers: { Authorization: `Bearer ${accessToken}` } }
      );
      const clientBody = await clientRes.json();
      console.log(`  client_whatsapp_business_accounts for ${biz.name} (${biz.id}):`, JSON.stringify(clientBody));
      if (!wabaId && clientBody.data?.[0]?.id) wabaId = clientBody.data[0].id;
    }
  }
  if (!wabaId) {
    console.log("Could not auto-discover the WABA id. Set WHATSAPP_WABA_ID env var manually (find it in Meta Business Manager -> WhatsApp Manager -> your account -> top of page).");
    return;
  }
  console.log(`WhatsApp Business Account: ${wabaId}`);

  const templatesRes = await fetch(
    `https://graph.facebook.com/${GRAPH_API_VERSION}/${wabaId}/message_templates?fields=name,status,language,category&limit=100`,
    { headers: { Authorization: `Bearer ${accessToken}` } }
  );
  const templatesBody = await templatesRes.json();
  if (!templatesRes.ok) {
    console.error("Could not list templates:", JSON.stringify(templatesBody));
    process.exit(1);
  }
  console.log(`Found ${templatesBody.data?.length ?? 0} templates:`);
  for (const t of templatesBody.data ?? []) {
    console.log(`  - ${t.name} | lang=${t.language} | status=${t.status} | category=${t.category}`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
