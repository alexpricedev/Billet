import { Layout } from "@server/components/layouts";
import type { User } from "@server/services/users";

interface HomeProps {
  visitorCount: number;
  lastUpdated: Date;
  user: User | null;
  csrfToken?: string;
}

export const Home = ({
  visitorCount,
  lastUpdated,
  user,
  csrfToken,
}: HomeProps) => (
  <Layout title="Billet" name="home" user={user} csrfToken={csrfToken}>
    <section className="hero">
      <h1>Built for AI agents</h1>
      <p className="lead">
        Full-stack TypeScript starter. Server-rendered JSX, one process, one
        deploy target.
      </p>
      <div className="hero-actions">
        <a
          href="https://github.com/new?template_name=Billet&template_owner=alexpricedev"
          className="btn-primary"
        >
          Get Started
        </a>
        <a href="/stack" className="btn-ghost">
          View Stack
        </a>
      </div>
      <span className="stat-badge">
        {visitorCount.toLocaleString()} visitors since{" "}
        {lastUpdated.toLocaleDateString()}
      </span>
    </section>

    <section className="features">
      <h2>What's included</h2>
      <div className="feature-grid">
        <div className="card">
          <h3>Authentication</h3>
          <p className="text-tertiary">
            Magic-link email login, session management, guest sessions, admin
            roles
          </p>
        </div>
        <div className="card">
          <h3>Security</h3>
          <p className="text-tertiary">
            CSRF protection, rate limiting, session fixation prevention,
            security headers
          </p>
        </div>
        <div className="card">
          <h3>Database</h3>
          <p className="text-tertiary">
            PostgreSQL via Bun.SQL, auto-migrations, seed scripts, parameterised
            queries
          </p>
        </div>
        <div className="card">
          <h3>Testing</h3>
          <p className="text-tertiary">
            220+ tests, deterministic templates, real database testing, no
            browser simulation
          </p>
        </div>
        <div className="card">
          <h3>Frontend</h3>
          <p className="text-tertiary">
            Server-rendered JSX, Tailwind CSS 4, opt-in client interactivity,
            flash messages
          </p>
        </div>
        <div className="card">
          <h3>Code Quality</h3>
          <p className="text-tertiary">
            Biome linting, strict TypeScript, pre-commit hooks, structured
            logging
          </p>
        </div>
      </div>
    </section>
  </Layout>
);
