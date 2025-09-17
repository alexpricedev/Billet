import type { EmailMessage, EmailProvider } from "../email";

export class ConsoleLogProvider implements EmailProvider {
  async send(message: EmailMessage): Promise<void> {
    const output = [
      "📧 EMAIL SEND (Console Provider)",
      "================================",
      `To: ${message.to.name ? `${message.to.name} <${message.to.email}>` : message.to.email}`,
      `From: ${message.from.name ? `${message.from.name} <${message.from.email}>` : message.from.email}`,
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

    console.log(output);
  }
}
