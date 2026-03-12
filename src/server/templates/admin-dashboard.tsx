import { Layout } from "@server/components/layouts";
import type { SessionContext } from "@server/middleware/auth";
import type { User } from "@server/services/auth";

const formatDate = (date: Date): string =>
  new Date(date).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });

const RoleBadge = ({ role }: { role: User["role"] }) => {
  const styles =
    role === "admin"
      ? "bg-purple-100 text-purple-800"
      : "bg-gray-100 text-gray-800";
  return (
    <span
      className={`inline-block px-2 py-0.5 text-xs font-medium rounded-full ${styles}`}
    >
      {role}
    </span>
  );
};

export const AdminDashboard = (props: {
  auth: SessionContext;
  users: User[];
}) => (
  <Layout title="Admin" name="admin">
    <div className="container mx-auto px-4 py-8">
      <h1 className="text-3xl font-bold mb-8">Admin</h1>

      <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
        <table className="min-w-full divide-y divide-gray-200">
          <thead className="bg-gray-50">
            <tr>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                Email
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                Role
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                Joined
              </th>
            </tr>
          </thead>
          <tbody className="bg-white divide-y divide-gray-200">
            {props.users.length === 0 ? (
              <tr>
                <td
                  colSpan={3}
                  className="px-6 py-4 text-sm text-gray-500 text-center"
                >
                  No users found.
                </td>
              </tr>
            ) : (
              props.users.map((user) => (
                <tr key={user.id}>
                  <td className="px-6 py-4 text-sm text-gray-900">
                    {user.email}
                  </td>
                  <td className="px-6 py-4 text-sm">
                    <RoleBadge role={user.role} />
                  </td>
                  <td className="px-6 py-4 text-sm text-gray-500">
                    {formatDate(user.created_at)}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  </Layout>
);
