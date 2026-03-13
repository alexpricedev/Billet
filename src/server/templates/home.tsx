import { Layout } from "@server/components/layouts";
import type { User } from "@server/services/users";

interface HomeProps {
  user: User | null;
  csrfToken?: string;
}

export const Home = ({ user, csrfToken }: HomeProps) => (
  <Layout
    title="Billet — The AI-native TypeScript starter"
    name="home"
    user={user}
    csrfToken={csrfToken}
  >
    <section className="hero">
      <div className="hero-lottie" id="hero-lottie" />
      <p className="hero-tag">Full-stack TypeScript starter</p>
      <h1>
        Designed to be built&nbsp;on
        <br />
        by AI coding agents
      </h1>
      <p className="hero-sub">
        Server-rendered JSX, light-touch client JS, custom CSS — one codebase,
        one test runner, one deploy target. Deterministic templates with strong
        types that agents can reason about and test with confidence.
      </p>
      <div className="hero-actions">
        <a
          href="https://github.com/alexpricedev/Billet?tab=readme-ov-file#quick-start"
          className="btn-primary"
        >
          Get Started
        </a>
        <a href="/stack" className="btn-ghost">
          View Stack
        </a>
      </div>
    </section>

    <section className="story">
      <aside className="etymology">
        <strong>Billet</strong> <span className="text-quaternary">(noun)</span>{" "}
        — A semi-finished piece of steel, shaped and ready to be worked into
        something specific. Named for Sheffield — the Steel City, where crucible
        steel was invented.
      </aside>
      <div className="story-grid">
        <div>
          <h3 className="section-label">The problem</h3>
          <p className="text-secondary">
            Left to their own choices, AI coding agents reach for what they know
            best: React with Next.js. The result is a thick-frontend app split
            across client and server, locked into a specific ecosystem,
            requiring multiple test systems to simulate browser state, and
            unnecessarily complex to deploy.
          </p>
        </div>
        <div>
          <h3 className="section-label">The approach</h3>
          <p className="text-secondary">
            Single-instance server rendering with light-touch client JavaScript.
            Templates are deterministic functions of their props — given the
            same input, they produce the same HTML. Trivial to test without
            browser simulation. One process, one deploy target.
          </p>
        </div>
      </div>
    </section>

    <section className="backpressure">
      <div className="backpressure-intro">
        <h2>Capture your backpressure</h2>
        <p className="text-secondary">
          AI agents work best when they get told they're wrong immediately — not
          by you, by the toolchain. Type errors, failing tests, lint warnings:
          that's backpressure. Every automated check that catches a mistake is
          one less time you have to context-switch back in to fix something a
          machine should have caught.
        </p>
      </div>
      <div className="feedback-stack">
        <div className="stack-row">
          <span className="stack-layer">TypeScript strict mode</span>
          <span className="stack-catches">
            Type mismatches, missing properties, unused code
          </span>
        </div>
        <div className="stack-row">
          <span className="stack-layer">Biome linting</span>
          <span className="stack-catches">
            Style violations, unsafe patterns, console usage
          </span>
        </div>
        <div className="stack-row">
          <span className="stack-layer">Pre-commit hooks</span>
          <span className="stack-catches">
            Anything that slipped past the editor
          </span>
        </div>
        <div className="stack-row">
          <span className="stack-layer">Test suite</span>
          <span className="stack-catches">
            Behavioural regressions, broken templates, bad responses
          </span>
        </div>
      </div>
    </section>

    <section className="features">
      <h2>What's included</h2>
      <p className="features-lead text-secondary">
        Auth, security, database, testing, linting — the rails are laid so your
        agent can focus on building your product.
      </p>
      <div className="feature-grid">
        <div className="feature-card">
          <h3>Authentication</h3>
          <p>
            Magic-link email login, session management, guest sessions, admin
            roles
          </p>
        </div>
        <div className="feature-card">
          <h3>Security</h3>
          <p>
            CSRF protection, rate limiting, session fixation prevention,
            security headers
          </p>
        </div>
        <div className="feature-card">
          <h3>Database</h3>
          <p>
            PostgreSQL via Bun.SQL, auto-migrations, seed scripts, parameterised
            queries
          </p>
        </div>
        <div className="feature-card">
          <h3>Testing</h3>
          <p>
            220+ tests, deterministic templates, real database testing, no
            browser simulation
          </p>
        </div>
        <div className="feature-card">
          <h3>Frontend</h3>
          <p>
            Server-rendered JSX, custom CSS via Bun bundler, opt-in client
            interactivity, flash messages
          </p>
        </div>
        <div className="feature-card">
          <h3>Code Quality</h3>
          <p>
            Biome linting, strict TypeScript, pre-commit hooks, structured
            logging
          </p>
        </div>
      </div>
    </section>
  </Layout>
);
