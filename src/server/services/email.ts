export interface EmailAddress {
  email: string;
  name?: string;
}

export interface EmailMessage {
  to: EmailAddress;
  from: EmailAddress;
  subject: string;
  html: string;
  text?: string;
}

export interface EmailProvider {
  send(message: EmailMessage): Promise<void>;
}

export interface MagicLinkEmailData {
  to: EmailAddress;
  magicLinkUrl: string;
  expiryMinutes: number;
}

export class EmailService {
  constructor(private provider: EmailProvider) {}

  async sendMagicLink(data: MagicLinkEmailData): Promise<void> {
    const fromEmail = process.env.FROM_EMAIL as string;
    const fromName = process.env.FROM_NAME as string;

    const message: EmailMessage = {
      to: data.to,
      from: {
        email: fromEmail,
        name: fromName,
      },
      subject: "Your magic link to sign in",
      html: this.renderMagicLinkTemplate(data),
      text: this.renderMagicLinkText(data),
    };

    await this.provider.send(message);
  }

  private renderMagicLinkTemplate(data: MagicLinkEmailData): string {
    return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Sign in to ${process.env.APP_NAME as string}</title>
</head>
<body style="margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; line-height: 1.6; color: #333;">
  <div style="max-width: 600px; margin: 0 auto; padding: 40px 20px;">
    <div style="text-align: center; margin-bottom: 40px;">
      <h1 style="color: #2563eb; margin: 0;">${process.env.APP_NAME as string}</h1>
    </div>
    
    <div style="background: #f8fafc; padding: 30px; border-radius: 8px; margin-bottom: 30px;">
      <h2 style="margin-top: 0; color: #1f2937;">Sign in to your account</h2>
      <p style="margin-bottom: 30px; color: #4b5563;">
        Click the button below to sign in to your account. This link will expire in ${data.expiryMinutes} minutes.
      </p>
      
      <div style="text-align: center; margin: 30px 0;">
        <a href="${data.magicLinkUrl}" 
           style="display: inline-block; background: #2563eb; color: white; text-decoration: none; padding: 12px 30px; border-radius: 6px; font-weight: 500;">
          Sign in to ${process.env.APP_NAME as string}
        </a>
      </div>
      
      <p style="margin-bottom: 0; color: #6b7280; font-size: 14px;">
        If the button doesn't work, copy and paste this link into your browser:<br>
        <a href="${data.magicLinkUrl}" style="color: #2563eb; word-break: break-all;">${data.magicLinkUrl}</a>
      </p>
    </div>
    
    <div style="text-align: center; color: #6b7280; font-size: 14px;">
      <p>If you didn't request this email, you can safely ignore it.</p>
    </div>
  </div>
</body>
</html>`;
  }

  private renderMagicLinkText(data: MagicLinkEmailData): string {
    return `Sign in to ${process.env.APP_NAME as string}

Click the link below to sign in to your account:
${data.magicLinkUrl}

This link will expire in ${data.expiryMinutes} minutes.

If you didn't request this email, you can safely ignore it.`;
  }
}

let emailServiceInstance: EmailService | null = null;

const providerFactories: Record<string, () => EmailProvider> = {
  console: () => {
    const { ConsoleLogProvider } =
      require("./email-providers/console") as typeof import("./email-providers/console");
    return new ConsoleLogProvider();
  },
  resend: () => {
    const { ResendProvider } =
      require("./email-providers/resend") as typeof import("./email-providers/resend");
    return new ResendProvider(process.env.RESEND_API_KEY as string);
  },
};

export function registerEmailProvider(
  name: string,
  factory: () => EmailProvider,
): void {
  providerFactories[name] = factory;
}

export const getEmailService = (): EmailService => {
  if (!emailServiceInstance) {
    const providerName = process.env.EMAIL_PROVIDER as string;
    const factory = providerFactories[providerName];

    if (!factory) {
      throw new Error(
        `Unknown EMAIL_PROVIDER "${providerName}". ` +
          "Register it with registerEmailProvider() before calling getEmailService().",
      );
    }

    emailServiceInstance = new EmailService(factory());
  }
  return emailServiceInstance;
};

export const setEmailService = (service: EmailService): void => {
  emailServiceInstance = service;
};
