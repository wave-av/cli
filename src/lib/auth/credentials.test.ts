import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * One resolution for every command: WAVE_API_KEY, then the stored key; WAVE_BASE_URL, then the
 * project's baseUrl, then https://api.wave.online. Real config + file credential store under a
 * throwaway HOME (config/manager.ts reads homedir() at import, hence resetModules + dynamic import).
 */

let home: string;

async function load() {
  vi.resetModules();
  const credentials = await import("./credentials.js");
  const keychain = await import("./keychain.js");
  const manager = await import("../config/manager.js");
  return { ...credentials, ...keychain, ...manager };
}

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "wave-cli-creds-"));
  vi.stubEnv("HOME", home);
  vi.stubEnv("USERPROFILE", home);
  vi.stubEnv("WAVE_CREDENTIAL_STORE", "file");
  vi.stubEnv("WAVE_API_KEY", "");
  vi.stubEnv("WAVE_BASE_URL", "");
  vi.stubEnv("WAVE_PROJECT", "");
  vi.stubEnv("WAVE_ORG_ID", "");
});

afterEach(() => {
  vi.unstubAllEnvs();
  rmSync(home, { recursive: true, force: true });
});

describe("resolveCredentials", () => {
  it("returns null when there is no credential anywhere", async () => {
    const { resolveCredentials } = await load();
    expect(await resolveCredentials()).toBeNull();
  });

  it("uses WAVE_API_KEY with no login and no saved project (the README's CI path)", async () => {
    vi.stubEnv("WAVE_API_KEY", "wave_test_env_key");
    const { resolveCredentials } = await load();
    const creds = await resolveCredentials();
    expect(creds).toMatchObject({
      apiKey: "wave_test_env_key",
      source: "env",
      project: "default",
      baseUrl: "https://api.wave.online",
    });
  });

  it("prefers WAVE_API_KEY over a stored key", async () => {
    const { resolveCredentials, storeApiKey } = await load();
    await storeApiKey("default", "wave_test_stored");
    vi.stubEnv("WAVE_API_KEY", "wave_test_env_key");
    expect((await resolveCredentials())?.apiKey).toBe("wave_test_env_key");
  });

  it("uses a stored key even when config.projects has no entry (1.0.10: 'No project \"default\" configured')", async () => {
    const { resolveCredentials, storeApiKey, loadConfig } = await load();
    await storeApiKey("default", "wave_test_stored");
    expect((await loadConfig()).projects).toEqual({});
    const creds = await resolveCredentials();
    expect(creds).toMatchObject({ apiKey: "wave_test_stored", source: "stored", baseUrl: "https://api.wave.online" });
  });

  it("never defaults to the wave.online marketing host", async () => {
    vi.stubEnv("WAVE_API_KEY", "k");
    const { resolveCredentials } = await load();
    const { baseUrl } = (await resolveCredentials())!;
    expect(new URL(baseUrl).host).toBe("api.wave.online");
  });

  it("honors WAVE_BASE_URL over the project's saved baseUrl, and strips trailing slashes", async () => {
    const { resolveCredentials, updateConfig } = await load();
    await updateConfig((c) => ({ ...c, projects: { default: { baseUrl: "https://staging.example.test" } } }));
    vi.stubEnv("WAVE_API_KEY", "k");
    expect((await resolveCredentials())?.baseUrl).toBe("https://staging.example.test");
    vi.stubEnv("WAVE_BASE_URL", "https://local.example.test///");
    expect((await resolveCredentials())?.baseUrl).toBe("https://local.example.test");
  });

  it("selects the stored key for --project / WAVE_PROJECT", async () => {
    const { resolveCredentials, storeApiKey } = await load();
    await storeApiKey("default", "wave_test_default");
    await storeApiKey("production", "wave_test_prod");
    expect((await resolveCredentials({ project: "production" }))?.apiKey).toBe("wave_test_prod");
    vi.stubEnv("WAVE_PROJECT", "production");
    expect((await resolveCredentials())?.apiKey).toBe("wave_test_prod");
  });

  it("refreshes an expired device-flow token via POST /v1/agent/auth/token before use", async () => {
    const { resolveCredentials, storeApiKey, storeRefreshToken, updateConfig, getApiKey } = await load();
    await storeApiKey("default", "expired_access");
    await storeRefreshToken("default", "refresh_1");
    await updateConfig((c) => ({ ...c, projects: { default: { tokenExpiresAt: Date.now() - 1000 } } }));

    const fetchMock = vi.fn(async (url: string, init: RequestInit) => {
      expect(url).toBe("https://api.wave.online/v1/agent/auth/token");
      expect(JSON.parse(String(init.body))).toEqual({ grant_type: "refresh_token", refresh_token: "refresh_1" });
      return new Response(
        JSON.stringify({ access_token: "fresh_access", refresh_token: "refresh_2", expires_in: 3600 }),
        { status: 200 },
      );
    });
    vi.stubGlobal("fetch", fetchMock);
    try {
      const creds = await resolveCredentials();
      expect(creds?.apiKey).toBe("fresh_access");
      expect(await getApiKey("default")).toBe("fresh_access");
      expect(fetchMock).toHaveBeenCalledTimes(1);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

describe("device-flow refresh: every outcome keeps the store and the returned token consistent", () => {
  async function expiredLogin(expiresAt = Date.now() - 1000) {
    const mod = await load();
    await mod.storeApiKey("default", "old_access");
    await mod.storeRefreshToken("default", "refresh_1");
    await mod.updateConfig((c) => ({ ...c, projects: { default: { tokenExpiresAt: expiresAt } } }));
    return mod;
  }

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("persists the rotated refresh token and the new expiry", async () => {
    const { resolveCredentials, getRefreshToken, loadConfig } = await expiredLogin();
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ access_token: "a2", refresh_token: "refresh_2", expires_in: 600 }))));
    expect((await resolveCredentials())?.apiKey).toBe("a2");
    expect(await getRefreshToken("default")).toBe("refresh_2");
    const expiresAt = (await loadConfig()).projects["default"]?.tokenExpiresAt ?? 0;
    expect(expiresAt).toBeGreaterThan(Date.now() + 500_000);
  });

  it("a refused refresh token (400 invalid_grant) sends the stored token, so the API's 401 says 'log in again'", async () => {
    const { resolveCredentials, getApiKey } = await expiredLogin();
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ error: "invalid_grant" }), { status: 400 })));
    expect((await resolveCredentials())?.apiKey).toBe("old_access");
    expect(await getApiKey("default")).toBe("old_access");
  });

  it("a transport failure past expiry is reported, not hidden behind a dead token", async () => {
    const { resolveCredentials } = await expiredLogin();
    vi.stubGlobal("fetch", vi.fn(async () => {
      throw new TypeError("fetch failed");
    }));
    await expect(resolveCredentials()).rejects.toThrow(/expired and could not be refreshed \(fetch failed\)/);
  });

  it("a transport failure inside the early-refresh window keeps using the still-valid token", async () => {
    const { resolveCredentials } = await expiredLogin(Date.now() + 30_000);
    vi.stubGlobal("fetch", vi.fn(async () => new Response("upstream down", { status: 503 })));
    expect((await resolveCredentials())?.apiKey).toBe("old_access");
  });

  it("a refresh that cannot be saved is reported instead of returning an unsaved token", async () => {
    const { resolveCredentials } = await expiredLogin();
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ access_token: "a2", refresh_token: "refresh_2", expires_in: 600 }))));
    // Make the credentials file unwritable: its directory becomes read-only.
    const dir = join(home, ".wave");
    if (process.platform === "win32" || process.getuid?.() === 0) return; // chmod does not restrict here
    chmodSync(dir, 0o500);
    try {
      await expect(resolveCredentials()).rejects.toThrow(/refreshed, but saving it failed/);
    } finally {
      chmodSync(dir, 0o700);
    }
  });
});

