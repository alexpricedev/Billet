import type { User } from "../services/users";
import { CsrfField } from "./csrf-field";

const navLinks = [
  { href: "/stack", label: "Stack", name: "stack" },
  { href: "/projects", label: "CRUD", name: "projects" },
  { href: "/forms", label: "Forms", name: "forms" },
];

interface NavProps {
  page: string;
  user?: User | null;
  csrfToken?: string;
}

export const Nav = ({ page, user, csrfToken }: NavProps) => (
  <nav data-component="nav" aria-label="Main navigation">
    {/* Rendered hidden and unhidden by src/client/components/nav-menu.ts. Without
        that script — an error page ships none — the button would toggle nothing,
        so the nav keeps wrapping onto two rows instead. */}
    <button
      type="button"
      className="nav-toggle"
      aria-expanded="false"
      aria-controls="nav-menu"
      hidden
    >
      <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <path
          d="M4 7h16M4 12h16M4 17h16"
          stroke="currentColor"
          stroke-width="2"
          stroke-linecap="round"
        />
      </svg>
      <span className="sr-only">Menu</span>
    </button>
    {/* Wrapper only so the toggle has a single thing to reveal. It is
        display: contents until the toggle takes over, which leaves the list and
        the auth actions as direct flex children of the nav on desktop. */}
    <div id="nav-menu" className="nav-panel">
      <ul>
        {navLinks.map(({ href, label, name }) => (
          <li key={name}>
            <a
              href={href}
              className={page === name ? "active" : undefined}
              aria-current={page === name ? "page" : undefined}
            >
              {label}
            </a>
          </li>
        ))}
      </ul>
      <div className="nav-auth">
        {user ? (
          <>
            <a href="/account" className="btn-ghost">
              Account
            </a>
            <form method="post" action="/auth/logout">
              <CsrfField token={csrfToken ?? null} />
              <button type="submit" className="btn-ghost">
                Logout
              </button>
            </form>
          </>
        ) : (
          <a href="/login" className="btn-ghost">
            Login
          </a>
        )}
      </div>
    </div>
  </nav>
);
