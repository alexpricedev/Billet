import {
  DEV_LOGIN_ACCOUNTS,
  type DevLoginAccount,
  devLoginEnabled,
  devLoginUrl,
} from "../services/dev-login";
import { dim, link } from "../services/logger";

type StartupOptions = {
  port: number;
  /** `prettyLogs()` — a laid-out block rather than log messages. */
  pretty: boolean;
  /** `linksSupported()` — whether a short label can stand in for a URL. */
  links: boolean;
  /** When the server started listening; the block is headed with it. */
  at?: Date;
};

// As wide as the rows under it, so it reads as their heading.
const RULE_WIDTH = 24;

const pad = (n: number): string => String(n).padStart(2, "0");

// `bun --watch` restarts the server on every save and each restart prints the
// block again, so a run of them is otherwise a wall of identical rows. The rule
// separates one start from the next and the time says which is the latest.
const rule = (at: Date): string => {
  const time = `${pad(at.getHours())}:${pad(at.getMinutes())}:${pad(at.getSeconds())}`;
  const head = `── ${time} `;
  return dim(head + "─".repeat(RULE_WIDTH - head.length));
};

const accounts = (): DevLoginAccount[] =>
  devLoginEnabled()
    ? (Object.keys(DEV_LOGIN_ACCOUNTS) as DevLoginAccount[])
    : [];

/**
 * What the server says once it is listening: where it is, and the dev sign-in
 * links when those are on.
 *
 * Plain returns log messages, one per fact, with every URL spelled out. Pretty
 * returns a block to print as-is, built to fit beside `bun run dev`'s
 * `dev:server | ` prefix in a panel about forty columns wide — a sign-in URL
 * is over a hundred characters, so there the account name is the link and the
 * URL is not shown at all. That only works where a link renders: without one
 * the name would be a dead word hiding the only way in, so the URLs come back.
 *
 * Built from the bound port rather than APP_URL so every link points at the
 * process that just started: `dev` and each Conductor workspace listen on
 * their own port, and outside dev APP_URL would send the click to the deployed
 * site instead of the local listen this reports.
 */
export const startupLines = ({
  port,
  pretty,
  links,
  at = new Date(),
}: StartupOptions): string[] => {
  const url = `http://localhost:${port}`;

  if (!pretty) {
    return [
      `Listening on ${link(url)}`,
      ...accounts().map(
        (account) =>
          `Sign in as ${DEV_LOGIN_ACCOUNTS[account].email} (${account}): ${link(devLoginUrl(port, account))}`,
      ),
    ];
  }

  const server = "Server";
  const signIn = "Sign in";
  const width = Math.max(server.length, signIn.length);
  const row = (label: string, value: string): string =>
    `${label.padEnd(width)}  ${value}`;

  // Where a link renders the scheme is dropped from what is shown: those seven
  // characters are what pushed this row past the edge of the panel.
  const rows = [row(server, links ? link(url, `localhost:${port}`) : url)];

  if (accounts().length > 0) {
    if (links) {
      rows.push(
        row(
          signIn,
          accounts()
            .map((account) => link(devLoginUrl(port, account), account))
            .join(" · "),
        ),
      );
    } else {
      for (const account of accounts()) {
        rows.push(`${signIn} as ${account}`, devLoginUrl(port, account));
      }
    }
  }

  return ["", rule(at), ...rows];
};
