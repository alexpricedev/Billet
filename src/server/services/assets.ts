import { log } from "./logger";

const assetHashes = new Map<string, string>();

// The bundles `bun run build` produces. In production they get fingerprinted and
// hashed at boot; in development they are served un-hashed straight off disk, so
// the same list is what tells a missing dev bundle apart from a typo'd URL.
export const BUNDLE_FILENAMES = ["main.js", "captcha.js", "main.css"];
// Where the built bundles live. Deliberately not an env var: `--outdir
// ./dist/assets` is fixed in package.json, so an operator pointing this
// somewhere else would only break boot. The override exists for tests, which
// build fixture bundles and then delete the whole directory — with the path
// hardcoded that deletion took out the real dist/assets of whichever workspace
// ran the suite, leaving every page unstyled until the next `bun run build`.
let assetsDirOverride: string | null = null;

export const setAssetsDirForTest = (dir: string | null): void => {
  assetsDirOverride = dir;
};

export const assetsDir = (): string => assetsDirOverride ?? "dist/assets";

export const isBundleFilename = (filename: string): boolean =>
  BUNDLE_FILENAMES.includes(filename);

export async function initAssets(): Promise<void> {
  if (Bun.env.NODE_ENV !== "production") {
    return;
  }

  for (const filename of BUNDLE_FILENAMES) {
    const filePath = `${assetsDir()}/${filename}`;
    const file = Bun.file(filePath);

    if (!(await file.exists())) {
      throw new Error(`Asset file not found: ${filePath}`);
    }

    const contents = await file.arrayBuffer();
    const hasher = new Bun.CryptoHasher("md5");
    hasher.update(contents);
    const hash = hasher.digest("hex").slice(0, 8);

    assetHashes.set(filename, hash);

    log.info(
      "assets",
      `${filename} → ${filename.replace(/\.(\w+)$/, `.${hash}.$1`)}`,
    );
  }
}

// dist/ is gitignored and rebuilt by the dev watchers, so it can be missing (a
// fresh checkout) or half-there (something cleared it mid-session). Neither is
// fatal — the server still boots — but every page then renders unstyled with no
// explanation, so say so at boot with the command that fixes it. Production
// doesn't reach here: initAssets() throws on a missing asset instead.
export async function warnOnMissingDevBundles(): Promise<void> {
  if (Bun.env.NODE_ENV === "production") {
    return;
  }

  const missing: string[] = [];
  for (const filename of BUNDLE_FILENAMES) {
    const file = Bun.file(`${assetsDir()}/${filename}`);
    if (!(await file.exists()) || file.size === 0) {
      missing.push(filename);
    }
  }

  if (missing.length > 0) {
    log.warn(
      "assets",
      `${assetsDir()} is missing ${missing.join(", ")} — pages will render unstyled. Run \`bun run build\` to restore it.`,
    );
  }
}

export function getAssetUrl(path: string): string {
  if (Bun.env.NODE_ENV !== "production") {
    return path;
  }

  const filename = path.split("/").pop();
  if (!filename) {
    return path;
  }

  const hash = assetHashes.get(filename);
  if (!hash) {
    return path;
  }

  const hashedFilename = filename.replace(/\.(\w+)$/, `.${hash}.$1`);
  const lastIndex = path.lastIndexOf(filename);
  return path.substring(0, lastIndex) + hashedFilename;
}

const HASHED_ASSET_PATTERN = /^\/assets\/(\w+)\.([a-f0-9]{8})\.(js|css)$/;

export function handleAssetRequest(url: URL): Response | null {
  if (Bun.env.NODE_ENV !== "production") {
    return null;
  }

  const match = url.pathname.match(HASHED_ASSET_PATTERN);
  if (!match) {
    return null;
  }

  const [, basename, hash, extension] = match;
  const filename = `${basename}.${extension}`;
  const expectedHash = assetHashes.get(filename);

  if (hash !== expectedHash) {
    return new Response("Asset not found", { status: 404 });
  }

  const file = Bun.file(`${assetsDir()}/${filename}`);
  const contentType =
    extension === "js" ? "application/javascript" : "text/css";

  return new Response(file, {
    headers: {
      "Cache-Control": "public, max-age=31536000, immutable",
      "Content-Type": contentType,
    },
  });
}
