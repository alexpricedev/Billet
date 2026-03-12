import { Layout } from "@server/components/layouts";
import type { User } from "@server/services/users";

interface FormsProps {
  user: User | null;
  csrfToken?: string;
}

export const Forms = ({ user, csrfToken }: FormsProps) => (
  <Layout title="Forms - Billet" name="forms" user={user} csrfToken={csrfToken}>
    <h1>Form Patterns</h1>
    <p className="lead">
      Interactive forms with validation, CSRF protection, and flash messages
      baked in.
    </p>

    <section className="card form-card">
      <h2>Try it out</h2>
      <p className="text-tertiary">
        Submit the form below. Client-side JS intercepts the submission and
        shows an alert with your input.
      </p>
      <form>
        <label htmlFor="name-input">Name</label>
        <input
          id="name-input"
          type="text"
          placeholder="Your name"
          required
          name="name"
          minLength={3}
        />
        <button type="submit">Submit</button>
      </form>
    </section>

    <section className="form-explainer" style={{ marginTop: "2.5rem" }}>
      <h2>How it works</h2>
      <div className="feature-grid">
        <div className="card">
          <h3>CSRF Protection</h3>
          <p className="text-tertiary">
            Every mutating form includes a hidden <code>_csrf</code> token
            generated per-session using the synchronizer token pattern. Tokens
            are scoped to a specific HTTP method and path, then verified
            server-side before the action executes.
          </p>
        </div>
        <div className="card">
          <h3>Validation</h3>
          <p className="text-tertiary">
            HTML5 attributes like <code>required</code> and{" "}
            <code>minLength</code> provide instant client-side feedback. The
            server re-validates every field so nothing slips through even if JS
            is disabled or the request is crafted manually.
          </p>
        </div>
        <div className="card">
          <h3>Flash Messages</h3>
          <p className="text-tertiary">
            After a form submission the server sets an HMAC-signed cookie
            containing a one-time message. On the next page load the message is
            read, verified, and cleared automatically — no session store
            required.
          </p>
        </div>
      </div>
    </section>
  </Layout>
);
