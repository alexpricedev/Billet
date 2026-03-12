export function toSlug(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

export function isValidDbUrl(url: string): boolean {
  return url.startsWith("postgresql://") || url.startsWith("postgres://");
}

export function generateEnvContent(dbUrl: string, pepper: string): string {
  return `DATABASE_URL=${dbUrl}\nCRYPTO_PEPPER=${pepper}\nAPP_URL=http://localhost\n`;
}

export function buildReadme(
  currentContent: string,
  displayName: string,
  slug: string,
): string {
  const lines = currentContent.split("\n");
  const sections = extractSections(lines);

  const quickStart = [
    "## Quick Start",
    "",
    "You'll need [Bun](https://bun.sh) and a local [PostgreSQL](https://www.postgresql.org/) instance running.",
    "",
    "```bash",
    "git clone <your-repo-url>",
    `cd ${slug}`,
    "bun install",
    "bun run setup",
    "```",
    "",
    "Then start developing:",
    "",
    "```bash",
    "bun run dev",
    "```",
    "",
    "Visit [http://localhost:3000](http://localhost:3000) — migrations and seeding run automatically on first start.",
  ].join("\n");

  let deploySection = sections["Deploy"];
  deploySection = deploySection.replace(
    /run `bun run generate:pepper` to get one \(see below\)/g,
    "generated during setup",
  );
  deploySection = deploySection.replace(
    /> \*\*Generating `CRYPTO_PEPPER`:\*\* This is a secret key used to secure session tokens\. Run `bun run generate:pepper` to get a value\. Use a different value for each environment \(development, production, etc\)\./g,
    "",
  );

  const kept = [
    `# ${displayName}`,
    "",
    "A full-stack TypeScript app built with Bun.",
    "",
    "---",
    "",
    sections["What's Included"],
    "",
    quickStart,
    "",
    "---",
    "",
    sections["Project Structure"],
    "",
    "---",
    "",
    sections["Contributing"],
    "",
    "---",
    "",
    deploySection,
    "",
    "---",
    "",
    sections["License"],
    "",
  ].join("\n");

  return kept.replace(/Billet/g, displayName).replace(/billet/g, slug);
}

export function renameInFile(
  content: string,
  displayName: string,
  slug: string,
): string {
  return content.replace(/Billet/g, displayName).replace(/billet/g, slug);
}

function extractSections(lines: string[]): Record<string, string> {
  const sections: Record<string, string> = {};
  let currentSection = "";
  let currentLines: string[] = [];

  for (const line of lines) {
    if (line.startsWith("## ")) {
      if (currentSection) {
        sections[currentSection] = trimSection(currentLines);
      }
      currentSection = line.replace("## ", "");
      currentLines = [line];
    } else if (currentSection) {
      currentLines.push(line);
    }
  }
  if (currentSection) {
    sections[currentSection] = trimSection(currentLines);
  }

  return sections;
}

function trimSection(lines: string[]): string {
  let end = lines.length;
  while (end > 0) {
    const line = lines[end - 1].trim();
    if (line === "" || line === "---" || line.startsWith("<") || line.startsWith("</")) {
      end--;
    } else {
      break;
    }
  }
  return lines.slice(0, end).join("\n");
}
