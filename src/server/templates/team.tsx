import { Badge } from "../components/badge";
import { CsrfField } from "../components/csrf-field";
import { DataTable } from "../components/data-table";
import { Flash } from "../components/flash";
import { FormField } from "../components/form-field";
import { Layout } from "../components/layouts";
import type { Invite } from "../services/invites";
import {
  MAX_ORG_NAME_LENGTH,
  type Member,
  type Membership,
  type OrgRole,
} from "../services/organizations";
import type { User } from "../services/users";

export interface TeamState {
  state?:
    | "team-created"
    | "invite-sent"
    | "invite-revoked"
    | "invite-gone"
    | "invite-failed"
    | "role-changed"
    | "member-removed"
    | "member-gone"
    | "owner-only"
    | "last-owner"
    | "already-member"
    | "already-in-org"
    | "too-many-invites"
    | "invalid-email"
    | "invalid-role"
    | "invalid-name"
    | "csrf-expired"
    | "action-csrf-expired";
  email?: string;
  name?: string;
  org_role?: OrgRole;
}

export interface TeamProps {
  user: User;
  csrfToken?: string;
  membership: Membership | null;
  members: Member[];
  invites: Invite[];
  createCsrfToken: string | null;
  inviteCsrfToken: string | null;
  roleCsrfTokens: Record<string, string>;
  removeCsrfToken: string | null;
  removeTarget: Member | null;
  revokeCsrfTokens: Record<string, string>;
  state?: TeamState;
}

const formatDate = (date: Date): string =>
  date.toLocaleDateString("en-GB", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });

const roleBadge = (role: OrgRole) => <Badge variant={role}>{role}</Badge>;

export const Team = (props: TeamProps) => (
  <Layout
    title="Team - Billet"
    name="team"
    description="Manage your team members and invitations."
    canonicalPath="/team"
    user={props.user}
    csrfToken={props.csrfToken}
    noindex
  >
    <h1>Team</h1>

    <TeamFlash state={props.state} />

    {props.membership ? (
      <>
        <p className="text-quaternary">
          {props.membership.org.name} — you're{" "}
          {props.membership.role === "owner" ? "the owner" : "an admin"}.
        </p>

        {props.removeTarget && props.removeCsrfToken && (
          <section className="card team-confirm">
            <h2 id="confirm-remove">
              Remove {props.removeTarget.email} from {props.membership.org.name}
              ?
            </h2>
            <p>
              They'll lose access straight away and will need a new invitation
              to come back. Their account itself isn't deleted.
            </p>
            <form
              method="post"
              action={`/team/members/${props.removeTarget.id}/remove`}
              className="team-confirm-actions"
            >
              <CsrfField token={props.removeCsrfToken} />
              <button type="submit" className="btn-danger">
                Remove {props.removeTarget.email}
              </button>
              <a href="/team" className="btn-ghost">
                Cancel
              </a>
            </form>
          </section>
        )}

        <section className="card">
          <h2>Members</h2>
          <MembersTable {...props} membership={props.membership} />
        </section>

        <section className="card">
          <h2>Invite someone</h2>
          <form method="post" action="/team/invites" className="team-invite">
            <CsrfField token={props.inviteCsrfToken} />

            <FormField label="Email address" id="invite-email">
              <input
                id="invite-email"
                name="email"
                type="email"
                autoComplete="off"
                required
                maxLength={254}
                value={props.state?.email ?? ""}
              />
            </FormField>

            {/* Owner is not offered: ownership is granted from the members
                table by an existing owner, never handed to an address that
                hasn't accepted yet. */}
            <FormField label="Role" id="invite-role">
              <select id="invite-role" name="org_role">
                <option value="member">Member</option>
                <option value="admin">Admin</option>
              </select>
            </FormField>

            <button type="submit">Send invitation</button>
          </form>
        </section>

        {props.invites.length > 0 && (
          <section className="card">
            <h2>Pending invitations</h2>
            <DataTable caption="Pending invitations">
              <thead>
                <tr>
                  <th scope="col">Email</th>
                  <th scope="col">Role</th>
                  <th scope="col">Invited</th>
                  <th scope="col">
                    <span className="sr-only">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {props.invites.map((invite) => (
                  <tr key={invite.id}>
                    <td>{invite.email}</td>
                    <td>{roleBadge(invite.org_role)}</td>
                    <td>{formatDate(invite.created_at)}</td>
                    <td>
                      <form
                        method="post"
                        action={`/team/invites/${invite.id}/revoke`}
                      >
                        <CsrfField
                          token={props.revokeCsrfTokens[invite.id] ?? null}
                        />
                        <button type="submit" className="btn-ghost">
                          Revoke
                          <span className="sr-only">
                            {" "}
                            invitation for {invite.email}
                          </span>
                        </button>
                      </form>
                    </td>
                  </tr>
                ))}
              </tbody>
            </DataTable>
          </section>
        )}
      </>
    ) : (
      <section className="card">
        <h2>Create a team</h2>
        <p>
          You're not in a team yet. Create one and you'll be its owner, able to
          invite others and manage what they can do.
        </p>
        <form method="post" action="/team">
          <CsrfField token={props.createCsrfToken} />
          <FormField label="Team name" id="team-name">
            <input
              id="team-name"
              name="name"
              type="text"
              required
              maxLength={MAX_ORG_NAME_LENGTH}
              value={props.state?.name ?? ""}
            />
          </FormField>
          <button type="submit">Create team</button>
        </form>
      </section>
    )}
  </Layout>
);

