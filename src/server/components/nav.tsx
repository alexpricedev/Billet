const navLinks = [
  { href: "/", label: "Home", name: "home" },
  { href: "/about", label: "About", name: "about" },
  { href: "/contact", label: "Contact", name: "contact" },
];

export const Nav = ({ page }: { page: string }) => (
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
  </nav>
);
