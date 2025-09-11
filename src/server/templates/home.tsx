import { Layout } from "@server/components/layouts";
import type { VisitorStats } from "@server/services/analytics";

export const Home = (props: { method: string; stats: VisitorStats }) => (
  <Layout title="Home" name="home">
    <h1>Home Page</h1>

    <section>
      <p>
        Fully server rendered.
        <br />
        Simple client side interactivity and styles.
        <br />
        All JS/JSX is written in TypeScript, powered by Bun.
      </p>

      <h3>Client JS:</h3>
      <p>
        You clicked the button <span id="count">0</span> times.
      </p>
      <button id="counter" type="button">
        Click me
      </button>

      <h3>Server data:</h3>
      <p>
        Data from the server HTTP req: <strong>{props.method}</strong>
      </p>

      <h3>API data:</h3>
      <p>
        Visitor count: <strong>{props.stats.visitorCount}</strong>
        <br />
        <small>
          Last updated: {new Date(props.stats.lastUpdated).toLocaleString()}
        </small>
      </p>
    </section>
  </Layout>
);
