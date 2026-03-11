// Requires: bun add resend
import { Resend } from "resend";
import type { EmailMessage, EmailProvider } from "../email";

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
      from: message.from.name
        ? `${message.from.name} <${message.from.email}>`
        : message.from.email,
      to: message.to.name
        ? `${message.to.name} <${message.to.email}>`
        : message.to.email,
      subject: message.subject,
      html: message.html,
      text: message.text,
    });

    if (response.error) {
      throw new Error(`Resend API error: ${response.error.message}`);
    }
  }
}
