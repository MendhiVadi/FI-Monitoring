import * as admin from "firebase-admin";
import { hammingDistance, NEAR_DUPLICATE_DISTANCE } from "./rules";
import { nameMatchScore } from "./screening/idNumbers";

export interface DuplicateQuery {
  sha256: string; dhash: string | null; dhashBands: string[]; idNumberHash: string | null; reporterNameNorm: string | null;
}
const CANDIDATES = 200;
// Same threshold as the engine's name check; either direction counts, so a
// middle name or initial on one side ("asha rao" / "asha s rao") still matches.
const SAME_NAME = 0.75;
const sameName = (a: string, b: string) => nameMatchScore(a, b) >= SAME_NAME || nameMatchScore(b, a) >= SAME_NAME;

// Cross-case lookups for the screening engine. Documents of the same
// submission are the reporter's own re-uploads, so they never count.
export async function findDuplicateDocuments(db: admin.firestore.Firestore, submissionId: string, q: DuplicateQuery) {
  const collection = db.collection("caseDocuments");
  const bands = q.dhash ? q.dhashBands.filter(band => typeof band === "string").slice(0, 30) : [];
  const [exact, near, sameId] = await Promise.all([
    collection.where("sha256", "==", q.sha256).select("submissionId").limit(50).get(),
    bands.length ? collection.where("dhashBands", "array-contains-any", bands).select("submissionId", "dhash", "sha256").limit(CANDIDATES).get() : null,
    q.idNumberHash ? collection.where("idNumberHash", "==", q.idNumberHash).select("submissionId", "reporterNameNorm").limit(50).get() : null,
  ]);
  const other = (snapshot: admin.firestore.QueryDocumentSnapshot) => snapshot.get("submissionId") !== submissionId;
  return {
    exactMatches: exact.docs.filter(other).length,
    // Sharing a band only nominates a candidate; the full distance confirms it.
    nearMatches: (near?.docs ?? []).filter(d => other(d) && d.get("sha256") !== q.sha256 &&
      hammingDistance(String(d.get("dhash") ?? ""), q.dhash!) <= NEAR_DUPLICATE_DISTANCE).length,
    sameIdDifferentName: q.reporterNameNorm ? (sameId?.docs ?? []).filter(d => {
      const name = d.get("reporterNameNorm");
      return other(d) && typeof name === "string" && name !== "" && !sameName(name, q.reporterNameNorm!);
    }).length : 0,
  };
}
