import type { EmailAddress, EmailMessage, EmailProvider } from "../email";

/**
 * Resend's HTTP API, called directly. The official SDK is a thin wrapper over
 * this one POST, and it brought four transitive packages (webhook and MIME
 * parsing) that nothing here uses — so the provider owns the request instead.
 * Reference: https://resend.com/docs/api-reference/emails/send-email
 */
const RESEND_SEND_URL = "https://api.resend.com/emails";

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

/** The request body Resend accepts; its field names are snake_case. */
export interface ResendSendPayload {
  from: string;
  to: string;
  subject: string;
  html: string;
  text?: string;
  reply_to?: string;
  headers?: Record<string, string>;
}

interface ResendErrorBody {
  message?: string;
  name?: string;
}

export class ResendProvider implements EmailProvider {
  private readonly apiKey: string;
  private readonly fetchImpl: typeof fetch;

  // `fetchImpl` is injectable so the tests can capture the request without a
  // network, and without going through happy-dom's same-origin fetch.
  constructor(apiKey: string, fetchImpl: typeof fetch = fetch) {
    if (!apiKey) {
      throw new Error("Resend API key is required");
    }
    this.apiKey = apiKey;
    this.fetchImpl = fetchImpl;
  }

  async send(message: EmailMessage): Promise<void> {
    const payload: ResendSendPayload = {
      from: formatAddress(message.from),
      to: formatAddress(message.to),
      subject: message.subject,
      html: message.html,
      ...(message.text ? { text: message.text } : {}),
      ...(message.replyTo ? { reply_to: formatAddress(message.replyTo) } : {}),
      ...(message.headers ? { headers: message.headers } : {}),
    };

    const response = await this.fetchImpl(RESEND_SEND_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      throw new Error(`Resend API error: ${await describeError(response)}`);
    }
  }
}

// Resend answers failures with `{ statusCode, message, name }`, but a proxy or
// an outage can hand back anything, so the status is always part of the text.
const describeError = async (response: Response): Promise<string> => {
  let detail = "";
  try {
    const body = (await response.json()) as ResendErrorBody;
    detail = body.message ?? body.name ?? "";
  } catch {
    // Non-JSON body — the status alone will have to do.
  }
  return detail ? `${response.status} ${detail}` : `HTTP ${response.status}`;
};
