import { CsrfField } from "@server/components/csrf-field";
import { Flash } from "@server/components/flash";
import { FormField } from "@server/components/form-field";
import { Layout } from "@server/components/layouts";
import type { User } from "@server/services/users";

export interface FormsState {
  state?: "submission-success";
  name?: string;
  email?: string;
  message?: string;
}

interface FormsProps {
  user: User | null;
  csrfToken?: string;
  formCsrfToken: string | null;
  state: FormsState;
}

export const Forms = ({
  user,
  csrfToken,
  formCsrfToken,
  state,
}: FormsProps) => (
  <Layout title="Forms - Billet" name="forms" user={user} csrfToken={csrfToken}>
    <h1>Form Patterns</h1>
    <p className="lead">
      Interactive forms with validation, CSRF protection, and flash messages
      baked in.
    </p>

    {state?.state === "submission-success" && (
      <Flash type="success">
        Submitted successfully
        {state.name && <> — {state.name}</>}
        {state.email && <> ({state.email})</>}
        {state.message && <>: &ldquo;{state.message}&rdquo;</>}
      </Flash>
    )}

    <div className="forms-layout">
      <section className="card form-card">
        <h2>Try it out</h2>
        <p className="text-tertiary">
          Submit the form to see a real POST → flash cookie → redirect cycle.
          Try submitting with fewer than 3 characters in the name field.
        </p>
        <form method="POST" action="/forms">
          <CsrfField token={formCsrfToken} />
          <FormField label="Name" id="name-input">
            <input
              id="name-input"
              type="text"
              placeholder="Your name"
              required
              name="name"
              minLength={3}
            />
          </FormField>
          <FormField label="Email" id="email-input">
            <input
              id="email-input"
              type="email"
              placeholder="you@example.com"
              name="email"
            />
          </FormField>
          <FormField label="Message" id="message-input">
            <textarea
              id="message-input"
              placeholder="Say something..."
              name="message"
              rows={3}
            />
          </FormField>
          <button type="submit">Submit</button>
        </form>
      </section>

      <section className="how-it-works">
        <h2>How it works</h2>
        <div className="steps">
          <div className="step">
            <span className="step-num">1</span>
            <div>
              <h3>CSRF Protection</h3>
              <p className="text-tertiary">
                Every mutating form includes a hidden <code>_csrf</code> token
                generated per-session using the synchronizer token pattern.
                Tokens are scoped to a specific HTTP method and path, then
                verified server-side before the action executes.
              </p>
            </div>
          </div>
          <div className="step">
            <span className="step-num">2</span>
            <div>
              <h3>Validation</h3>
              <p className="text-tertiary">
                HTML5 attributes like <code>required</code> and{" "}
                <code>minLength</code> provide instant client-side feedback. The
                server re-validates every field so nothing slips through even if
                JS is disabled or the request is crafted manually.
              </p>
            </div>
          </div>
          <div className="step">
            <span className="step-num">3</span>
            <div>
              <h3>Flash Messages</h3>
              <p className="text-tertiary">
                After a form submission the server sets an HMAC-signed cookie
                containing a one-time message. On the next page load the message
                is read, verified, and cleared — no session store required.
              </p>
            </div>
          </div>
        </div>
      </section>
    </div>
  </Layout>
);
