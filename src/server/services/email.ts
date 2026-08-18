export interface EmailAddress {
  email: string;
  name?: string;
}

export interface EmailMessage {
  to: EmailAddress;
  from: EmailAddress;
  replyTo?: EmailAddress;
  subject: string;
  html: string;
  text?: string;
  headers?: Record<string, string>;
}

export interface EmailProvider {
  send(message: EmailMessage): Promise<void>;
}

export interface MagicLinkEmailData {
  to: EmailAddress;
  magicLinkUrl: string;
  expiryMinutes: number;
}

export interface VerifyEmailData {
  to: EmailAddress;
  verifyUrl: string;
  expiryHours: number;
}

export interface PasswordResetEmailData {
  to: EmailAddress;
  resetUrl: string;
  expiryMinutes: number;
}

export interface OrganisationInviteEmailData {
  to: EmailAddress;
  organisationName: string;
  // Who sent it. An invitation from a stranger's address is indistinguishable
  // from spam, so the message names the person as well as the organisation.
  invitedByEmail: string;
  acceptUrl: string;
  expiryDays: number;
}

// Every email here is a single call to action on a link, so they share one
// inline-styled shell. Inline styles rather than a <style> block because most
// clients strip the latter.
interface ActionEmail {
  title: string;
  heading: string;
  intro: string;
  buttonLabel: string;
  url: string;
  footer: string;
}

const renderActionHtml = ({
  title,
  heading,
  intro,
  buttonLabel,
  url,
  footer,
}: ActionEmail): string => `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${title}</title>
</head>
<body style="margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; line-height: 1.6; color: #333;">
  <div style="max-width: 600px; margin: 0 auto; padding: 40px 20px;">
    <div style="text-align: center; margin-bottom: 40px;">
      <h1 style="color: #2563eb; margin: 0;">${process.env.APP_NAME as string}</h1>
    </div>

    <div style="background: #f8fafc; padding: 30px; border-radius: 8px; margin-bottom: 30px;">
      <h2 style="margin-top: 0; color: #1f2937;">${heading}</h2>
      <p style="margin-bottom: 30px; color: #4b5563;">
        ${intro}
      </p>

      <div style="text-align: center; margin: 30px 0;">
        <a href="${url}"
           style="display: inline-block; background: #2563eb; color: white; text-decoration: none; padding: 12px 30px; border-radius: 6px; font-weight: 500;">
          ${buttonLabel}
        </a>
      </div>

      <p style="margin-bottom: 0; color: #6b7280; font-size: 14px;">
        If the button doesn't work, copy and paste this link into your browser:<br>
        <a href="${url}" style="color: #2563eb; word-break: break-all;">${url}</a>
      </p>
    </div>

    <div style="text-align: center; color: #6b7280; font-size: 14px;">
      <p>${footer}</p>
    </div>
  </div>
</body>
</html>`;

const renderActionText = ({ title, intro, url, footer }: ActionEmail): string =>
  `${title}

${intro}

${url}

${footer}`;

export class EmailService {
  constructor(private provider: EmailProvider) {}

  async sendMagicLink(data: MagicLinkEmailData): Promise<void> {
    const appName = process.env.APP_NAME as string;

    await this.deliver("Your magic link to sign in", data.to, {
      title: `Sign in to ${appName}`,
      heading: "Sign in to your account",
      intro: `Click the button below to sign in to your account. This link will expire in ${data.expiryMinutes} minutes.`,
      buttonLabel: `Sign in to ${appName}`,
      url: data.magicLinkUrl,
      footer: "If you didn't request this email, you can safely ignore it.",
    });
  }

  async sendVerifyEmail(data: VerifyEmailData): Promise<void> {
    const appName = process.env.APP_NAME as string;

    await this.deliver("Confirm your email address", data.to, {
      title: `Confirm your email for ${appName}`,
      heading: "Confirm your email address",
      intro: `Click the button below to confirm this is your email address. This link will expire in ${data.expiryHours} hours.`,
      buttonLabel: "Confirm email address",
      url: data.verifyUrl,
      footer:
        "If you didn't create this account, you can safely ignore this email.",
    });
  }

  async sendPasswordReset(data: PasswordResetEmailData): Promise<void> {
    await this.deliver("Reset your password", data.to, {
      title: `Reset your ${process.env.APP_NAME as string} password`,
      heading: "Reset your password",
      intro: `Click the button below to choose a new password. This link will expire in ${data.expiryMinutes} minutes and can only be used once.`,
      buttonLabel: "Reset password",
      url: data.resetUrl,
      footer:
        "If you didn't request a password reset, you can safely ignore this email — your password will not change.",
    });
  }

  async sendOrganisationInvite(
    data: OrganisationInviteEmailData,
  ): Promise<void> {
    await this.deliver(`Join ${data.organisationName}`, data.to, {
      title: `Join ${data.organisationName} on ${process.env.APP_NAME as string}`,
      heading: `Join ${data.organisationName}`,
      intro: `${data.invitedByEmail} has invited you to join ${data.organisationName}. Click the button below to accept. This invitation will expire in ${data.expiryDays} days.`,
      buttonLabel: "Accept invitation",
      url: data.acceptUrl,
      footer:
        "If you weren't expecting this invitation, you can safely ignore this email — no account will be created.",
    });
  }

  private async deliver(
    subject: string,
    to: EmailAddress,
    content: ActionEmail,
  ): Promise<void> {
    const replyTo = process.env.REPLY_TO_EMAIL;

    const message: EmailMessage = {
      to,
      from: {
        email: process.env.FROM_EMAIL as string,
        name: process.env.FROM_NAME as string,
      },
      ...(replyTo ? { replyTo: { email: replyTo } } : {}),
      // Unique per send so Gmail doesn't collapse consecutive links into one
      // thread — the recipient always sees the newest one.
      headers: { "X-Entity-Ref-ID": crypto.randomUUID() },
      subject,
      html: renderActionHtml(content),
      text: renderActionText(content),
    };

    await this.provider.send(message);
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
