import type { ComponentChildren } from "preact";
import { BaseLayout } from "./layouts";
import { Logo } from "./logo";

interface AuthPageProps {
  title: string;
  description: string;
  canonicalPath: string;
  heading: string;
  subtitle: string;
  children: ComponentChildren;
  footer?: ComponentChildren;
}

/**
 * Shared chrome for the signed-out auth pages: sign in, sign up, and the two
 * halves of the password reset.
 *
 * Uses BaseLayout rather than Layout — no nav, no client bundle, and always
 * noindex. Nothing here should be crawled or invite a signed-out visitor to
 * wander off mid-flow.
 */
export const AuthPage = ({
  title,
  description,
  canonicalPath,
  heading,
  subtitle,
  children,
  footer,
}: AuthPageProps) => (
  <BaseLayout
    title={title}
    description={description}
    canonicalPath={canonicalPath}
    noindex
  >
    <main className="login-page">
      <div className="login-wrapper">
        <div className="login-header">
          <a href="/">
            <Logo />
          </a>
        </div>

        <div className="login-card">
          <h1 className="login-title">{heading}</h1>
          <p className="login-subtitle">{subtitle}</p>

          {children}
        </div>

        <div className="login-footer">
          {footer ?? <a href="/">Back to home</a>}
        </div>
      </div>
    </main>
  </BaseLayout>
);
