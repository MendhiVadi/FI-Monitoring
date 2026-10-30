import { CustomProvider, initializeAppCheck, ReCaptchaEnterpriseProvider, type AppCheck } from "firebase/app-check";
import { app, useEmulators } from "./firebase";

// App Check proves a callable came from this site rather than a script, which
// is what the public endpoints (OTP, uploads, status lookups) need most. The
// server only enforces it once the owner sets APP_CHECK_ENFORCE=true, so a
// build without a site key, or a token that fails to load, still works.
const siteKey = (import.meta.env.VITE_APPCHECK_SITE_KEY || "").trim();
// Emulator only: a debug token registered in the Firebase console (or none, and
// the SDK generates one and prints it to the console for registration).
const debugToken = (import.meta.env.VITE_APPCHECK_DEBUG_TOKEN || "").trim();

let instance: AppCheck | null | undefined;

/** Starts App Check once, before the first callable. Imported by ./functions so
 *  the SDK (and the reCAPTCHA script) load only on routes that call Functions. */
export function ensureAppCheck(): AppCheck | null {
  if (instance !== undefined) return instance;
  instance = null;
  if (!siteKey && !(useEmulators && debugToken)) return null;
  try {
    if (useEmulators) {
      // Debug mode replaces the provider's attestation with the debug token.
      // A custom provider, because reCAPTCHA would still load its script for a
      // demo project whose key cannot work.
      (globalThis as { FIREBASE_APPCHECK_DEBUG_TOKEN?: string | boolean }).FIREBASE_APPCHECK_DEBUG_TOKEN = debugToken || true;
      instance = initializeAppCheck(app, {
        provider: new CustomProvider({ getToken: () => Promise.reject(new Error("App Check debug mode only")) }),
        isTokenAutoRefreshEnabled: true,
      });
    } else {
      instance = initializeAppCheck(app, { provider: new ReCaptchaEnterpriseProvider(siteKey), isTokenAutoRefreshEnabled: true });
    }
  } catch (err) {
    // Callables still run without a token while enforcement is off.
    console.error("App Check could not start", (err as { code?: string })?.code ?? "unknown");
  }
  return instance;
}
