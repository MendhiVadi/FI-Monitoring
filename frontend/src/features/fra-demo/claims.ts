export type ClaimStatus = "pending" | "approved" | "rejected";
export interface DemoClaim {
  id: string; state: string; district: string; status: ClaimStatus; filedOn: string;
  claimedHa: number; recordedHa: number; evidenceRef: string;
}
export const REFERENCE_DATE = "2026-09-16";
export const DISTRICTS = [
  { district: "Mandla", state: "Madhya Pradesh" },
  { district: "Pune", state: "Maharashtra" },
  { district: "Koraput", state: "Odisha" },
];
// Entirely synthetic records: no names, parcel locations or actual filings.
export const DEMO_CLAIMS: DemoClaim[] = DISTRICTS.flatMap((place, districtIndex) =>
  Array.from({ length: 20 }, (_, i) => {
    const id = "DEMO-" + place.district.toUpperCase() + "-" + String(i + 1).padStart(3, "0");
    const days = 15 + i * 11 + districtIndex * 7;
    const claimedHa = Number((1 + i * 0.35).toFixed(2));
    return { ...place, id, status: i < 5 + districtIndex * 3 ? "approved" : i === 19 ? "rejected" : "pending",
      filedOn: new Date(Date.parse(REFERENCE_DATE + "T00:00:00Z") - days * 86_400_000).toISOString().slice(0, 10),
      claimedHa, recordedHa: Number((claimedHa * (i % 4 === 0 ? 0.65 : 1)).toFixed(2)), evidenceRef: id + "-LAND-RECORD" };
  }));
export interface Anomaly { kind: "delay" | "area" | "missing"; explanation: string; action: string }
export function claimAnomalies(claim: DemoClaim, asOf = REFERENCE_DATE): Anomaly[] {
  const anomalies: Anomaly[] = [];
  const filed = Date.parse(claim.filedOn + "T00:00:00Z"), now = Date.parse(asOf + "T00:00:00Z");
  const days = Math.floor((now - filed) / 86_400_000);
  if (!Number.isFinite(days) || days < 0) anomalies.push({ kind: "missing", explanation: "The filing date is missing, invalid or later than the review date.", action: "Check the filing register before assessing delay." });
  else if (claim.status === "pending" && days > 90) anomalies.push({ kind: "delay", explanation: "Pending for " + days + " days as of " + asOf + ", beyond the demonstration threshold of 90 days.", action: "Check the movement register and record the reason for delay." });
  if (!Number.isFinite(claim.recordedHa) || claim.recordedHa <= 0 || !Number.isFinite(claim.claimedHa) || claim.claimedHa <= 0) {
    anomalies.push({ kind: "missing", explanation: "A positive claimed or recorded area is missing.", action: "Obtain the referenced land record before comparing areas." });
  } else {
    const difference = Math.abs(claim.claimedHa - claim.recordedHa) / claim.recordedHa;
    if (difference > 0.20 + Number.EPSILON) anomalies.push({ kind: "area", explanation: "Claimed " + claim.claimedHa + " ha versus " + claim.recordedHa + " ha in " + claim.evidenceRef + "; difference " + Math.round(difference * 100) + "% of recorded area exceeds the demonstration threshold of 20%.", action: "Reconcile survey and claim references; verify the parcel with the claimant." });
  }
  return anomalies;
}
export function progress(claims: DemoClaim[], asOf = REFERENCE_DATE) {
  return { total: claims.length, approved: claims.filter(c => c.status === "approved").length,
    pending: claims.filter(c => c.status === "pending").length, rejected: claims.filter(c => c.status === "rejected").length,
    flagged: claims.filter(c => claimAnomalies(c, asOf).length > 0).length };
}
