import type { KycProvider } from "./index";

// For demos and tests: answers from the number alone, the same way every time,
// and never contacts anyone. A number ending in 0 plays "no record found".
export const mockKycProvider: KycProvider = {
  id: "mock",
  label: "Mock verification — not a real KYC check",
  scored: false,
  async verify(request) {
    if (!request.idNumber) return { result: "unavailable", detail: "No ID number was typed, so nothing was sent to the mock provider." };
    if (request.idNumber.endsWith("0")) {
      return { result: "warn", detail: "Mock provider: no record for this number (mock numbers ending in 0 are never found)." };
    }
    return { result: "pass", detail: request.name
      ? "Mock provider: record found; the name was accepted without comparison."
      : "Mock provider: record found; no name was given to compare." };
  },
};
