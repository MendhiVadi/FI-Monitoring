import { defineSecret } from "firebase-functions/params";

export const WHATSAPP_ACCESS_TOKEN = defineSecret("WHATSAPP_ACCESS_TOKEN");
export const WHATSAPP_PHONE_NUMBER_ID = defineSecret("WHATSAPP_PHONE_NUMBER_ID");
export const WHATSAPP_WEBHOOK_VERIFY_TOKEN = defineSecret("WHATSAPP_WEBHOOK_VERIFY_TOKEN");
export const DISPUTE_OTP_SECRET = defineSecret("DISPUTE_OTP_SECRET");

export const WHATSAPP_APP_SECRET = defineSecret("WHATSAPP_APP_SECRET");
