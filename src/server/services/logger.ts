// Two formats, decided on every call. Plain — `[INFO] [category] message` — is
// the contract: production, CI, the test suite and anything that parses a log
// get exactly that, and it does not change. Pretty is for a person watching the
// dev server, usually in a panel some forty columns wide where `bun run dev`
// has already spent thirteen on its `dev:server | ` prefix: the level goes,
// the brackets go, and `detail` lines are not printed at all.
//
// LOG_FORMAT=pretty|plain forces one. Unset, or set to anything else, it is
// pretty only when a terminal is reading, outside CI and outside production.
// A typo falling back to that is fine: the worst a wrong value does is cosmetic.
export const prettyLogs = (): boolean => {
  const format = process.env.LOG_FORMAT;
  if (format === "pretty") return true;
  if (format === "plain") return false;

  return (
    terminalReading() &&
    !process.env.CI &&
    process.env.NODE_ENV !== "production"
  );
};

// A plain `process.stdout.isTTY` check is not enough to decide. `bun run dev`
// multiplexes the server's stdout through a pipe to prefix each line with
// `dev:server | `, so the process that prints this sees a pipe even while the
// developer watches it in a terminal. TERM survives that hop, so it stands in
// for "a terminal is reading this", with `TERM=dumb` the exception.
const terminalReading = (): boolean =>
  process.stdout.isTTY === true ||
  Boolean(process.env.TERM && process.env.TERM !== "dumb");

const paint = (code: number, reset: number, text: string): string =>
  process.env.NO_COLOR ? text : `\x1b[${code}m${text}\x1b[${reset}m`;

// Exported for output that is laid out rather than logged (utils/startup.ts).
export const dim = (text: string): string => paint(2, 22, text);

const format = (
  level: "INFO" | "WARN" | "ERROR",
  category: string,
  message: string,
): string => {
  if (!prettyLogs()) return `[${level}] [${category}] ${message}`;

  const line = `${dim(category)}  ${message}`;
  if (level === "WARN") return `${paint(33, 39, "warn")} ${line}`;
  if (level === "ERROR") return `${paint(31, 39, "error")} ${line}`;
  return line;
};

export const log = {
  info(category: string, message: string): void {
    console.log(format("INFO", category, message));
  },

  warn(category: string, message: string): void {
    console.warn(format("WARN", category, message));
  },

  error(category: string, message: string): void {
    console.error(format("ERROR", category, message));
  },

  // An info line nobody watching acts on — "Environment variables validated",
  // "No pending migrations". Plain logs keep it, because a captured boot log
  // is read for exactly that kind of confirmation; pretty drops it.
  detail(category: string, message: string): void {
    if (prettyLogs()) return;
    log.info(category, message);
  },

  // A bare line, for output that is laid out rather than logged (the startup
  // block). Here because `noConsole` is an error everywhere else.
  line(text: string): void {
    console.log(text);
  },
};

// Whether an OSC 8 hyperlink will be rendered rather than printed as noise.
// CI and the usual opt-outs mean the output is being captured rather than
// watched, and a captured log wants no escape sequences in it at all. Exported
// because a caller that hides a URL behind a short label has to know whether
// the label will actually be clickable.
export const linksSupported = (): boolean =>
  terminalReading() &&
  !process.env.CI &&
  !process.env.NO_COLOR &&
  !process.env.NO_HYPERLINK;

// OSC 8: terminals that support it (iTerm, Terminal.app, VS Code, most Linux
// emulators) render `text` as a clickable link to `url`; the rest ignore the
// escape and keep the text.
export function link(url: string, text: string = url): string {
  if (!linksSupported()) {
    return text;
  }

  return `\x1b]8;;${url}\x1b\\${text}\x1b]8;;\x1b\\`;
}
