import { Layout } from "@server/components/layouts";

export const Home = ({ method }: { method: string }) => (
  <Layout title="Home" scriptName="home">
    <h1>Home Page</h1>
    <p>
      You clicked the button <span id="count">0</span> times.
    </p>
    <p>Request method: {method}</p>
    <button id="counter" type="button">
      Click me
    </button>
  </Layout>
);
