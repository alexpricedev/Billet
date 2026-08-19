import { describe, expect, test } from "bun:test";
import { render } from "preact-render-to-string";
import type { Invite } from "../services/invites";
import type { Member, Membership, OrgRole } from "../services/organizations";
import type { User } from "../services/users";
import { Team, type TeamProps } from "./team";

const user = (overrides: Partial<User> = {}): User => ({
  id: "user-1",
  email: "owner@example.com",
  role: "user",
  created_at: new Date("2026-01-01"),
  email_verified_at: new Date("2026-01-01"),
  ...overrides,
});

const member = (
  id: string,
  email: string,
  org_role: OrgRole = "member",
): Member => ({
  id,
  email,
  org_role,
  joined_at: new Date("2026-01-02"),
  email_verified_at: null,
  created_at: new Date("2026-01-01"),
});

const membership = (role: OrgRole = "owner"): Membership => ({
  org: { id: "org-1", name: "Acme", created_at: new Date("2026-01-01") },
  role,
  joinedAt: new Date("2026-01-01"),
});

const pending = (): Invite => ({
  id: "invite-1",
  organization_id: "org-1",
  email: "pending@example.com",
  org_role: "member",
  invited_by: "user-1",
  expires_at: new Date("2026-12-01"),
  created_at: new Date("2026-01-03"),
});

const props = (overrides: Partial<TeamProps> = {}): TeamProps => ({
  user: user(),
  csrfToken: "nav-token",
  membership: membership(),
  members: [member("user-1", "owner@example.com", "owner")],
  invites: [],
  createCsrfToken: null,
  inviteCsrfToken: "invite-token",
  roleCsrfTokens: {},
  removeCsrfToken: null,
  removeTarget: null,
  revokeCsrfTokens: {},
  ...overrides,
});

describe("Team template", () => {
  test("offers the create form when there is no team", () => {
    const html = render(
      <Team
        {...props({
          membership: null,
          members: [],
          createCsrfToken: "create-token",
          inviteCsrfToken: null,
        })}
      />,
    );

    expect(html).toContain("Create a team");
    expect(html).toContain('action="/team"');
    expect(html).not.toContain("Pending invitations");
  });

  test("lists members and pending invites separately", () => {
    const html = render(
      <Team
        {...props({
          members: [
            member("user-1", "owner@example.com", "owner"),
            member("user-2", "member@example.com"),
          ],
          invites: [pending()],
          revokeCsrfTokens: { "invite-1": "revoke-token" },
          roleCsrfTokens: { "user-2": "role-token" },
        })}
      />,
    );

    expect(html).toContain("Team members");
    expect(html).toContain("Pending invitations");
    expect(html).toContain("member@example.com");
    expect(html).toContain("pending@example.com");
    expect(html).toContain("/team/invites/invite-1/revoke");
  });

  test("does not offer a Remove control on your own row", () => {
    const html = render(
      <Team
        {...props({
          members: [
            member("user-1", "owner@example.com", "owner"),
            member("user-2", "member@example.com"),
          ],
          roleCsrfTokens: { "user-2": "role-token" },
        })}
      />,
    );

    expect(html).toContain("/team?remove=user-2");
    expect(html).not.toContain("/team?remove=user-1");
  });

  test("does not offer a role control on your own row", () => {
    const html = render(
      <Team
        {...props({
          user: user({ id: "user-2", email: "admin@example.com" }),
          membership: membership("admin"),
          members: [
            member("user-1", "owner@example.com", "owner"),
            member("user-2", "admin@example.com", "admin"),
            member("user-3", "member@example.com"),
          ],
          roleCsrfTokens: { "user-2": "self-token", "user-3": "role-token" },
        })}
      />,
    );

    expect(html).not.toContain("/team/members/user-2/role");
    expect(html).toContain("/team/members/user-3/role");
    expect(html).toContain("badge-admin");
  });

  test("hides the owner option from an admin", () => {
    const admin = render(
      <Team
        {...props({
          user: user({ id: "user-2", email: "admin@example.com" }),
          membership: membership("admin"),
          members: [member("user-3", "member@example.com")],
          roleCsrfTokens: { "user-3": "role-token" },
        })}
      />,
    );

    expect(admin).toContain('value="admin"');
    expect(admin).not.toContain('value="owner"');
  });

  test("an admin gets no controls at all on an owner's row", () => {
    const html = render(
      <Team
        {...props({
          user: user({ id: "user-2", email: "admin@example.com" }),
          membership: membership("admin"),
          members: [member("user-1", "owner@example.com", "owner")],
          roleCsrfTokens: { "user-1": "role-token" },
        })}
      />,
    );

    expect(html).not.toContain("/team/members/user-1/role");
    expect(html).not.toContain("/team?remove=user-1");
    expect(html).toContain("badge-owner");
  });

  test("the last owner cannot be demoted or removed from the UI", () => {
    const html = render(
      <Team
        {...props({
          members: [member("user-1", "owner@example.com", "owner")],
          roleCsrfTokens: { "user-1": "role-token" },
        })}
      />,
    );

    expect(html).not.toContain("/team/members/user-1/role");
    expect(html).not.toContain("/team?remove=user-1");
  });

  test("names the person in each row control, not just the column", () => {
    const html = render(
      <Team
        {...props({
          members: [
            member("user-1", "owner@example.com", "owner"),
            member("user-2", "member@example.com"),
          ],
          roleCsrfTokens: { "user-2": "role-token" },
        })}
      />,
    );

    expect(html).toContain("Role for member@example.com");
    expect(html).toContain("<caption");
  });

  test("the remove confirmation names the person and the consequence", () => {
    const target = member("user-2", "member@example.com");
    const html = render(
      <Team
        {...props({
          members: [member("user-1", "owner@example.com", "owner"), target],
          removeTarget: target,
          removeCsrfToken: "remove-token",
        })}
      />,
    );

    expect(html).toContain('id="confirm-remove"');
    expect(html).toContain("member@example.com");
    expect(html).toContain("new invitation");
    expect(html).toContain('action="/team/members/user-2/remove"');
  });
});
