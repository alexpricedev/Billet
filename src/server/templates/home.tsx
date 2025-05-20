import { Layout } from "@server/components/layouts";

export const Home = ({ method }: { method: string }) => (
  <Layout title="Home" name="home">
    <h1>Home Page</h1>

    <section className="card">
      <p>
        You clicked the button <span id="count">0</span> times.
      </p>
      <button id="counter" type="button">
        Click me
      </button>
    </section>

    <section>
      <p>Welcome to your modern Bun + React 19 + TSX starter kit!</p>
      <p>Request method: {method}</p>
    </section>
  </Layout>
);
