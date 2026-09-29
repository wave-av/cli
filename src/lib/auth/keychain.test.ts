import { mkdtempSync, rmSync, statSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  resolveKeytarModule,
  resetKeytarCacheForTests,
  credentialBackend,
  storeApiKey,
  getApiKey,
  deleteApiKey,
  storeRefreshToken,
  getRefreshToken,
  deleteAllKeys,
} from "./keychain.js";

/**
 * 1.0.10: `wave auth login --api-key` and `wave auth logout` crashed with
 * "keytar.setPassword is not a function". keytar is CommonJS; under Node ESM the namespace that
 * `await import("keytar")` returns exposes only what cjs-module-lexer detects (getPassword), and
 * the real module.exports object lives on `.default`.
 */

const fn = async () => undefined;
const fullKeytar = { setPassword: fn, getPassword: fn, deletePassword: fn, findCredentials: fn };

describe("resolveKeytarModule", () => {
  it("takes .default when the ESM namespace only carries getPassword (the 1.0.10 crash shape)", () => {
    const namespace = { default: fullKeytar, getPassword: fn };
    expect(resolveKeytarModule(namespace)).toBe(fullKeytar);
  });

  it("accepts a module that already exposes every method (CJS require / bundlers)", () => {
    expect(resolveKeytarModule(fullKeytar)).toBe(fullKeytar);
  });

  it("rejects a partial module so the caller falls back to the file store instead of crashing", () => {
    expect(resolveKeytarModule({ getPassword: fn })).toBeNull();
    expect(resolveKeytarModule({ default: { getPassword: fn, setPassword: fn } })).toBeNull();
    expect(resolveKeytarModule(null)).toBeNull();
    expect(resolveKeytarModule("keytar")).toBeNull();
  });

  // The REAL module, not a mock: proves the fix against what Node actually hands us. Read-only (no
  // keychain writes). Skipped only where keytar's native binding cannot load (e.g. Linux without
  // libsecret), which is exactly the environment the file fallback exists for.
  it("resolves a complete keychain API from the real `import(\"keytar\")`", async () => {
    let mod: unknown;
    try {
      mod = await import("keytar" as string);
    } catch {
      return; // native binding unavailable here; covered by the file-store tests below
    }
    const resolved = resolveKeytarModule(mod);
    expect(resolved).not.toBeNull();
    for (const m of ["setPassword", "getPassword", "deletePassword", "findCredentials"] as const) {
      expect(typeof resolved![m]).toBe("function");
    }
    // Document the interop trap itself: if Node ever starts exposing setPassword as a named
    // export this assertion is simply satisfied either way; what matters is `resolved` above.
    const ns = mod as Record<string, unknown>;
    if (typeof ns["setPassword"] !== "function") {
      expect(typeof (ns["default"] as Record<string, unknown>)["setPassword"]).toBe("function");
    }
  }, 60_000); // first load of a native addon can be slow on a busy machine
});

describe("file credential store (WAVE_CREDENTIAL_STORE=file)", () => {
  let home: string;

  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), "wave-cli-cred-"));
    vi.stubEnv("HOME", home);
    vi.stubEnv("USERPROFILE", home);
    vi.stubEnv("WAVE_CREDENTIAL_STORE", "file");
    resetKeytarCacheForTests();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    resetKeytarCacheForTests();
    rmSync(home, { recursive: true, force: true });
  });

  it("never touches the OS keychain when forced to the file store", async () => {
    expect(await credentialBackend()).toBe("file");
  });

  it("round-trips an API key and refresh token, then logout removes both", async () => {
    await storeApiKey("default", "wave_test_example_key");
    await storeRefreshToken("default", "refresh_example");
    expect(await getApiKey("default")).toBe("wave_test_example_key");
    expect(await getRefreshToken("default")).toBe("refresh_example");
    expect(await getApiKey("staging")).toBeNull();

    await deleteApiKey("default");
    expect(await getApiKey("default")).toBeNull();
    expect(await getRefreshToken("default")).toBeNull();
  });

  it("writes ~/.wave/credentials.json with mode 0600, even over a pre-existing looser file", async () => {
    const dir = join(home, ".wave");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "credentials.json"), "{}", { mode: 0o644 });

    await storeApiKey("default", "wave_test_example_key");
    const file = join(dir, "credentials.json");
    if (process.platform !== "win32") {
      expect(statSync(file).mode & 0o777).toBe(0o600);
    }
    expect(JSON.parse(readFileSync(file, "utf-8"))).toEqual({ "apikey:default": "wave_test_example_key" });
  });

  it("reads files written by 1.0.10 (entries keyed by bare project name)", async () => {
    const dir = join(home, ".wave");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "credentials.json"), JSON.stringify({ production: "wave_test_legacy" }));
    expect(await getApiKey("production")).toBe("wave_test_legacy");
  });

  it("deleteAllKeys empties the store", async () => {
    await storeApiKey("a", "k1");
    await storeApiKey("b", "k2");
    await deleteAllKeys();
    expect(await getApiKey("a")).toBeNull();
    expect(await getApiKey("b")).toBeNull();
  });
});
