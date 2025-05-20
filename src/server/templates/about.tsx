import { Layout } from "@server/components/layouts";
import { MyParagraph } from "@server/components/my-paragraph";

export const About = () => (
  <Layout title="About" scriptName="about">
    <h1>About Page</h1>
    <p>This is the about page.</p>

    <MyParagraph>
      <span slot="my-text">Let's have some different text!</span>
    </MyParagraph>
  </Layout>
);