const MembersTable = ({
  members,
  membership,
  roleCsrfTokens,
  user,
}: TeamProps & { membership: Membership }) => {
  const ownerCount = members.filter((m) => m.org_role === "owner").length;

  return (
    <DataTable caption="Team members">
      <thead>
        <tr>
          <th scope="col">Email</th>
          <th scope="col">Role</th>
          <th scope="col">Joined</th>
          <th scope="col">
            <span className="sr-only">Actions</span>
          </th>
        </tr>
      </thead>
      <tbody>
        {members.map((member) => {
          const isSelf = member.id === user.id;
          const isLastOwner = member.org_role === "owner" && ownerCount === 1;
          // Whether the *server* would allow it. The controls below are hidden
          // to match, but hiding them is cosmetic — the server decides.
          const touchesOwnership = member.org_role === "owner";
          const mayChange =
            !isLastOwner && (!touchesOwnership || membership.role === "owner");

          return (
            <tr key={member.id}>
              <td>{member.email}</td>
              <td>
                {mayChange ? (
                  <form
                    method="post"
                    action={`/team/members/${member.id}/role`}
                    className="team-role-form"
                  >
                    <CsrfField token={roleCsrfTokens[member.id] ?? null} />
                    {/* The visible column header isn't announced per control,
                        so the label names the person. No auto-submit on change
                        — that is a WCAG 3.2.2 On Input failure and would need
                        client JS this page doesn't ship. */}
                    <label
                      className="sr-only"
                      htmlFor={`org-role-${member.id}`}
                    >
                      Role for {member.email}
                    </label>
                    <select
                      id={`org-role-${member.id}`}
                      name="org_role"
                      defaultValue={member.org_role}
                    >
                      <option value="member">Member</option>
                      <option value="admin">Admin</option>
                      {membership.role === "owner" && (
                        <option value="owner">Owner</option>
                      )}
                    </select>
                    <button type="submit" className="btn-ghost">
                      Save
                    </button>
                  </form>
                ) : (
                  roleBadge(member.org_role)
                )}
              </td>
              <td>{formatDate(member.org_joined_at)}</td>
              <td>
                {isSelf || isLastOwner || !mayChange ? null : (
                  <a
                    href={`/team?remove=${member.id}#confirm-remove`}
                    className="btn-ghost"
                  >
                    Remove
                    <span className="sr-only"> {member.email}</span>
                  </a>
                )}
              </td>
            </tr>
          );
        })}
      </tbody>
    </DataTable>
  );
};

const TeamFlash = ({ state }: { state?: TeamState }) => {
  if (!state?.state) return null;

  const success: Partial<Record<NonNullable<TeamState["state"]>, string>> = {
    "team-created": "Team created. You're the owner.",
    "invite-sent": `Invitation sent to ${state.email}.`,
    "invite-revoked": "Invitation revoked.",
    "role-changed": `${state.email} is now ${state.org_role}.`,
    "member-removed": `${state.email} has been removed from the team.`,
  };

  const warning: Partial<Record<NonNullable<TeamState["state"]>, string>> = {
    "csrf-expired": "Your session timed out — nothing was sent. Try again.",
    "action-csrf-expired":
      "Your session timed out — nothing changed. Try again.",
  };

  const error: Partial<Record<NonNullable<TeamState["state"]>, string>> = {
    "invite-failed": `${state.email} was invited, but the email couldn't be sent. Revoke it and try again.`,
    "invite-gone": "That invitation no longer exists.",
    "member-gone": "That person is no longer in your team.",
    "owner-only": "Only an owner can grant or change ownership.",
    "last-owner":
      "A team needs at least one owner. Make someone else an owner first.",
    "already-member": `${state.email} is already in your team.`,
    "already-in-org": "You're already in a team.",
    "too-many-invites":
      "You've hit the limit for pending invitations. Revoke some first.",
    "invalid-email": "Enter a valid email address.",
    "invalid-role": "Pick a valid role.",
    "invalid-name": `Team name is required and must be ${MAX_ORG_NAME_LENGTH} characters or fewer.`,
  };

  if (success[state.state]) {
    return (
      <Flash type="success">
        <span>{success[state.state]}</span>
      </Flash>
    );
  }

  if (warning[state.state]) {
    return (
      <Flash type="warning">
        <span>{warning[state.state]}</span>
      </Flash>
    );
  }

  return (
    <Flash type="error">
      <span>{error[state.state]}</span>
    </Flash>
  );
};
