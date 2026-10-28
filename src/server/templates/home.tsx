import { Flash } from "@server/components/flash";
import { Layout } from "@server/components/layouts";
import { PageHeader } from "@server/components/page-header";
import type { User } from "@server/services/users";
import type { FlashMessage } from "@server/utils/flash";

interface HomeProps {
  user: User | null;
  csrfToken?: string;
  // Guards that turn someone away redirect here and leave their reason in the
  // "message" flash, and so do the flows that finish elsewhere — accepting an
  // invitation lands here. Rendering it is what makes requireAdmin and
  // requireOrgRole say anything at all — without this the user lands on the
  // home page with no idea why, which is the "announce dynamic updates" rule
  // in runbooks/ACCESSIBILITY.md going unmet. The writer picks the type: a
  // guard's refusal and "You've joined Acme" both arrive on this key.
  message?: FlashMessage;
}

const REPO_URL = "https://github.com/alexpricedev/Billet";
const QUICK_START_URL = `${REPO_URL}?tab=readme-ov-file#quick-start`;

/**
 * Lucide glyphs, inlined the way every other icon in this project is: 24×24,
 * `currentColor`, stroke-width 2, kebab-case attributes (Preact passes
 * camelCase through verbatim and the parser ignores it — see DESIGN.md).
 */
const icons = {
  "list-checks": [
    "m3 17 2 2 4-4",
    "m3 7 2 2 4-4",
    "M13 6h8",
    "M13 12h8",
    "M13 18h8",
  ],
  "square-pen": [
    "M12 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7",
    "M18.4 2.6a1 1 0 0 1 3 3l-9 9a2 2 0 0 1-.9.5l-2.9.8a.5.5 0 0 1-.6-.6l.8-2.9a2 2 0 0 1 .5-.9z",
  ],
  layers: [
    "M12.8 2.2a2 2 0 0 0-1.6 0L2.6 6.1a1 1 0 0 0 0 1.8l8.6 3.9a2 2 0 0 0 1.6 0l8.6-3.9a1 1 0 0 0 0-1.8z",
    "m6.1 10.4-3.5 1.6a1 1 0 0 0 0 1.8l8.6 3.9a2 2 0 0 0 1.6 0l8.6-3.9a1 1 0 0 0 0-1.8l-3.5-1.6",
    "m6.1 15.4-3.5 1.6a1 1 0 0 0 0 1.8l8.6 3.9a2 2 0 0 0 1.6 0l8.6-3.9a1 1 0 0 0 0-1.8l-3.5-1.6",
  ],
  braces: [
    "M8 3H7a2 2 0 0 0-2 2v5a2 2 0 0 1-2 2 2 2 0 0 1 2 2v5c0 1.1.9 2 2 2h1",
    "M16 21h1a2 2 0 0 0 2-2v-5c0-1.1.9-2 2-2a2 2 0 0 1-2-2V5a2 2 0 0 0-2-2h-1",
  ],
} as const;

const Icon = ({ name }: { name: keyof typeof icons }) => (
  <svg
    className="demo-card-icon"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    stroke-width="2"
    stroke-linecap="round"
    stroke-linejoin="round"
    aria-hidden="true"
  >
    {icons[name].map((d) => (
      <path key={d} d={d} />
    ))}
  </svg>
);

/** The demo surfaces, in the order they're worth reading. */
const demos = [
  {
    href: "/todos",
    icon: "list-checks",
    title: "Todos",
    body: "A list backed by a service layer: plain forms that work with JavaScript off, in-place fragments when it's on, and the same data over a JSON API.",
    tag: "Forms · fragments · API",
  },
  {
    href: "/forms",
    icon: "square-pen",
    title: "Forms",
    body: "One form, the whole round trip — validation, CSRF, the redirect-and-flash that follows a POST, and what each step is protecting you from.",
    tag: "Validation · CSRF · PRG",
  },
  {
    href: "/stack",
    icon: "layers",
    title: "The stack",
    body: "What this is built on and how the layers fit: Bun, server-rendered JSX, PostgreSQL, and the small reactive layer that enhances a page without taking it over.",
    tag: "Architecture",
  },
  {
    href: "/api/stats",
    icon: "braces",
    title: "JSON API",
    body: "The same todo service behind a JSON envelope, with the request guard that keeps a malformed body from becoming an HTML error page.",
    tag: "GET /api/stats",
  },
] as const;

