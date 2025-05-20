import { Layout } from "../components/layouts";

export function Home() {
  return (
    <Layout title="Home" scriptName="home">
      <h1>Home Page</h1>
      <p>
        You clicked the button <span id="count">0</span> times.
      </p>
      <button id="counter">Click me</button>
    </Layout>
  );
}
