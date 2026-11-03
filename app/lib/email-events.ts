/** Maps provider email events to what we record. Only provider-confirmed events change delivery status. */
export interface EmailEffect { deliveryStatus: "delivered" | "bounced" | "complained" | "delayed"; setDeliveredAt: boolean; suppress: boolean }

export function mapEmailEvent(type: string): EmailEffect | null {
  switch (type) {
    case "email.delivered": return { deliveryStatus: "delivered", setDeliveredAt: true, suppress: false };
    case "email.bounced": return { deliveryStatus: "bounced", setDeliveredAt: false, suppress: true };
    case "email.complained": return { deliveryStatus: "complained", setDeliveredAt: false, suppress: true };
    case "email.delivery_delayed": return { deliveryStatus: "delayed", setDeliveredAt: false, suppress: false };
    default: return null; // e.g. email.sent, email.opened: ignored
  }
}
