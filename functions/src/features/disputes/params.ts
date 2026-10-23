import { defineBoolean } from "firebase-functions/params";

// One declaration shared by every intake callable, so uploads and the final
// submission can never disagree about whether a phone proof is required.
export const otpRequired = defineBoolean("DISPUTE_OTP_REQUIRED", { default: true });
