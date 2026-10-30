import type { PageSeo } from "@alexpricedev/billet-cms/server";
import type { HeroAction } from "@server/cms/home-hero";
import type {
  MarketingPageContent,
  MarketingSection,
} from "@server/cms/marketing-page";
import { Layout } from "@server/components/layouts";
import type { User } from "@server/services/users";

interface MarketingProps {
  seo: PageSeo;
  content: MarketingPageContent;
  user: User | null;
  csrfToken?: string;
}

const ActionLink = ({
  action,
  className,
}: {
  action: HeroAction;
  className: string;
}) => (
  <a
    href={action.href}
    className={className}
    {...(action.newTab ? { target: "_blank", rel: "noopener noreferrer" } : {})}
  >
    {action.label}
  </a>
);

// Rich text and images arrive as HTML the CMS package rendered and escaped —
// `renderRichText` and `renderCmsImage` — so they are set, not re-rendered.
const Section = ({ section }: { section: MarketingSection }) => {
  switch (section.type) {
    case "prose":
      return (
        <section className="marketing-prose">
          {section.heading && <h2>{section.heading}</h2>}
          <div dangerouslySetInnerHTML={{ __html: section.html }} />
        </section>
      );
    case "fullImage":
      return (
        <figure className="marketing-image">
          <div dangerouslySetInnerHTML={{ __html: section.html }} />
          {section.caption && <figcaption>{section.caption}</figcaption>}
        </figure>
      );
    case "ctaBanner":
      return (
        <section className="marketing-cta">
          <h2>{section.heading}</h2>
          {section.body && <p>{section.body}</p>}
          {section.action && (
            <ActionLink action={section.action} className="btn-primary" />
          )}
        </section>
      );
  }
};

export const Marketing = ({
  seo,
  content,
  user,
  csrfToken,
}: MarketingProps) => (
  <Layout
    title={seo.title}
    description={seo.description || undefined}
    canonicalPath={seo.canonicalPath}
    name="marketing"
    user={user}
    csrfToken={csrfToken}
  >
    {content.hero && (
      <section className="marketing-hero">
        <p className="hero-tag">{content.hero.tag}</p>
        <h1>{content.hero.heading}</h1>
        <p className="hero-sub">{content.hero.body}</p>
        {content.hero.actions.length > 0 && (
          <div className="hero-actions">
            {content.hero.actions.map((action, index) => (
              <ActionLink
                key={action.href}
                action={action}
                className={index === 0 ? "btn-primary" : "btn-ghost"}
              />
            ))}
          </div>
        )}
      </section>
    )}
    {content.sections.map((section, index) => (
      <Section key={index} section={section} />
    ))}
  </Layout>
);
