import { Layout } from "@server/components/layouts";
import { MyParagraph } from "@server/components/my-paragraph";

export const About = () => (
  <Layout title="About" name="about">
    <h1>About Page</h1>
    <section className="card">
      <p>
        This is the about page. Here you can describe your project, team, or
        purpose.
      </p>
      <MyParagraph>
        <span slot="my-text">Let's have some different text!</span>
      </MyParagraph>
    </section>
  </Layout>
);