/**
 * Packages built alongside Billet. None are bundled — this is a signpost, not
 * a dependency list, which is why each one says what it is rather than just
 * carrying a name.
 */
const companions = [
  {
    href: "https://github.com/alexpricedev/billet-cookie-consent",
    name: "billet-cookie-consent",
    body: "A GDPR-friendly consent banner, framework-agnostic and built to slot into a server-rendered template.",
  },
  {
    href: "https://github.com/alexpricedev/billet-dialog",
    name: "billet-dialog",
    body: "An accessible confirm dialog for destructive actions. Vanilla DOM, zero dependencies, and it gates the form rather than replacing it.",
  },
  {
    href: "https://github.com/alexpricedev/billet-analytics",
    name: "billet-analytics",
    body: "Privacy-first, self-hosted analytics. Page views land in your own PostgreSQL, and the page needs no tracker script.",
  },
  {
    href: "https://github.com/alexpricedev/billet-storage",
    name: "billet-storage",
    body: "File storage behind one interface: an S3-compatible bucket in production, a local directory in development.",
  },
  {
    href: "https://github.com/alexpricedev/log-digest",
    name: "log-digest",
    body: "An in-memory log buffer with a pluggable sink. Batches entries and hands them off to email, Slack, or somewhere of your own.",
  },
  {
    href: "https://conductor.build",
    name: "Conductor",
    body: "Runs several coding agents in parallel, one git worktree each. Billet ships settings that give every workspace its own port and databases.",
  },
] as const;

export const Home = ({ user, csrfToken, message }: HomeProps) => (
  <Layout
    title="Billet"
    description="A server-rendered full-stack TypeScript starter on Bun and PostgreSQL. This is the demo that ships with it."
    canonicalPath="/"
    name="home"
    user={user}
    csrfToken={csrfToken}
  >
    {message && <Flash tone={message.type} title={message.text} />}

    <PageHeader
      title="See Billet running"
      description="A server-rendered full-stack TypeScript starter on Bun and PostgreSQL. Everything below is running in this app — read the page, then read the code that rendered it."
    />

    <ul className="demo-grid">
      {demos.map((demo) => (
        <li key={demo.href}>
          <a className="demo-card" href={demo.href}>
            <Icon name={demo.icon} />
            <span className="demo-card-tag">{demo.tag}</span>
            <span className="demo-card-title">{demo.title}</span>
            <span className="demo-card-body">{demo.body}</span>
          </a>
        </li>
      ))}
    </ul>

    <section className="home-section">
      <h2>Works well with</h2>
      <p className="text-secondary">
        Small packages built alongside Billet. None are bundled — add the ones
        your product needs.
      </p>
      <ul className="companion-list">
        {companions.map((companion) => (
          <li key={companion.href}>
            <a
              className="companion"
              href={companion.href}
              target="_blank"
              rel="noopener noreferrer"
            >
              <span className="companion-name">
                {companion.name} <span aria-hidden="true">→</span>
              </span>
              <span className="companion-body">{companion.body}</span>
            </a>
          </li>
        ))}
      </ul>
    </section>

    <section className="home-section">
      <h2>Making it yours</h2>
      <p className="text-secondary">
        These pages are a demo, not a foundation to build on — they exist so the
        stack is legible before you delete them. <code>START_PROMPT.md</code>{" "}
        walks through renaming the project and stripping the parts you don't
        want.
      </p>
      <p>
        <a
          className="btn btn-primary"
          href={QUICK_START_URL}
          target="_blank"
          rel="noopener noreferrer"
        >
          Get started on GitHub <span aria-hidden="true">→</span>
        </a>
      </p>
    </section>
  </Layout>
);
