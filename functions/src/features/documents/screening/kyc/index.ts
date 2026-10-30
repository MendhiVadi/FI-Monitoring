import { mockKycProvider } from "./mock";

export type KycResult = "pass" | "warn" | "fail" | "unavailable";
export interface KycRequest {
  kind: string;
  idType: "aadhaar" | "pan";
  // Normalised, validated number typed by the reporter, or null.
  idNumber: string | null;
  name: string | null;
}
export interface KycVerdict { result: KycResult; detail: string }
export interface KycProvider {
  id: string;
  // Shown as the check's label, so staff always see which provider answered.
  label: string;
  // A provider that does not really verify anything must not move the risk score.
  scored: boolean;
  verify(request: KycRequest, deadline: number): Promise<KycVerdict>;
}

// KYC_PROVIDER: "none" (default; the check is omitted) or "mock". A real
// provider is added here; an unknown name falls back to none.
export function kycProvider(name: string | undefined = process.env.KYC_PROVIDER): KycProvider | null {
  switch ((name ?? "none").trim().toLowerCase()) {
    case "mock": return mockKycProvider;
    default: return null;
  }
}
