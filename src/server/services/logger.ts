export const log = {
  info(category: string, message: string): void {
    console.log(`[INFO] [${category}] ${message}`);
  },

  warn(category: string, message: string): void {
    console.warn(`[WARN] [${category}] ${message}`);
  },

  error(category: string, message: string): void {
    console.error(`[ERROR] [${category}] ${message}`);
  },
};

// OSC 8: terminals that support it (iTerm, Terminal.app, VS Code, most Linux
// emulators) render `text` as a clickable link to `url`; the rest ignore the
// escape and keep the text.
//
// A plain `process.stdout.isTTY` check is not enough to decide. `bun run dev`
// multiplexes the server's stdout through a pipe to prefix each line with
// `dev:server | `, so the process that prints this sees a pipe even while the
// developer watches it in a terminal — a strict TTY gate would hide the link in
// exactly the case it exists for. TERM survives that hop, so it stands in for
// "a terminal is reading this", with `TERM=dumb` the exception. CI and the
// usual opt-outs mean the output is being captured rather than watched, and a
// captured log wants no escape sequences in it at all.
export function link(url: string, text: string = url): string {
  const terminalReading =
    process.stdout.isTTY === true ||
    Boolean(process.env.TERM && process.env.TERM !== "dumb");

  const wantsLinks =
    terminalReading &&
    !process.env.CI &&
    !process.env.NO_COLOR &&
    !process.env.NO_HYPERLINK;

  if (!wantsLinks) {
    return text;
  }

  return `\x1b]8;;${url}\x1b\\${text}\x1b]8;;\x1b\\`;
}
