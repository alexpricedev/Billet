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

export interface OrgInviteEmailData {
  to: EmailAddress;
  organizationName: string;
  invitedByEmail: string;
  acceptUrl: string;
  expiryDays: number;
}

/**
 * Escape a value on its way into the HTML body.
 *
 * Applied by renderActionHtml to every field rather than by each caller. That
 * was not needed while the only interpolated values were URLs the server built
 * and env vars the operator set — but the org invite is the first email
 * carrying text a *user* typed, and an org name of `<a href="…">` would
 * otherwise render as live markup in every invitee's inbox. Doing it at the
 * render boundary means no future email can reintroduce the hole by forgetting.
 *
 * Only the HTML body needs it: the plaintext part is not markup, so it keeps
 * the raw text and stays readable.
 */
export const escapeHtml = (value: string): string =>
  value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    // Double quotes only. Every interpolation below is either element text or
    // a double-quoted attribute value, and an apostrophe can't escape either —
    // encoding it would only turn every "didn't" in the copy into "didn&#39;t"
    // for anyone reading the message source.
    .replace(/"/g, "&quot;");

/**
 * Strip anything that would break out of a Subject header.
 *
 * A newline in a subject is header injection at the provider boundary, and the
 * subject is the one field that isn't HTML — so it needs this rather than
 * escapeHtml.
 */
const singleLine = (value: string): string =>
  value.replace(/[\r\n]+/g, " ").trim();

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

const renderActionHtml = (content: ActionEmail): string => {
  // Every field is escaped here, at the one boundary where they become markup.
  const { title, heading, intro, buttonLabel, url, footer } = {
    title: escapeHtml(content.title),
    heading: escapeHtml(content.heading),
    intro: escapeHtml(content.intro),
    buttonLabel: escapeHtml(content.buttonLabel),
    url: escapeHtml(content.url),
    footer: escapeHtml(content.footer),
  };

  return `
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
};

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

  /**
   * The one email carrying user-supplied text, so the org name and the
   * inviter's address are escaped on the way in — see escapeHtml above.
   */
  async sendOrgInvite(data: OrgInviteEmailData): Promise<void> {
    const appName = process.env.APP_NAME as string;

    await this.deliver(
      singleLine(`You've been invited to join ${data.organizationName}`),
      data.to,
      {
        title: `Join ${data.organizationName} on ${appName}`,
        heading: "You've been invited",
        intro: `${data.invitedByEmail} invited you to join ${data.organizationName} on ${appName}. This invitation expires in ${data.expiryDays} days.`,
        buttonLabel: "Accept invitation",
        url: data.acceptUrl,
        footer:
          "If you weren't expecting this invitation, you can safely ignore this email.",
      },
    );
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
