import { mkdtempSync, rmSync } from "node:fs";
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
