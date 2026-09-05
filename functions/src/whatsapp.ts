// WhatsApp Cloud API helper: outbound template messaging.
// Docs: https://developers.facebook.com/docs/whatsapp/cloud-api

const GRAPH_API_VERSION = "v20.0";

export async function sendWhatsAppTemplate(
  to: string,
  name: string,
  parameters: string[],
  phoneNumberId: string,
  accessToken: string
): Promise<void> {
  const url = `https://graph.facebook.com/${GRAPH_API_VERSION}/${phoneNumberId}/messages`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      messaging_product: "whatsapp",
      to,
      type: "template",
      template: {
        name,
        language: { code: "en" },
        components: [{
          type: "body",
          parameters: parameters.map((text) => ({ type: "text", text })),
        }],
      },
    }),
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`WhatsApp template send failed (${res.status}): ${errText}`);
  }
}
