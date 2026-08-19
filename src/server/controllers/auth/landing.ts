import { getMembership } from "../../services/organizations";
import { teamsEnabled } from "../../services/teams-mode";

/**
 * Where a freshly authenticated user lands.
 *
 * `/team` is in no navigation — not the nav bar, and the `/account` section
 * only appears once you're already in a team — so a user without one has no
 * link to the create-a-team page anywhere in the app. Sending them there on
 * sign-in is the feature's only discovery path.
 *
 * Every sign-in goes through this, not just the first: "no team yet" is the
 * state the feature exists to get you out of, and someone who lands here twice
 * can still navigate away. Being in a team makes it stop.
 *
 * The teamsEnabled() check comes before the query on purpose. With the flag off
 * `/team` renders a 404, so a fork that never turned teams on would be sending
 * every sign-in to a dead page — and it pays for no lookup either.
 */
export const landingAfterAuth = async (userId: string): Promise<string> => {
  if (!teamsEnabled()) return "/";

  return (await getMembership(userId)) ? "/" : "/team";
};
