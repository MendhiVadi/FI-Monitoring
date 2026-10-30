import { onCall, HttpsError } from "firebase-functions/v2/https";
import { db } from "../../platform/firebase";
import { appCheckOption } from "../../platform/appCheck";
import { requireOfficer } from "../tickets/authorization";
import { cachedInsights } from "./service";

// Registry-wide counts for the insights page (viewer+). Aggregates only, so
// read-only staff see the same figures as everyone else.
export const getInsights = onCall({ ...appCheckOption(), invoker: "public", maxInstances: 5, timeoutSeconds: 60 }, async (request) => {
  await requireOfficer(request.auth, "viewer");
  try {
    return await cachedInsights(db, Date.now());
  } catch (err) {
    console.error("Insights failed", { code: (err as { code?: unknown })?.code ?? "unknown" });
    throw new HttpsError("unavailable", "Insights are unavailable right now. Try again shortly.");
  }
});
