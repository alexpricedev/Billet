import type { JSX } from "react";
import { Layout } from "../components/layouts";
import type { Example } from "../services/example";

type ExamplesProps = {
  examples: Example[];
};

export const Examples = ({ examples }: ExamplesProps): JSX.Element => {
  return (
    <Layout title="Examples">
      <div className="container mx-auto px-4 py-8">
        <h1 className="text-3xl font-bold mb-8">Examples from Database</h1>

        {examples.length === 0 ? (
          <p className="text-gray-600">No examples found in the database.</p>
        ) : (
          <div className="grid gap-4">
            {examples.map((example) => (
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
