import { existsSync, mkdtempSync, readdirSync, rmSync, statSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
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
  useKeytarForTests,
  simulateKeytarImportForTests,
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

  it("rejects a partial module (never used half-working; see 'keychain module selection')", () => {
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

  it("concurrent writers do not drop each other's secrets (the read-modify-write is locked)", async () => {
    const projects = Array.from({ length: 12 }, (_, i) => `p${i}`);
    await Promise.all(projects.flatMap((p) => [storeApiKey(p, `key_${p}`), storeRefreshToken(p, `refresh_${p}`)]));
    for (const p of projects) {
      expect(await getApiKey(p)).toBe(`key_${p}`);
      expect(await getRefreshToken(p)).toBe(`refresh_${p}`);
    }
    // No lock or temp file is left behind.
    expect(readdirSync(join(home, ".wave")).sort()).toEqual(["credentials.json"]);
  });

  it("logout with nothing stored writes nothing", async () => {
    await deleteApiKey("default");
    await deleteAllKeys();
    expect(existsSync(join(home, ".wave", "credentials.json"))).toBe(false);
  });

  it("a corrupt credentials file is reported and never overwritten", async () => {
    const dir = join(home, ".wave");
    mkdirSync(dir, { recursive: true });
    const file = join(dir, "credentials.json");
    writeFileSync(file, "{not json");
    await expect(getApiKey("default")).rejects.toThrow(/not a valid credentials file/);
    await expect(storeApiKey("default", "k")).rejects.toThrow(/not a valid credentials file/);
    expect(readFileSync(file, "utf-8")).toBe("{not json");
  });
});

describe("keychain module selection", () => {
  let home: string;

  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), "wave-cli-kt-"));
    vi.stubEnv("HOME", home);
    vi.stubEnv("USERPROFILE", home);
    vi.stubEnv("WAVE_CREDENTIAL_STORE", "");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
    resetKeytarCacheForTests();
    rmSync(home, { recursive: true, force: true });
  });

  it("refuses a keytar that loads without its full API, instead of silently storing plaintext", async () => {
    simulateKeytarImportForTests({ mod: { getPassword: fn } });
    await expect(storeApiKey("default", "k")).rejects.toThrow(/does not provide setPassword.*WAVE_CREDENTIAL_STORE=file/s);
    expect(existsSync(join(home, ".wave", "credentials.json"))).toBe(false);
  });

  it("falls back to the 0600 file when no keychain can load, and says so once on stderr", async () => {
    const notes: string[] = [];
    vi.spyOn(process.stderr, "write").mockImplementation(((chunk: string) => {
      notes.push(String(chunk));
      return true;
    }) as typeof process.stderr.write);
    simulateKeytarImportForTests({ loadError: new Error("libsecret-1.so.0: cannot open shared object file") });
    expect(await credentialBackend()).toBe("file");
    await storeApiKey("a", "k1");
    await storeApiKey("b", "k2");
    expect(await getApiKey("b")).toBe("k2");
    expect(notes).toHaveLength(1);
    expect(notes[0]).toMatch(/keychain is unavailable \(libsecret-1\.so\.0.*credentials\.json \(mode 0600\)/);
  });
});

describe("OS keychain that never answers (locked keychain, headless session)", () => {
  // Observed on macOS: with the login keychain locked and no GUI to unlock it, keytar's
  // setPassword blocks indefinitely, so `wave auth login --api-key` hung with no output.
  const never = () => new Promise<never>(() => undefined);
  const stuck = {
    setPassword: never,
    getPassword: never,
    deletePassword: never,
    findCredentials: never,
  };

  beforeEach(() => {
    vi.stubEnv("WAVE_CREDENTIAL_STORE", "");
    vi.stubEnv("WAVE_KEYCHAIN_TIMEOUT_MS", "25");
    useKeytarForTests(stuck);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    resetKeytarCacheForTests();
  });

  it("fails a store with an actionable error instead of hanging", async () => {
    await expect(storeApiKey("default", "wave_test_example_key")).rejects.toThrow(
      /keychain did not answer.*store.*WAVE_CREDENTIAL_STORE=file/s,
    );
  });

  it("bounds reads, deletes and logout --all the same way", async () => {
    await expect(getApiKey("default")).rejects.toThrow(/did not answer.*\(read\)/);
    await expect(deleteApiKey("default")).rejects.toThrow(/did not answer.*\(delete\)/);
    await expect(deleteAllKeys()).rejects.toThrow(/did not answer.*\(list\)/);
  });

  it("does not delay a keychain that answers", async () => {
    let stored = "";
    useKeytarForTests({
      setPassword: async (_s, _a, v) => {
        stored = v;
      },
      getPassword: async () => stored || null,
      deletePassword: async () => true,
      findCredentials: async () => [],
    });
    await storeApiKey("default", "wave_test_example_key");
    expect(await getApiKey("default")).toBe("wave_test_example_key");
  });

  it.each(["1e15", "Infinity"])("caps an override of %s at the Node timer limit instead of timing out at once", async (override) => {
    // Node turns a delay above 2^31-1 ms into 1 ms. Uncapped, a 1e15 override failed a keychain that
    // answers in 50ms with "did not answer within 1000000000000s".
    vi.stubEnv("WAVE_KEYCHAIN_TIMEOUT_MS", override);
    const slow = <T>(value: T) => new Promise<T>((done) => setTimeout(() => done(value), 50));
    let stored = "";
    useKeytarForTests({
      setPassword: async (_s, _a, v) => {
        await slow(undefined);
        stored = v;
      },
      getPassword: async () => slow(stored || null),
      deletePassword: async () => slow(true),
      findCredentials: async () => slow([]),
    });
    await storeApiKey("default", "wave_test_example_key");
    expect(await getApiKey("default")).toBe("wave_test_example_key");
  });
});
