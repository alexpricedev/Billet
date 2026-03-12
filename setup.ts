import { randomBytes } from "crypto";
import { existsSync, readFileSync, writeFileSync } from "fs";
import { resolve } from "path";

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

function ask(question: string): string {
  const answer = prompt(question);
  if (answer === null) {
    console.log("\nSetup cancelled.");
    process.exit(0);
  }
  return answer;
}

function askProjectName(): string {
  while (true) {
    const name = ask("What would you like to call your project?");
    const trimmed = name.trim();
    if (trimmed.length === 0) {
      console.log("Project name cannot be empty. Please try again.");
      continue;
    }
    if (toSlug(trimmed).length === 0) {
      console.log(
        "Project name must contain at least one letter or number. Please try again.",
      );
      continue;
    }
    return trimmed;
  }
}

function askDbUrl(slug: string): string {
  console.log(`
You'll need a PostgreSQL database. If you have PostgreSQL running locally, create one with:

  CREATE DATABASE "${slug}";

Your URL will look like: postgresql://user:password@localhost:5432/${slug}

Alternatively, ask your coding agent to set up a local PostgreSQL database for you.
`);
  while (true) {
    const url = ask("PostgreSQL connection URL:");
    const trimmed = url.trim();
    if (isValidDbUrl(trimmed)) return trimmed;
    console.log('URL must start with "postgresql://" or "postgres://". Please try again.');
  }
}

function checkEnvGuard(): void {
  if (existsSync(resolve(".", ".env"))) {
    const answer = ask("A .env file already exists. Overwrite? (y/N)");
    if (answer.trim().toLowerCase() !== "y") {
      console.log("Setup cancelled.");
      process.exit(0);
    }
  }
}

async function main(): Promise<void> {
  console.log("\n🔧 Project Setup\n");

  checkEnvGuard();

  // Step 1: Project name
  const displayName = askProjectName();
  const slug = toSlug(displayName);
  console.log(`\nProject: ${displayName} (${slug})\n`);

  // Step 2: Database URL
  const dbUrl = askDbUrl(slug);

  // Step 3: Generate pepper
  const pepper = randomBytes(32).toString("hex");

  // Step 4: Write .env
  const envContent = generateEnvContent(dbUrl, pepper);
  writeFileSync(resolve(".", ".env"), envContent);
  console.log("\n✓ Created .env");

  // Step 5a: Strip marketing and rename README
  try {
    const readmePath = resolve(".", "README.md");
    const readmeContent = readFileSync(readmePath, "utf-8");
    const newReadme = buildReadme(readmeContent, displayName, slug);
    writeFileSync(readmePath, newReadme);
    console.log("✓ Updated README.md");
  } catch (e) {
    console.error("⚠ Could not update README.md:", (e as Error).message);
  }

  // Step 5b: Rename in other files
  const filesToRename = [
    "SECURITY.md",
    "src/server/templates/login.tsx",
  ];

  for (const filePath of filesToRename) {
    try {
      const fullPath = resolve(".", filePath);
      const content = readFileSync(fullPath, "utf-8");
      const newContent = renameInFile(content, displayName, slug);
      writeFileSync(fullPath, newContent);
      console.log(`✓ Updated ${filePath}`);
    } catch (e) {
      console.error(`⚠ Could not update ${filePath}:`, (e as Error).message);
    }
  }

  // Step 5c: Rename in package.json (special handling for name field)
  try {
    const pkgPath = resolve(".", "package.json");
    const pkgContent = readFileSync(pkgPath, "utf-8");
    const pkg = JSON.parse(pkgContent);
    pkg.name = slug;
    writeFileSync(pkgPath, `${JSON.stringify(pkg, null, 2)}\n`);
    console.log("✓ Updated package.json");
  } catch (e) {
    console.error("⚠ Could not update package.json:", (e as Error).message);
  }

  // Step 6: Success
  console.log(`
Done! Your project "${displayName}" is ready.

Run 'bun run dev' to start developing!

Migrations and seeding will happen automatically on first start.
`);
}

if (import.meta.main) {
  main().catch((e: Error) => {
    console.error("Setup failed:", e.message);
    process.exit(1);
  });
}
