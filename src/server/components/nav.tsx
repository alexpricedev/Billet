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
        <form method="post" action="/auth/logout">
          <CsrfField token={csrfToken ?? null} />
          <button type="submit" className="btn-ghost">
            Logout
          </button>
        </form>
      ) : (
        <a href="/login" className="btn-ghost">
          Login
        </a>
      )}
    </div>
  </nav>
);
