import type { EmailMessage, EmailProvider } from "../email";
import { log } from "../logger";

export class ConsoleLogProvider implements EmailProvider {
  async send(message: EmailMessage): Promise<void> {
    const output = [
      "📧 EMAIL SEND (Console Provider)",
      "================================",
      `To: ${message.to.name ? `${message.to.name} <${message.to.email}>` : message.to.email}`,
      `From: ${message.from.name ? `${message.from.name} <${message.from.email}>` : message.from.email}`,
      ...(message.replyTo
        ? [
            `Reply-To: ${message.replyTo.name ? `${message.replyTo.name} <${message.replyTo.email}>` : message.replyTo.email}`,
          ]
        : []),
      ...(message.headers
        ? [
            `Headers: ${Object.entries(message.headers)
              .map(([k, v]) => `${k}: ${v}`)
              .join(", ")}`,
          ]
        : []),
      `Subject: ${message.subject}`,
      "",
      "HTML Content:",
      "-------------",
      message.html,
      "",
      ...(message.text
        ? ["Text Content:", "-------------", message.text, ""]
        : []),
      "================================",
    ].join("\n");

    log.info("email", output);
  }
}
