import prisma from "../db.server.ts";
import { mapEmailEvent } from "../lib/email-events.ts";
import { suppressEmail } from "./requests.server.ts";

/** Records what the email provider confirmed about a message. Bounces and spam complaints also stop future emails to that address. */
export async function applyEmailEvent(type: string, emailId: string | undefined) {
  const effect = mapEmailEvent(type);
  if (!effect || !emailId) return;
  const req = await prisma.reviewRequest.findFirst({ where: { providerMessageId: emailId }, select: { id: true, shopId: true, recipientEmail: true } });
  if (!req) return;
  await prisma.reviewRequest.updateMany({ where: { id: req.id, shopId: req.shopId }, data: { deliveryStatus: effect.deliveryStatus, ...(effect.setDeliveredAt ? { deliveredAt: new Date() } : {}) } });
  if (effect.suppress && req.recipientEmail) await suppressEmail(req.shopId, req.recipientEmail, effect.deliveryStatus);
}
