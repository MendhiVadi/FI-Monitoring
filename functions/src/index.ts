// Stable Firebase deployment surface. Keep exported names unchanged.
export { requestDisputeOtp, verifyDisputeOtp } from "./features/otp/handlers";
export { submitDispute } from "./features/disputes/handlers";
export { purgeExpiredOtps } from "./features/otp/cleanup";
export { whatsappWebhook } from "./features/whatsapp/webhook";
export { updateTicketStatus, addTicketNote } from "./features/tickets/handlers";
export { listTickets } from "./features/tickets/list";
export { notifyWhatsAppOnTicketUpdate } from "./features/whatsapp/notifications";
export { notifyWhatsAppOnTicketCreated } from "./features/whatsapp/created";

export { geocodePlace } from "./features/maps/geocode";
export { uploadDisputeDocument, removeDisputeDocument, getCaseDocumentFile, reviewCaseDocument } from "./features/documents/handlers";
export { purgeExpiredDocuments } from "./features/documents/cleanup";
