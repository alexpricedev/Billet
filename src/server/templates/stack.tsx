import { DataTable } from "@server/components/data-table";
import { Layout } from "@server/components/layouts";
import type { User } from "@server/services/users";

interface StackProps {
  user: User | null;
  csrfToken?: string;
}

export const Stack = ({ user, csrfToken }: StackProps) => (
  <Layout
    title="Stack - Billet"
    description="The Billet stack—Bun, server-rendered JSX, custom CSS, and PostgreSQL in one process with one test runner and one deploy target."
    canonicalPath="/stack"
    name="stack"
    user={user}
    csrfToken={csrfToken}
  >
    <h1>The Stack</h1>
    <p className="lead">
      Billet is a server-rendered TypeScript starter built on Bun. Templates are
      JSX, compiled by Bun and rendered to HTML in the same process that answers
      the request—no client framework, no virtual DOM, no hydration step. Pages
      arrive as plain HTML, and a few hundred lines of signals bind
      interactivity to that markup where a page needs it.
    </p>

    <section>
      <h2>How data flows</h2>
      <p className="text-secondary">
        Every request follows the same three-step path. Services fetch or mutate
        data, controllers decide what to do with it, and templates turn it into
        HTML. There are no loading states because data is always resolved before
        the template renders.
      </p>
      <pre>{`services/        →  controllers/     →  templates/
  query the db        call services        receive props
  return typed        pick a template      render HTML
  data                pass data in         return Response`}</pre>
    </section>

    <section>
      <h2>Project structure</h2>
      <pre>{`src/
├── client/                  # Browser-side code
│   ├── main.ts              # Entry point: registers pages and components
│   ├── page-lifecycle.ts    # Per-page init and cleanup
│   ├── reactive/            # Signals, components, bind(), submit helper
│   ├── style.css            # Global styles (CSS entry point)
│   ├── components/          # Shared components + CSS (nav, todo list)
│   └── pages/               # Page JS & CSS (co-located)
│
├── server/                  # Server-side code (Bun)
│   ├── main.ts              # Server entry point
│   ├── routes/              # URL → controller mapping
│   ├── controllers/         # Request handlers
│   │   ├── app/             # View controllers (HTML)
│   │   ├── api/             # API controllers (JSON)
│   │   ├── auth/            # Auth flows
│   │   └── team/            # Team management (TEAMS_ENABLED)
│   ├── templates/           # Full-page JSX templates
│   ├── components/          # Reusable server JSX
│   ├── services/            # Business logic & data
│   ├── middleware/          # Auth, CSRF, rate limiting
│   ├── utils/               # Shared helpers
│   └── database/            # Migrations
│
└── shared/                  # The data-* vocabulary and header names both sides import`}</pre>
    </section>

    <section>
      <h2>Feedback stack</h2>
      <p className="text-secondary">
        Five layers of automated checks run before code reaches production.
      </p>
      <DataTable>
        <thead>
          <tr>
            <th>Layer</th>
            <th>What it catches</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>TypeScript strict mode</td>
            <td>
              Type errors, null safety violations, implicit <code>any</code>
            </td>
          </tr>
          <tr>
            <td>Biome linting</td>
            <td>
              Code quality, unused variables, console statements, unsafe
              patterns
            </td>
          </tr>
          <tr>
            <td>Pre-commit hooks</td>
            <td>
              Formatting, lint errors, and type checks before every commit
            </td>
          </tr>
          <tr>
            <td>Test suite</td>
            <td>
              Regressions across services, controllers, templates, and client
              scripts
            </td>
          </tr>
          <tr>
            <td>GitHub Actions CI</td>
            <td>
              Lint, build, and the full suite against a real PostgreSQL before a
              branch can merge; a scheduled audit flags vulnerable dependencies
            </td>
          </tr>
        </tbody>
      </DataTable>
    </section>

    <section>
      <h2>Technology choices</h2>
      <p className="text-secondary">
        A small, deliberate set of tools chosen for speed, simplicity, and
        minimal abstraction.
      </p>
      <DataTable>
        <thead>
          <tr>
            <th>Technology</th>
            <th>Role</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>Bun</td>
            <td>Runtime, bundler, test runner, and package manager</td>
          </tr>
          <tr>
            <td>PostgreSQL</td>
            <td>Primary data store with raw SQL via tagged templates</td>
          </tr>
          <tr>
            <td>Bun CSS bundler</td>
            <td>Native @import resolution, CSS nesting, and minification</td>
          </tr>
          <tr>
            <td>Signals</td>
            <td>
              An in-repo reactive layer that binds to server markup by name—no
              virtual DOM, no eval, no full SPA
            </td>
          </tr>
          <tr>
            <td>Preact</td>
            <td>
              The JSX runtime, used only by <code>renderToString()</code> on the
              server—none of it reaches the browser
            </td>
          </tr>
          <tr>
            <td>Resend</td>
            <td>
              Transactional email in production; a console provider takes its
              place in development
            </td>
          </tr>
        </tbody>
      </DataTable>
    </section>
  </Layout>
);
