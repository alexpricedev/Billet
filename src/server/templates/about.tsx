import { Layout } from "@server/components/layouts";

export const About = () => (
  <Layout title="About" name="about">
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
      <div className="flex items-center gap-3">
        <code className="bg-gray-100 px-3 py-1 rounded text-sm">
          bun run dev
        </code>
      </div>
    </section>
  </Layout>
);
