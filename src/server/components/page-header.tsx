import type { ComponentChildren } from "preact";

interface PageHeaderProps {
  /** The breadcrumb trail, without the wrapping <p>. */
  breadcrumb?: ComponentChildren;
  title: ComponentChildren;
  /** The one-sentence description under the title. */
  description?: ComponentChildren;
  /** Extra status or metadata under the description. */
  after?: ComponentChildren;
  /** Primary and secondary actions, right-aligned on wide screens. */
  actions?: ComponentChildren;
}

/**
 * The top of every page: breadcrumb, title, description and actions.
 *
 * Keeping this as one component is what makes page headers line up across the
 * app. The class names come from components/page.css, not from this file, so a
 * page can still style its own body without redefining the header.
 */
export const PageHeader = ({
  breadcrumb,
  title,
  description,
  after,
  actions,
}: PageHeaderProps) => (
  <header className={breadcrumb ? "page-header has-breadcrumb" : "page-header"}>
    <div className="page-header-text">
      {breadcrumb && <p className="breadcrumb">{breadcrumb}</p>}
      <h1 className="page-title">{title}</h1>
      {description && <p className="page-intro">{description}</p>}
      {after}
    </div>
    {actions && <div className="page-header-actions">{actions}</div>}
  </header>
);
