import { defineInt } from "firebase-functions/params";

// Per-IP-bucket abuse limits (Wave 2 spec section 7). Defaults are friendlier
// to carrier-grade NAT, where many citizens share one public address.
// Per-phone limits are unchanged and live with their features.
//
// Exports (param name -> default):
//   otpSendsPerIpHour       OTP_SENDS_PER_IP_HOUR        30  OTP sends per IP bucket per hour
//   reportsPerIpDay         REPORTS_PER_IP_DAY           20  submitted reports per IP bucket per day
//   uploadsPerIpDay         UPLOADS_PER_IP_DAY           150 uploaded files per IP bucket per day
//   uploadBytesPerIpDayMib  UPLOAD_BYTES_PER_IP_DAY_MIB  300 uploaded MiB per IP bucket per day
//   statusLookupsPerIpHour  STATUS_LOOKUPS_PER_IP_HOUR   30  public status lookups per IP bucket per hour
//
// Read with `.value()` inside a handler (never at module load).
export const otpSendsPerIpHour = defineInt("OTP_SENDS_PER_IP_HOUR", { default: 30 });
export const reportsPerIpDay = defineInt("REPORTS_PER_IP_DAY", { default: 20 });
export const uploadsPerIpDay = defineInt("UPLOADS_PER_IP_DAY", { default: 150 });
export const uploadBytesPerIpDayMib = defineInt("UPLOAD_BYTES_PER_IP_DAY_MIB", { default: 300 });
export const statusLookupsPerIpHour = defineInt("STATUS_LOOKUPS_PER_IP_HOUR", { default: 30 });
