import { beforeEach, describe, expect, mock, test } from "bun:test";
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

    test("adds a unique X-Entity-Ref-ID header to each magic link email", async () => {
      await emailService.sendMagicLink({
        to: { email: "user@example.com" },
        magicLinkUrl: "https://example.com/magic?token=a",
        expiryMinutes: 15,
      });
      await emailService.sendMagicLink({
        to: { email: "user@example.com" },
        magicLinkUrl: "https://example.com/magic?token=b",
        expiryMinutes: 15,
      });

      const refs = mockProvider.sentMessages.map(
        (m) => m.headers?.["X-Entity-Ref-ID"],
      );
      expect(refs.every((r) => typeof r === "string" && r.length > 0)).toBe(
        true,
      );
      expect(new Set(refs).size).toBe(2);
    });

    test("sends a verification email with both HTML and text bodies", async () => {
      await emailService.sendVerifyEmail({
        to: { email: "newuser@example.com" },
        verifyUrl: "https://example.com/auth/verify?token=verify123",
        expiryHours: 24,
      });

      expect(mockProvider.sentMessages).toHaveLength(1);
      const message = mockProvider.sentMessages[0];

      expect(message.subject).toBe("Confirm your email address");
      expect(message.to.email).toBe("newuser@example.com");
      expect(message.html).toContain("<!DOCTYPE html>");
      expect(message.html).toContain(
        "https://example.com/auth/verify?token=verify123",
      );
      expect(message.html).toContain("24 hours");
      // Both bodies are required: the console provider and Resend both read text.
      expect(message.text).toContain(
        "https://example.com/auth/verify?token=verify123",
      );
      expect(message.text).toContain("24 hours");
      expect(message.text).toContain("didn't create this account");
    });

    test("sends a password reset email with both HTML and text bodies", async () => {
      await emailService.sendPasswordReset({
        to: { email: "forgot@example.com" },
        resetUrl: "https://example.com/reset-password?token=reset456",
        expiryMinutes: 60,
      });

      const message = mockProvider.sentMessages[0];

      expect(message.subject).toBe("Reset your password");
      expect(message.html).toContain(
        "https://example.com/reset-password?token=reset456",
      );
      expect(message.html).toContain("60 minutes");
      expect(message.text).toContain(
        "https://example.com/reset-password?token=reset456",
      );
      // Reassures a recipient who didn't ask for this that nothing has changed.
      expect(message.text).toContain("your password will not change");
    });

    test("threads every auth email separately with its own X-Entity-Ref-ID", async () => {
      await emailService.sendVerifyEmail({
        to: { email: "same@example.com" },
        verifyUrl: "https://example.com/auth/verify?token=a",
        expiryHours: 24,
      });
      await emailService.sendPasswordReset({
        to: { email: "same@example.com" },
        resetUrl: "https://example.com/reset-password?token=b",
        expiryMinutes: 60,
      });

      const refs = mockProvider.sentMessages.map(
        (m) => m.headers?.["X-Entity-Ref-ID"],
      );
      expect(new Set(refs).size).toBe(2);
    });

    test("omits Reply-To when REPLY_TO_EMAIL is unset", async () => {
      const original = process.env.REPLY_TO_EMAIL;
      delete process.env.REPLY_TO_EMAIL;

      await emailService.sendMagicLink({
        to: { email: "user@example.com" },
        magicLinkUrl: "https://example.com/magic",
        expiryMinutes: 15,
      });

      expect(mockProvider.sentMessages[0].replyTo).toBeUndefined();

      if (original !== undefined) {
        process.env.REPLY_TO_EMAIL = original;
      }
    });

    test("sets Reply-To when REPLY_TO_EMAIL is set", async () => {
      const original = process.env.REPLY_TO_EMAIL;
      process.env.REPLY_TO_EMAIL = "support@yourdomain.com";

      await emailService.sendMagicLink({
        to: { email: "user@example.com" },
        magicLinkUrl: "https://example.com/magic",
        expiryMinutes: 15,
      });

      expect(mockProvider.sentMessages[0].replyTo?.email).toBe(
        "support@yourdomain.com",
      );

      if (original === undefined) {
        delete process.env.REPLY_TO_EMAIL;
      } else {
        process.env.REPLY_TO_EMAIL = original;
      }
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

  test("logs Reply-To and Headers when present", async () => {
    const { ConsoleLogProvider } = await import("./email-providers/console");
    const provider = new ConsoleLogProvider();

    const originalLog = console.log;
    const logCalls: string[] = [];
    console.log = (message: string) => {
      logCalls.push(message);
    };

    const message: EmailMessage = {
      to: { email: "test@example.com" },
      from: { email: "from@example.com" },
      replyTo: { email: "support@yourdomain.com" },
      headers: { "X-Entity-Ref-ID": "abc-123" },
      subject: "Test Subject",
      html: "<p>Test HTML</p>",
    };

    await provider.send(message);

    console.log = originalLog;

    const output = logCalls[0];
    expect(output).toContain("Reply-To: support@yourdomain.com");
    expect(output).toContain("Headers: X-Entity-Ref-ID: abc-123");
  });
});

describe("ResendProvider", () => {
  type SentPayload = {
    from: string;
    to: string;
    replyTo?: string;
    headers?: Record<string, string>;
  };

  const loadProvider = async (
    capture: (payload: SentPayload) => void,
  ): Promise<typeof import("./email-providers/resend").ResendProvider> => {
    mock.module("resend", () => ({
      Resend: class {
        emails = {
          send: async (payload: SentPayload) => {
            capture(payload);
            return { data: { id: "test" }, error: null };
          },
        };
      },
    }));
    const mod = await import("./email-providers/resend");
    return mod.ResendProvider;
  };

  test("forwards replyTo and headers to the Resend client", async () => {
    let sent: SentPayload | undefined;
    const ResendProvider = await loadProvider((p) => {
      sent = p;
    });
    const provider = new ResendProvider("re_test_key");

    await provider.send({
      to: { email: "user@example.com" },
      from: { email: "hello@billet.example", name: "Billet" },
      replyTo: { email: "support@billet.example" },
      headers: { "X-Entity-Ref-ID": "ref-1" },
      subject: "Hello",
      html: "<p>Hi</p>",
    });

    expect(sent?.replyTo).toBe("support@billet.example");
    expect(sent?.headers).toEqual({ "X-Entity-Ref-ID": "ref-1" });
    expect(sent?.from).toBe("Billet <hello@billet.example>");
  });

  test("RFC 5322-quotes a From display name containing a comma", async () => {
    let sent: SentPayload | undefined;
    const ResendProvider = await loadProvider((p) => {
      sent = p;
    });
    const provider = new ResendProvider("re_test_key");

    await provider.send({
      to: { email: "user@example.com" },
      from: { email: "hello@billet.example", name: "Billet, Inc." },
      subject: "Hello",
      html: "<p>Hi</p>",
    });

    expect(sent?.from).toBe('"Billet, Inc." <hello@billet.example>');
  });
});
