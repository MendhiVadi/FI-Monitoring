// Stable Firebase deployment surface. Keep exported names unchanged.
export { requestDisputeOtp, verifyDisputeOtp } from "./features/otp/handlers";
export { submitDispute } from "./features/disputes/handlers";
export { purgeExpiredOtps } from "./features/otp/cleanup";
export { whatsappWebhook } from "./features/whatsapp/webhook";
export { updateTicketStatus, addTicketNote, assignTicket } from "./features/tickets/handlers";
export { listOfficers } from "./features/tickets/officers";
export { listTickets } from "./features/tickets/list";
export { notifyWhatsAppOnTicketUpdate } from "./features/whatsapp/notifications";
export { notifyWhatsAppOnTicketCreated } from "./features/whatsapp/created";

export { geocodePlace } from "./features/maps/geocode";
export { uploadDisputeDocument, removeDisputeDocument, getCaseDocumentFile, reviewCaseDocument } from "./features/documents/handlers";
export { purgeExpiredDocuments } from "./features/documents/cleanup";

// Wave 2: case access for read-only staff, service targets, insights and the
// public status lookup with document re-upload.
export { getMaskedCase } from "./features/cases/masked";
export { escalateOverdueCases } from "./features/cases/escalation";
export { getInsights } from "./features/insights/handlers";
export { getCaseStatus, uploadReplacementDocument } from "./features/status/handlers";
