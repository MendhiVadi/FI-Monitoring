// WhatsApp Cloud API helper: outbound template messaging.
// Docs: https://developers.facebook.com/docs/whatsapp/cloud-api

const GRAPH_API_VERSION = "v23.0";

// Never include the provider's raw response: it can contain recipient data.
export class WhatsAppSendError extends Error {
  constructor(public readonly status: number, public readonly providerCode?: number) {
    super(`WhatsApp send failed (HTTP ${status}, code ${providerCode ?? "unknown"}).`);
  }
}

export async function sendWhatsAppTemplate(
  to: string,
  name: string,
  parameters: string[],
  phoneNumberId: string,
  accessToken: string,
  trackingId?: string
): Promise<string> {
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
      ...(trackingId ? { biz_opaque_callback_data: trackingId } : {}),
      to,
      type: "template",
      template: {
        name,
        language: { code: "en" },
        components: [{
          type: "body",
          parameters: parameters.map((text) => ({ type: "text", text })),
        }, ...(name === "otp_code" ? [{
          type: "button", sub_type: "url", index: "0",
          parameters: [{ type: "text", text: parameters[0] }],
        }] : [])],
      },
    }),
  });

  const body = await res.json() as { error?: { code?: number }; messages?: { id?: string }[] };
  if (!res.ok) throw new WhatsAppSendError(res.status, body.error?.code);
  const messageId = body.messages?.[0]?.id;
  if (!messageId) throw new Error("Provider acceptance could not be confirmed.");
  return messageId;
}
