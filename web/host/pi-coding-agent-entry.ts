import { existsSync, readFileSync, realpathSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export const PI_CODING_AGENT_PACKAGE = "@earendil-works/pi-coding-agent";
export const PI_SERVER_PACKAGE = "@earendil-works/pi-server";
export const PI_CODING_AGENT_ENTRY_ENV = "OPENPI_PI_CODING_AGENT_ENTRY";
const PACKAGE_ROOT_SEARCH_DEPTH = 10;

export function findPackageRoot(realPath: string, packageName: string) {
  let dir = dirname(realPath);
  for (let depth = 0; depth < PACKAGE_ROOT_SEARCH_DEPTH; depth++) {
    const manifestPath = join(dir, "package.json");
    if (existsSync(manifestPath)) {
      const manifest: { name?: unknown } = JSON.parse(
        readFileSync(manifestPath, "utf8"),
      );
      if (manifest.name === packageName) return dir;
    }
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return undefined;
}

function packageEntry(root: string | undefined) {
  if (!root) return undefined;
  const entry = join(root, "dist", "index.js");
  return existsSync(entry) ? entry : undefined;
}

function walkFromFile(file: string) {
  try {
    return packageEntry(
      findPackageRoot(realpathSync(file), PI_CODING_AGENT_PACKAGE),
    );
  } catch {
    return undefined;
  }
}

function resolveFromNode(fromUrl: string) {
  try {
    const manifest = createRequire(fromUrl).resolve(
      `${PI_CODING_AGENT_PACKAGE}/package.json`,
    );
    return packageEntry(dirname(manifest));
  } catch {
    return undefined;
  }
}

function resolveFromPath(pathValue: string | undefined) {
  if (!pathValue) return undefined;
  const delimiter = process.platform === "win32" ? ";" : ":";
  const names =
    process.platform === "win32" ? ["pi.cmd", "pi.exe", "pi"] : ["pi"];
  for (const dir of pathValue.split(delimiter)) {
    if (!dir) continue;
    for (const name of names) {
      const candidate = join(dir, name);
      if (!existsSync(candidate)) continue;
      const entry = walkFromFile(candidate);
      if (entry) return entry;
    }
  }
  return undefined;
}

export function resolvePiCodingAgentEntry(options?: {
  env?: NodeJS.ProcessEnv;
  argv1?: string | undefined;
  fromUrl?: string;
  path?: string;
}) {
  const env = options?.env ?? process.env;
  const handed = env[PI_CODING_AGENT_ENTRY_ENV];
  if (handed && existsSync(handed)) return handed;

  const fromNode = resolveFromNode(options?.fromUrl ?? import.meta.url);
  if (fromNode) return fromNode;

  const argv1 = options?.argv1 === undefined ? process.argv[1] : options.argv1;
  if (argv1) {
    const fromArgv = walkFromFile(argv1);
    if (fromArgv) return fromArgv;
  }

  return resolveFromPath(options?.path ?? env.PATH ?? env.Path);
}

function fileFromUrl(fromUrl: string) {
  return fromUrl.startsWith("file:") ? fileURLToPath(fromUrl) : fromUrl;
}

function findDependencyManifest(fromUrl: string, packageName: string) {
  let dir = dirname(fileFromUrl(fromUrl));
  for (let depth = 0; depth < PACKAGE_ROOT_SEARCH_DEPTH; depth++) {
    const manifestPath = join(
      dir,
      "node_modules",
      ...packageName.split("/"),
      "package.json",
    );
    if (existsSync(manifestPath)) {
      return {
        root: dirname(manifestPath),
        manifest: JSON.parse(readFileSync(manifestPath, "utf8")) as {
          main?: unknown;
          exports?: Record<string, { import?: unknown } | string>;
        },
      };
    }
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return undefined;
}

function exportEntry(
  resolved: ReturnType<typeof findDependencyManifest>,
  subpath: string,
) {
  if (!resolved) return undefined;
  const target = resolved.manifest.exports?.[subpath];
  const relative =
    typeof target === "string"
      ? target
      : typeof target?.import === "string"
        ? target.import
        : subpath === "." && typeof resolved.manifest.main === "string"
          ? resolved.manifest.main
          : undefined;
  if (!relative) return undefined;
  const entry = join(resolved.root, relative);
  return existsSync(entry) ? entry : undefined;
}

export function resolveStandaloneJitiAliases(options?: {
  env?: NodeJS.ProcessEnv;
  argv1?: string | undefined;
  fromUrl?: string;
  path?: string;
}) {
  const fromUrl = options?.fromUrl ?? import.meta.url;
  const aliases: Record<string, string> = {};
  const entry = resolvePiCodingAgentEntry({ ...options, fromUrl });
  if (entry) aliases[PI_CODING_AGENT_PACKAGE] = entry;
  const server = findDependencyManifest(fromUrl, PI_SERVER_PACKAGE);
  const serverEntry = exportEntry(server, ".");
  const unixEntry = exportEntry(server, "./unix");
  if (serverEntry) aliases[PI_SERVER_PACKAGE] = serverEntry;
  if (unixEntry) aliases[`${PI_SERVER_PACKAGE}/unix`] = unixEntry;
  return aliases;
}
