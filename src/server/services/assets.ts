import { log } from "./logger";

const assetHashes = new Map<string, string>();

const ASSETS_TO_HASH = ["main.js", "main.css"];
const DIST_ASSETS_PATH = "dist/assets";

export async function initAssets(): Promise<void> {
  if (Bun.env.NODE_ENV !== "production") {
    return;
  }

  for (const filename of ASSETS_TO_HASH) {
    const filePath = `${DIST_ASSETS_PATH}/${filename}`;
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

  const file = Bun.file(`${DIST_ASSETS_PATH}/${filename}`);
  const contentType =
    extension === "js" ? "application/javascript" : "text/css";

  return new Response(file, {
    headers: {
      "Cache-Control": "public, max-age=31536000, immutable",
      "Content-Type": contentType,
    },
  });
}