describe("API host: credentials are sent only over TLS", () => {
  it("rejects http:// (except localhost), non-URLs and embedded credentials", async () => {
    const { validateApiBaseUrl } = await load();
    expect(() => validateApiBaseUrl("http://api.wave.online", "WAVE_BASE_URL")).toThrow(/must use https:\/\//);
    expect(() => validateApiBaseUrl("ftp://api.wave.online", "WAVE_BASE_URL")).toThrow(/must use https:\/\//);
    expect(() => validateApiBaseUrl("api.wave.online", "WAVE_BASE_URL")).toThrow(/not a valid URL/);
    expect(() => validateApiBaseUrl("https://u:p@api.wave.online", "WAVE_BASE_URL")).toThrow(/username or password/);
    expect(validateApiBaseUrl("http://localhost:8787/", "WAVE_BASE_URL")).toBe("http://localhost:8787");
    expect(validateApiBaseUrl("http://127.0.0.1:8787", "WAVE_BASE_URL")).toBe("http://127.0.0.1:8787");
    expect(validateApiBaseUrl("http://[::1]:8787", "WAVE_BASE_URL")).toBe("http://[::1]:8787");
  });

  it("applies to a saved project baseUrl too", async () => {
    const { resolveCredentials, updateConfig } = await load();
    await updateConfig((c) => ({ ...c, projects: { default: { baseUrl: "http://staging.example.test" } } }));
    vi.stubEnv("WAVE_API_KEY", "k");
    await expect(resolveCredentials()).rejects.toThrow(/saved baseUrl of project "default" must use https/);
  });
});

describe("organization: --org, then WAVE_ORG_ID, then the saved org", () => {
  it("resolves in that order", async () => {
    const { resolveCredentials, updateConfig } = await load();
    vi.stubEnv("WAVE_API_KEY", "k");
    await updateConfig((c) => ({ ...c, projects: { default: { organizationId: "org_saved" } } }));
    expect((await resolveCredentials())?.organizationId).toBe("org_saved");
    vi.stubEnv("WAVE_ORG_ID", "org_env");
    expect((await resolveCredentials())?.organizationId).toBe("org_env");
    expect((await resolveCredentials({ org: "org_flag" }))?.organizationId).toBe("org_flag");
  });
});

describe("config file: never reset behind the user's back", () => {
  it("an invalid config fails loudly and is left byte-for-byte intact, even on the WAVE_API_KEY path", async () => {
    const dir = join(home, ".wave");
    mkdirSync(dir, { recursive: true });
    const file = join(dir, "config.json");
    const broken = '{"projects": {"prod": {"baseUrl": "not a url"}}}';
    writeFileSync(file, broken);
    vi.stubEnv("WAVE_API_KEY", "k");
    const { resolveCredentials, ConfigError } = { ...(await load()), ...(await import("../errors.js")) };
    await expect(resolveCredentials()).rejects.toBeInstanceOf(ConfigError);
    expect(readFileSync(file, "utf-8")).toBe(broken);
  });

  it("reading a missing config creates nothing (read-only HOME works)", async () => {
    vi.stubEnv("WAVE_API_KEY", "k");
    const { resolveCredentials } = await load();
    expect((await resolveCredentials())?.source).toBe("env");
    expect(existsSync(join(home, ".wave", "config.json"))).toBe(false);
  });
});
