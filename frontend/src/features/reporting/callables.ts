// The Functions SDK is loaded on demand instead of being a static import of
// the report route: the phone step renders without waiting for it, and
// PhoneVerification warms it on mount so the first tap does not pay for it.
let sdk: Promise<[typeof import("firebase/functions"), typeof import("../../shared/firebase/functions")]> | undefined;

export function loadCallables() {
  sdk ??= Promise.all([import("firebase/functions"), import("../../shared/firebase/functions")]);
  // A failed chunk download must not poison every later attempt.
  sdk.catch(() => { sdk = undefined; });
  return sdk;
}

export async function callFunction<Req, Res>(name: string, data: Req): Promise<Res> {
  const [{ httpsCallable }, { functions }] = await loadCallables();
  const result = await httpsCallable<Req, Res>(functions, name)(data);
  return result.data;
}

/** Turn a callable failure into text safe to show: server HttpsError messages
 *  are written for reporters, but bare codes like "internal" are not. */
export function readableCallableError(err: unknown, fallback: string): string {
  const { code, message } = (err ?? {}) as { code?: string; message?: string };
  // The SDK uses the bare code as the message only when the server sent none
  // (client timeout, dropped connection, a 5xx/429 with no body). A server
  // HttpsError("unavailable" | "internal", "...") carries reporter-facing text
  // and must still be shown, e.g. "Could not send the WhatsApp verification code".
  const bare = !message || message === code?.replace(/^functions\//, "") || /^internal(\s*\[\d+\])?$/i.test(message);
  if (err instanceof TypeError || (bare && (code === "functions/unavailable" || code === "functions/deadline-exceeded"))) {
    return "The connection dropped or timed out. Check your network and try again.";
  }
  if (bare || !message) return fallback;
  return message.length > 300 ? fallback : message;
}
