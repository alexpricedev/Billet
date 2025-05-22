import { Layout } from "@server/components/layouts";

export const Home = ({ method }: { method: string }) => (
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
        Data from the server HTTP req: <strong>{method}</strong>
      </p>

      <h4>HTML response from a POST:</h4>
      <p>
        <code>
          <pre>
            {`...
  <p>
    Data from the server HTTP req: <strong>POST</strong>
  </p>
...`}
          </pre>
        </code>
      </p>
    </section>
  </Layout>
);
