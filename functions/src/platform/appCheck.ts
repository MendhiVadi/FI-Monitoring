import { defineBoolean } from "firebase-functions/params";

// App Check enforcement switch for every public callable (Wave 2 spec).
//
// Usage: `onCall({ ...appCheckOption(), maxInstances: 10 }, handler)`.
//
// `enforceAppCheck` only accepts a plain boolean (not a param expression), so
// the effective value is read from process.env at module load. The Firebase
// CLI loads `functions/.env` (and `.env.<project>`) into the environment while
// it discovers functions, so setting `APP_CHECK_ENFORCE=true` there turns
// enforcement on at the next deploy. The param below declares the same name so
// the deployed runtime carries a consistent value. Default: off.
export const appCheckEnforce = defineBoolean("APP_CHECK_ENFORCE", { default: false });

const ENFORCE_AT_LOAD = process.env.APP_CHECK_ENFORCE === "true";

export function appCheckOption(): { enforceAppCheck: boolean } {
  return { enforceAppCheck: ENFORCE_AT_LOAD };
}
