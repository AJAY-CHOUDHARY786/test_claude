import { env, logger } from "../config.server.ts";

export interface EmailMessage { to: string; from: string; replyTo?: string; subject: string; text: string; html: string; unsubscribeUrl: string }
export interface EmailProvider { readonly name: string; send(msg: EmailMessage): Promise<{ id: string | null }> }

/** Development default: logs that an email would be sent, without the recipient address or body. Sends nothing. */
class SinkProvider implements EmailProvider {
  readonly name = "sink";
  async send(msg: EmailMessage) {
    logger.info("EMAIL SINK: message not sent", { subject: msg.subject });
    return { id: null };
  }
}

class ResendProvider implements EmailProvider {
  readonly name = "resend";
  async send(msg: EmailMessage) {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${env.email.resendApiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from: msg.from, to: [msg.to], subject: msg.subject, text: msg.text, html: msg.html, reply_to: msg.replyTo,
        headers: { "List-Unsubscribe": `<${msg.unsubscribeUrl}>`, "List-Unsubscribe-Post": "List-Unsubscribe=One-Click" },
      }),
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) throw new Error(`Email provider rejected the message (HTTP ${res.status})`);
    const json = (await res.json()) as { id?: string };
    return { id: json.id ?? null }; // "accepted by provider", not "delivered"
  }
}

export function createEmailProvider(): EmailProvider {
  return env.email.mode === "resend" ? new ResendProvider() : new SinkProvider();
}
