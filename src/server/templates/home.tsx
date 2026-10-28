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

/** The demo surfaces, in the order they're worth reading. */
const demos = [
  {
    href: "/todos",
    title: "Todos",
    body: "A list backed by a service layer: plain forms that work with JavaScript off, in-place fragments when it's on, and the same data over a JSON API.",
    tag: "Forms · fragments · API",
  },
  {
    href: "/forms",
    title: "Forms",
    body: "One form, the whole round trip — validation, CSRF, the redirect-and-flash that follows a POST, and what each step is protecting you from.",
    tag: "Validation · CSRF · PRG",
  },
  {
    href: "/stack",
    title: "The stack",
    body: "What this is built on and how the layers fit: Bun, server-rendered JSX, PostgreSQL, and the small reactive layer that enhances a page without taking it over.",
    tag: "Architecture",
  },
  {
    href: "/api/stats",
    title: "JSON API",
    body: "The same todo service behind a JSON envelope, with the request guard that keeps a malformed body from becoming an HTML error page.",
    tag: "GET /api/stats",
  },
];

export const Home = ({ user, csrfToken, message }: HomeProps) => (
  <Layout
    title="Billet"
    description="A server-rendered full-stack TypeScript starter on Bun and PostgreSQL. This is the demo that ships with it."
    canonicalPath="/"
    name="home"
    user={user}
    csrfToken={csrfToken}
  >
    {message && (
      <Flash type={message.type}>
        <span>{message.text}</span>
      </Flash>
    )}

    <PageHeader
      title="Billet"
      description="A server-rendered full-stack TypeScript starter on Bun and PostgreSQL. Everything below is running in this app — read the page, then read the code that rendered it."
    />

    <ul className="demo-grid">
      {demos.map((demo) => (
        <li key={demo.href}>
          <a className="demo-card" href={demo.href}>
            <span className="demo-card-tag">{demo.tag}</span>
            <span className="demo-card-title">{demo.title}</span>
            <span className="demo-card-body">{demo.body}</span>
          </a>
        </li>
      ))}
    </ul>

    <section className="home-next">
      <h2>Making it yours</h2>
      <p className="text-secondary">
        These pages are a demo, not a foundation to build on — they exist so the
        stack is legible before you delete them. <code>START_PROMPT.md</code>{" "}
        walks through renaming the project and stripping the parts you don't
        want.
      </p>
      {!user && (
        <p>
          <a className="btn btn-primary" href="/signup">
            Create an account
          </a>
        </p>
      )}
    </section>
  </Layout>
);
