import { beforeEach, describe, expect, test } from "bun:test";
import {
  type EmailMessage,
  type EmailProvider,
  EmailService,
  getEmailService,
  type MagicLinkEmailData,
  registerEmailProvider,
  setEmailService,
} from "./email";

class MockEmailProvider implements EmailProvider {
  public sentMessages: EmailMessage[] = [];

  async send(message: EmailMessage): Promise<void> {
    this.sentMessages.push(message);
  }

  reset() {
    this.sentMessages = [];
  }
}

describe("Email Service", () => {
  let mockProvider: MockEmailProvider;
  let emailService: EmailService;

  beforeEach(() => {
    mockProvider = new MockEmailProvider();
    emailService = new EmailService(mockProvider);
  });

  describe("EmailService", () => {
    test("sends magic link email with correct structure", async () => {
      const data: MagicLinkEmailData = {
        to: { email: "test@example.com", name: "Test User" },
        magicLinkUrl: "https://example.com/auth/callback?token=abc123",
        expiryMinutes: 15,
      };

      await emailService.sendMagicLink(data);

      expect(mockProvider.sentMessages).toHaveLength(1);
      const message = mockProvider.sentMessages[0];

      expect(message.to).toEqual(data.to);
      expect(message.subject).toBe("Your magic link to sign in");
      expect(message.from.email).toBe(process.env.FROM_EMAIL as string);
      expect(message.from.name).toBe(process.env.FROM_NAME as string);
    });

    test("includes magic link URL in HTML content", async () => {
      const data: MagicLinkEmailData = {
        to: { email: "user@example.com" },
        magicLinkUrl: "https://test.com/magic?token=xyz789",
        expiryMinutes: 10,
      };

      await emailService.sendMagicLink(data);

      const message = mockProvider.sentMessages[0];
      expect(message.html).toContain(data.magicLinkUrl);
      expect(message.html).toContain("10 minutes");
      expect(message.html).toContain(
        `Sign in to ${process.env.APP_NAME as string}`,
      );
    });

    test("includes magic link URL in text content", async () => {
      const data: MagicLinkEmailData = {
        to: { email: "user@example.com" },
        magicLinkUrl: "https://test.com/magic?token=xyz789",
        expiryMinutes: 15,
      };

      await emailService.sendMagicLink(data);

      const message = mockProvider.sentMessages[0];
      expect(message.text).toBeDefined();
      expect(message.text).toContain(data.magicLinkUrl);
      expect(message.text).toContain("15 minutes");
    });

    test("handles recipient without name", async () => {
      const data: MagicLinkEmailData = {
        to: { email: "noname@example.com" },
        magicLinkUrl: "https://example.com/auth/callback?token=test",
        expiryMinutes: 15,
      };

      await emailService.sendMagicLink(data);

      const message = mockProvider.sentMessages[0];
      expect(message.to.email).toBe("noname@example.com");
      expect(message.to.name).toBeUndefined();
    });

    test("uses environment variables for from address when available", async () => {
      const originalFromEmail = process.env.FROM_EMAIL;
      const originalFromName = process.env.FROM_NAME;

      process.env.FROM_EMAIL = "custom@test.com";
      process.env.FROM_NAME = "Custom App";

      const customService = new EmailService(mockProvider);
      const data: MagicLinkEmailData = {
        to: { email: "test@example.com" },
        magicLinkUrl: "https://example.com/magic",
        expiryMinutes: 15,
      };

      await customService.sendMagicLink(data);

      const message = mockProvider.sentMessages[0];
      expect(message.from.email).toBe("custom@test.com");
      expect(message.from.name).toBe("Custom App");

      process.env.FROM_EMAIL = originalFromEmail;
      process.env.FROM_NAME = originalFromName;
    });
  });

  describe("getEmailService singleton", () => {
    test("returns same instance on multiple calls", () => {
      const service1 = getEmailService();
      const service2 = getEmailService();
      expect(service1).toBe(service2);
    });

    test("allows setting custom service", () => {
      const customService = new EmailService(mockProvider);
      setEmailService(customService);

      const retrievedService = getEmailService();
      expect(retrievedService).toBe(customService);
    });

    test("uses registered custom provider via EMAIL_PROVIDER", () => {
      setEmailService(null as unknown as EmailService);
      const originalProvider = process.env.EMAIL_PROVIDER;
      process.env.EMAIL_PROVIDER = "custom";

      registerEmailProvider("custom", () => mockProvider);
      const service = getEmailService();
      expect(service).toBeInstanceOf(EmailService);

      process.env.EMAIL_PROVIDER = originalProvider;
      setEmailService(null as unknown as EmailService);
    });

    test("throws for unknown provider", () => {
      setEmailService(null as unknown as EmailService);
      const originalProvider = process.env.EMAIL_PROVIDER;
      process.env.EMAIL_PROVIDER = "nonexistent";

      expect(() => getEmailService()).toThrow(
        'Unknown EMAIL_PROVIDER "nonexistent"',
      );

      process.env.EMAIL_PROVIDER = originalProvider;
      setEmailService(null as unknown as EmailService);
    });
  });

  describe("Email template rendering", () => {
    test("HTML template contains all required elements", async () => {
      const data: MagicLinkEmailData = {
        to: { email: "template@example.com" },
        magicLinkUrl: "https://example.com/callback?token=template123",
        expiryMinutes: 20,
      };

      await emailService.sendMagicLink(data);

      const message = mockProvider.sentMessages[0];
      const html = message.html;

      expect(html).toContain("<!DOCTYPE html>");
      expect(html).toContain(process.env.APP_NAME as string);
      expect(html).toContain("Sign in to your account");
      expect(html).toContain(data.magicLinkUrl);
      expect(html).toContain("20 minutes");
      expect(html).toContain("If you didn't request this email");
    });

    test("text template contains essential information", async () => {
      const data: MagicLinkEmailData = {
        to: { email: "text@example.com" },
        magicLinkUrl: "https://example.com/callback?token=text123",
        expiryMinutes: 30,
      };

      await emailService.sendMagicLink(data);

      const message = mockProvider.sentMessages[0];
      expect(message.text).toBeDefined();
      const text = message.text as string;

      expect(text).toContain(`Sign in to ${process.env.APP_NAME as string}`);
      expect(text).toContain(data.magicLinkUrl);
      expect(text).toContain("30 minutes");
      expect(text).toContain("If you didn't request this email");
    });
  });
});

describe("ConsoleLogProvider", () => {
  test("console.log provider can be imported and used", async () => {
    const { ConsoleLogProvider } = await import("./email-providers/console");
    const provider = new ConsoleLogProvider();

    const originalLog = console.log;
    const logCalls: string[] = [];
    console.log = (message: string) => {
      logCalls.push(message);
    };

    const message: EmailMessage = {
      to: { email: "test@example.com", name: "Test User" },
      from: { email: "from@example.com", name: "From User" },
      subject: "Test Subject",
      html: "<p>Test HTML</p>",
      text: "Test text",
    };

    await provider.send(message);

    console.log = originalLog;

    expect(logCalls).toHaveLength(1);
    const output = logCalls[0];
    expect(output).toContain("[INFO] [email]");
    expect(output).toContain("📧 EMAIL SEND");
    expect(output).toContain("Test User <test@example.com>");
    expect(output).toContain("From User <from@example.com>");
    expect(output).toContain("Test Subject");
    expect(output).toContain("<p>Test HTML</p>");
    expect(output).toContain("Test text");
  });
});
