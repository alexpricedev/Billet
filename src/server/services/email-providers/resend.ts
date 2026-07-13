// Requires: bun add resend
import { Resend } from "resend";
import type { EmailAddress, EmailMessage, EmailProvider } from "../email";

/**
 * Render an address as an RFC 5322 header value. Display names containing
 * specials (comma, quote, angle brackets, etc.) must be quoted or the From
 * header is malformed — e.g. a FROM_NAME of `Acme, Inc.` splits into two
 * addresses without this.
 */
const formatAddress = (addr: EmailAddress): string => {
  if (!addr.name) {
    return addr.email;
  }
  const needsQuoting = /[(),.:;<>@[\]"]/.test(addr.name);
  const name = needsQuoting
    ? `"${addr.name.replace(/([\\"])/g, "\\$1")}"`
    : addr.name;
  return `${name} <${addr.email}>`;
};

export class ResendProvider implements EmailProvider {
  private client: Resend;

  constructor(apiKey: string) {
    if (!apiKey) {
      throw new Error("Resend API key is required");
    }
    this.client = new Resend(apiKey);
  }

  async send(message: EmailMessage): Promise<void> {
    const response = await this.client.emails.send({
      from: formatAddress(message.from),
      to: formatAddress(message.to),
      subject: message.subject,
      html: message.html,
      text: message.text,
      ...(message.replyTo ? { replyTo: formatAddress(message.replyTo) } : {}),
      ...(message.headers ? { headers: message.headers } : {}),
    });

    if (response.error) {
      throw new Error(`Resend API error: ${response.error.message}`);
    }
  }
}
