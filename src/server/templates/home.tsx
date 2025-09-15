import { CsrfField } from "@server/components/csrf-field";
import { Layout } from "@server/components/layouts";
import type { AuthContext } from "@server/middleware/auth";
import type { VisitorStats } from "@server/services/analytics";

export const Home = (props: {
  method: string;
  stats: VisitorStats;
  auth: AuthContext;
  csrfToken: string | null;
}) => (
  <Layout title="Home" name="home">
    <div className="flex justify-between items-center mb-6">
      <h1>Home Page</h1>
      <div className="flex items-center gap-4">
        {props.auth.isAuthenticated ? (
          <div className="flex items-center gap-4">
            <span className="text-sm text-gray-600">
              Welcome, {props.auth.user?.email}
            </span>
            <form method="POST" action="/auth/logout">
              <CsrfField token={props.csrfToken} />
              <button
                type="submit"
                className="bg-red-600 hover:bg-red-700 text-white text-sm px-3 py-1 rounded"
              >
                Logout
              </button>
            </form>
          </div>
        ) : (
          <a
            href="/login"
            className="bg-indigo-600 hover:bg-indigo-700 text-white text-sm px-3 py-1 rounded"
          >
            Login
          </a>
        )}
      </div>
    </div>

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

      <h3>Tailwind support:</h3>
      <div role="alert" className="border-s-4 border-red-700 bg-red-50 p-4">
        <div className="flex items-center gap-2 text-red-700">
          <svg
            aria-hidden="true"
            aria-label="Alert icon"
            className="size-5"
            fill="currentColor"
            viewBox="0 0 24 24"
            xmlns="http://www.w3.org/2000/svg"
          >
            <path
              fillRule="evenodd"
              d="M9.401 3.003c1.155-2 4.043-2 5.197 0l7.355 12.748c1.154 2-.29 4.5-2.599 4.5H4.645c-2.309 0-3.752-2.5-2.598-4.5L9.4 3.003zM12 8.25a.75.75 0 01.75.75v3.75a.75.75 0 01-1.5 0V9a.75.75 0 01.75-.75zm0 8.25a.75.75 0 100-1.5.75.75 0 000 1.5z"
              clipRule="evenodd"
            />
          </svg>

          <strong className="font-medium"> Something went wrong </strong>
        </div>

        <p className="mt-2 text-sm text-red-700">
          Lorem ipsum dolor sit amet consectetur, adipisicing elit. Nemo quasi
          assumenda numquam deserunt consectetur autem nihil quos debitis dolor
          culpa.
        </p>
      </div>
    </section>
  </Layout>
);
