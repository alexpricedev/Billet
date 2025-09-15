import { BaseLayout } from "../components/layouts";

export interface LoginState {
  state?: "email-sent" | "validation-error";
  error?: string;
}

export interface LoginProps {
  state?: LoginState;
}

export const Login = ({ state }: LoginProps) => {
  return (
    <BaseLayout title="Login - SpeedLoaf">
      <main className="min-h-screen bg-gray-50 flex flex-col justify-center py-12 sm:px-6 lg:px-8">
        <div className="sm:mx-auto sm:w-full sm:max-w-md">
          <h2 className="mt-6 text-center text-3xl font-extrabold text-gray-900">
            Sign in to your account
          </h2>
          <p className="mt-2 text-center text-sm text-gray-600">
            We'll send you a magic link to sign in instantly
          </p>
        </div>

        <div className="mt-8 sm:mx-auto sm:w-full sm:max-w-md">
          <div className="bg-white py-8 px-4 shadow sm:rounded-lg sm:px-10">
            {state?.state === "email-sent" ? (
              <div className="rounded-md bg-green-50 p-4">
                <div className="text-sm text-green-700">
                  <p className="font-medium">Check your email!</p>
                  <p className="mt-1">
                    We've sent you a magic link. Click it to sign in instantly.
                  </p>
                  <p className="mt-2 text-xs text-green-600">
                    For testing: Check the server console for the magic link.
                  </p>
                </div>
              </div>
            ) : (
              <form method="POST" action="/login" className="space-y-6">
                {state?.state === "validation-error" && state.error && (
                  <div className="rounded-md bg-red-50 p-4">
                    <div className="text-sm text-red-700">{state.error}</div>
                  </div>
                )}

                <div>
                  <label
                    htmlFor="email"
                    className="block text-sm font-medium text-gray-700"
                  >
                    Email address
                  </label>
                  <div className="mt-1">
                    <input
                      id="email"
                      name="email"
                      type="email"
                      autoComplete="email"
                      required
                      className="appearance-none block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm placeholder-gray-400 focus:outline-none focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm"
                      placeholder="Enter your email"
                    />
                  </div>
                </div>

                <div>
                  <button
                    type="submit"
                    className="w-full flex justify-center py-2 px-4 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500"
                  >
                    Send magic link
                  </button>
                </div>
              </form>
            )}

            <div className="mt-6">
              <div className="text-center">
                <a
                  href="/"
                  className="text-sm text-indigo-600 hover:text-indigo-500"
                >
                  ← Back to home
                </a>
              </div>
            </div>
          </div>
        </div>
      </main>
    </BaseLayout>
  );
};
