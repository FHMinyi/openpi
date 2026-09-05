import assert from "node:assert/strict";
import { realpathSync } from "node:fs";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import test from "node:test";
import {
  PI_CODING_AGENT_ENTRY_ENV,
  PI_CODING_AGENT_PACKAGE,
  PI_SERVER_PACKAGE,
  resolvePiCodingAgentEntry,
  resolveStandaloneJitiAliases,
} from "../../web/host/pi-coding-agent-entry.ts";

async function isolatedLayout() {
  const root = await mkdtemp(join(tmpdir(), "openpi-pi-entry-"));
  const caller = join(root, "unrelated", "caller.js");
  const piRoot = join(root, "fake-pi");
  await mkdir(join(root, "unrelated"), { recursive: true });
  await mkdir(join(piRoot, "dist", "bundle"), { recursive: true });
  await mkdir(join(piRoot, "bin"), { recursive: true });
  await writeFile(caller, "");
  await writeFile(
    join(piRoot, "package.json"),
    JSON.stringify({
      name: "@earendil-works/pi-coding-agent",
      type: "module",
    }),
  );
  const entry = join(piRoot, "dist", "index.js");
  await writeFile(entry, "export {}\n");
  await writeFile(join(piRoot, "dist", "bundle", "cli.js"), "");
  await writeFile(join(piRoot, "bin", "pi"), "#!/usr/bin/env node\n");
  return {
    root,
    caller,
    fromUrl: pathToFileURL(caller).href,
    piRoot,
    entry,
    piBin: join(piRoot, "bin", "pi"),
    binDir: join(piRoot, "bin"),
  };
}

test("resolver prefers an existing handed-over entry over PATH", async () => {
  const layout = await isolatedLayout();
  const handed = join(layout.root, "handed.js");
  try {
    await writeFile(handed, "export {}\n");
    assert.equal(
      resolvePiCodingAgentEntry({
        env: { [PI_CODING_AGENT_ENTRY_ENV]: handed },
        argv1: layout.piBin,
        fromUrl: layout.fromUrl,
        path: layout.binDir,
      }),
      handed,
    );
  } finally {
    await rm(layout.root, { recursive: true, force: true });
  }
});

test("resolver ignores a stale handed-over entry and walks the Pi launcher", async () => {
  const layout = await isolatedLayout();
  try {
    assert.equal(
      resolvePiCodingAgentEntry({
        env: { [PI_CODING_AGENT_ENTRY_ENV]: join(layout.root, "missing.js") },
        argv1: layout.piBin,
        fromUrl: layout.fromUrl,
        path: "",
      }),
      realpathSync(layout.entry),
    );
  } finally {
    await rm(layout.root, { recursive: true, force: true });
  }
});

test("resolver walks PATH when the CLI is not launched from Pi", async () => {
  const layout = await isolatedLayout();
  try {
    assert.equal(
      resolvePiCodingAgentEntry({
        env: {},
        argv1: layout.caller,
        fromUrl: layout.fromUrl,
        path: layout.binDir,
      }),
      realpathSync(layout.entry),
    );
  } finally {
    await rm(layout.root, { recursive: true, force: true });
  }
});

test("standalone aliases keep OpenPI pi-server when Pi is resolved from PATH", async () => {
  const layout = await isolatedLayout();
  try {
    const aliases = resolveStandaloneJitiAliases({
      env: {},
      argv1: layout.caller,
      fromUrl: import.meta.url,
      path: layout.binDir,
    });
    assert.equal(aliases[PI_CODING_AGENT_PACKAGE], realpathSync(layout.entry));
    assert.match(aliases[PI_SERVER_PACKAGE] ?? "", /pi-server/u);
    assert.match(aliases[`${PI_SERVER_PACKAGE}/unix`] ?? "", /pi-server/u);
  } finally {
    await rm(layout.root, { recursive: true, force: true });
  }
});

test("resolver fail-softs when no Pi install is reachable", async () => {
  const layout = await isolatedLayout();
  try {
    assert.equal(
      resolvePiCodingAgentEntry({
        env: {},
        argv1: layout.caller,
        fromUrl: layout.fromUrl,
        path: "",
      }),
      undefined,
    );
  } finally {
    await rm(layout.root, { recursive: true, force: true });
  }
});
