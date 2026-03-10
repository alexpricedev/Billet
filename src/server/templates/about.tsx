import { CopyButton, CopyButtonTemplate } from "@server/components/copy-button";
import { Layout } from "@server/components/layouts";

export const About = () => (
  <Layout title="About" name="about">
    <CopyButtonTemplate />
    <h1>About Page</h1>
    <section className="card">
      <p>
        The background of this page is different becuase of the auto-mounting
        client JS for this specific page.
      </p>
      <p>
        The title colour is also different because of the page-by-page custom
        CSS.
      </p>
      <p>And this is a custom web component! 👇</p>
      <div className="flex items-center gap-3">
        <code className="bg-gray-100 px-3 py-1 rounded text-sm">
          bun run dev
        </code>
        <CopyButton value="bun run dev" />
      </div>
      <p className="text-sm text-gray-500 mt-2">
        A <code>&lt;copy-button&gt;</code> web component with shadow DOM, scoped
        styles, and attribute observation.
      </p>
    </section>
  </Layout>
);
