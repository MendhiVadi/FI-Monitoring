import { defineBoolean, type defineInt } from "firebase-functions/params";

// One declaration shared by every intake callable, so uploads and the final
// submission can never disagree about whether a phone proof is required.
export const otpRequired = defineBoolean("DISPUTE_OTP_REQUIRED", { default: true });

// An int param reads as 0 wherever the CLI has not written its default into
// the environment (tests, scripts, a bare emulator). A limit of 0 would refuse
// every caller, so anything but a positive integer falls back to the declared
// default. Read inside a handler, never at module load.
export function limitValue(param: ReturnType<typeof defineInt>): number {
  const value = param.value();
  if (Number.isInteger(value) && value > 0) return value;
  const fallback = param.options.default;
  return typeof fallback === "number" && Number.isInteger(fallback) && fallback > 0 ? fallback : 1;
}
