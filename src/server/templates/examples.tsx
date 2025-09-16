import type { JSX } from "react";
import { CsrfField } from "../components/csrf-field";
import { Layout } from "../components/layouts";
import type { Example } from "../services/example";

export interface ExamplesState {
  state?: "submission-success" | "deletion-success";
}

type PublicExamplesProps = {
  isAuthenticated: false;
  examples: Example[];
};

type AuthExamplesProps = {
  isAuthenticated: true;
  examples: Example[];
  state: ExamplesState;
  createCsrfToken: string | null;
  deleteCsrfTokens: Record<number, string>;
};

export type ExamplesProps = PublicExamplesProps | AuthExamplesProps;

export const Examples = (props: ExamplesProps): JSX.Element => {
  return (
    <Layout title="Examples" name="examples">
      <div className="container mx-auto px-4 py-8">
        <h1 className="text-3xl font-bold mb-8">Examples from Database</h1>

        {props.isAuthenticated && props.state?.state && (
          <div className="bg-green-50 border border-green-200 text-green-800 px-4 py-3 rounded mb-6">
            {props.state.state === "submission-success" &&
              "✅ Example added successfully!"}
            {props.state.state === "deletion-success" &&
              "🗑️ Example deleted successfully!"}
          </div>
        )}

        <div className="bg-white border border-gray-200 rounded-lg p-6 mb-6">
          <h2 className="text-xl font-semibold mb-4">Add New Example</h2>
          {props.isAuthenticated ? (
            <form method="POST" action="/examples" className="flex gap-3">
              <CsrfField token={props.createCsrfToken} />
              <input
                type="text"
                name="name"
                placeholder="Enter example name"
                required
                minLength={2}
                className="flex-1 px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              />
              <button
                type="submit"
                className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2"
              >
                Add Example
              </button>
            </form>
          ) : (
            <div className="bg-yellow-50 border border-yellow-200 text-yellow-800 px-4 py-3 rounded">
              <p>
                Please{" "}
                <a href="/login" className="underline">
                  log in
                </a>{" "}
                to add examples.
              </p>
            </div>
          )}
        </div>

        {props.examples.length === 0 ? (
          <p className="text-gray-600">No examples found in the database.</p>
        ) : (
          <div className="grid gap-4">
            {props.examples.map((example) => (
              <div
                key={example.id}
                className="bg-white border border-gray-200 rounded-lg p-4 shadow-sm"
              >
                <div className="flex justify-between items-center">
                  <div>
                    <span className="text-sm text-gray-500">
                      ID: {example.id}
                    </span>
                    <h2 className="text-lg font-semibold">{example.name}</h2>
                  </div>
                  {props.isAuthenticated &&
                    props.deleteCsrfTokens[example.id] && (
                      <form
                        method="POST"
                        action={`/examples/${example.id}/delete`}
                        className="inline"
                      >
                        <CsrfField token={props.deleteCsrfTokens[example.id]} />
                        <button
                          type="submit"
                          className="px-3 py-1 bg-red-600 text-white text-sm rounded-md hover:bg-red-700 focus:outline-none focus:ring-2 focus:ring-red-500 focus:ring-offset-2"
                          onClick={(e) => {
                            if (
                              !confirm(
                                `Are you sure you want to delete "${example.name}"?`,
                              )
                            ) {
                              e.preventDefault();
                            }
                          }}
                        >
                          Delete
                        </button>
                      </form>
                    )}
                </div>
              </div>
            ))}
          </div>
        )}

        <div className="mt-8">
          <h2 className="text-xl font-semibold mb-4">API Endpoints</h2>
          <div className="bg-gray-50 rounded-lg p-4">
            <ul className="space-y-2 text-sm font-mono">
              <li>
                <span className="text-green-600">GET</span> /api/examples - List
                all examples
              </li>
              <li>
                <span className="text-blue-600">POST</span> /api/examples -
                Create new example
              </li>
              <li>
                <span className="text-green-600">GET</span> /api/examples/:id -
                Get specific example
              </li>
              <li>
                <span className="text-orange-600">PUT</span> /api/examples/:id -
                Update example
              </li>
              <li>
                <span className="text-red-600">DELETE</span> /api/examples/:id -
                Delete example
              </li>
            </ul>
          </div>
        </div>
      </div>
    </Layout>
  );
};
