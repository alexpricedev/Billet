import type { JSX } from "preact";
import { CsrfField } from "../components/csrf-field";
import { DataTable } from "../components/data-table";
import { Flash } from "../components/flash";
import { FormField } from "../components/form-field";
import { Layout } from "../components/layouts";
import type {
  Organisation,
  OrganisationInvite,
  OrganisationMember,
} from "../services/organisations";
import type { User } from "../services/users";

export interface OrganisationState {
  state?:
    | "invite-sent"
    | "invite-revoked"
    | "validation-error"
    | "csrf-expired";
  error?: string;
  // Handed back so a rejected invitation doesn't cost the address that was typed.
  email?: string;
}

export type OrganisationProps = {
  organisation: Organisation;
  role: string;
  members: OrganisationMember[];
  invites: OrganisationInvite[];
  state: OrganisationState;
  inviteCsrfToken: string | null;
  revokeCsrfTokens: Record<string, string>;
  user: User | null;
  csrfToken?: string;
};

export const OrganisationPage = (props: OrganisationProps): JSX.Element => {
  const isOwner = props.role === "owner";

  return (
    <Layout
      title={`${props.organisation.name} - Billet`}
      description="Your organisation and the people in it."
      canonicalPath="/organisation"
      name="organisation"
      user={props.user}
      csrfToken={props.csrfToken}
      noindex
    >
      <h1>{props.organisation.name}</h1>
      <p className="lead">
        Everyone here shares one organisation. Each person belongs to exactly
        one.
      </p>

      {props.state?.state === "invite-sent" && (
        <Flash type="success">Invitation sent.</Flash>
      )}

      {props.state?.state === "invite-revoked" && (
        <Flash type="success">Invitation revoked.</Flash>
      )}

      {props.state?.state === "csrf-expired" && (
        <Flash type="warning">
          Your session timed out — nothing was sent. Try again.
        </Flash>
      )}

      {props.state?.state === "validation-error" && props.state.error && (
        <Flash type="error">{props.state.error}</Flash>
      )}

      <h2>Members</h2>
      <DataTable className="member-list" caption="Members">
        <thead>
          <tr>
            <th scope="col">Email</th>
            <th scope="col">Role</th>
          </tr>
        </thead>
        <tbody>
          {props.members.map((member) => (
            <tr key={member.user_id}>
              <td>
                {member.email}
                {member.user_id === props.user?.id && " (you)"}
              </td>
              <td>{member.role}</td>
            </tr>
          ))}
        </tbody>
      </DataTable>

      {isOwner ? (
        <>
          <section className="card">
            <h2>Invite someone</h2>
            <form method="POST" action="/organisation/invites">
              <CsrfField token={props.inviteCsrfToken} />
              <FormField label="Email address" id="invite-email">
                <input
                  id="invite-email"
                  type="email"
                  name="email"
                  autoComplete="off"
                  placeholder="them@example.com"
                  required
                  defaultValue={props.state?.email}
                />
              </FormField>
              <button type="submit">Send invitation</button>
            </form>
          </section>

          <h2>Pending invitations</h2>
          {props.invites.length === 0 ? (
            <p className="text-tertiary">No invitations outstanding.</p>
          ) : (
            <DataTable className="invite-list" caption="Pending invitations">
              <thead>
                <tr>
                  <th scope="col">Email</th>
                  <th scope="col">Expires</th>
                  <th scope="col">
                    <span className="sr-only">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {props.invites.map((invite) => (
                  <tr key={invite.id}>
                    <td>{invite.email}</td>
                    <td>{invite.expires_at.toISOString().slice(0, 10)}</td>
                    <td className="delete-cell">
                      {props.revokeCsrfTokens[invite.id] && (
                        <form
                          method="POST"
                          action={`/organisation/invites/${invite.id}/delete`}
                          className="delete-form"
                        >
                          <CsrfField
                            token={props.revokeCsrfTokens[invite.id]}
                          />
                          <button type="submit" className="delete-btn">
                            Revoke
                          </button>
                        </form>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </DataTable>
          )}
        </>
      ) : (
        <p className="text-tertiary">
          Only an owner can invite people to this organisation.
        </p>
      )}
    </Layout>
  );
};
