import { afterEach, expect, test } from "bun:test";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { authorizationURL, createPKCE, exchangeUserToken, saveUserToken, slackRequest, startCallback, updateEnv, tokenProvider } from "./oauth";

const originalFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = originalFetch; });
const app = { app_id: "A1", credentials: { client_id: "client", client_secret: "secret" } };

test("OAuth URL requests user scopes with state, PKCE and localhost redirect", () => {
  const pkce = createPKCE();
  expect(pkce.verifier.length).toBeGreaterThanOrEqual(43);
  expect(pkce.challenge).toBe(createHash("sha256").update(pkce.verifier).digest("base64url"));
  const url = new URL(authorizationURL(app, "http://localhost:8765/oauth/callback", "random-state", ["chat:write", "im:read"], pkce.challenge));
  expect(url.searchParams.get("user_scope")).toBe("chat:write,im:read");
  expect(url.searchParams.has("scope")).toBe(false);
  expect(url.searchParams.get("state")).toBe("random-state");
  expect(url.searchParams.get("redirect_uri")).toBe("http://localhost:8765/oauth/callback");
  expect(url.searchParams.get("code_challenge")).toBe(pkce.challenge);
  expect(url.searchParams.get("code_challenge_method")).toBe("S256");
  expect(url.toString()).not.toContain(pkce.verifier);
  expect(url.toString()).not.toContain("secret");
});

test("callback validates state, accepts one authorization and rejects replay", async () => {
  const callback = startCallback();
  const base = `http://localhost:${callback.port}`;
  try {
    expect((await fetch(`${base}/`)).status).toBe(404);
    expect((await fetch(`${base}/oauth/callback?code=bad&state=wrong`)).status).toBe(403);
    const response = await fetch(`${base}/oauth/callback?code=one-time&state=${callback.state}`);
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await callback.result).toEqual({ code: "one-time" });
    expect((await fetch(`${base}/oauth/callback?code=again&state=${callback.state}`)).status).toBe(409);
  } finally { await callback.stop(); }
});

test("callback delivers denied authorization without accepting missing code", async () => {
  const callback = startCallback();
  const url = `http://127.0.0.1:${callback.port}/oauth/callback?state=${callback.state}`;
  try {
    expect((await fetch(url)).status).toBe(400);
    await fetch(`${url}&error=access_denied`);
    expect(await callback.result).toEqual({ error: "access_denied" });
  } finally { await callback.stop(); }
});

test("token exchange uses PKCE verifier, no client secret and matching redirect", async () => {
  globalThis.fetch = (async (url: unknown, init?: RequestInit) => {
    expect(String(url)).toEndWith("/oauth.v2.access");
    expect((init?.headers as Record<string, string>).Authorization).toBeUndefined();
    const body = new URLSearchParams(init?.body as URLSearchParams);
    expect(body.get("redirect_uri")).toBe("http://localhost:8765/oauth/callback");
    expect(body.get("code")).toBe("one-time");
    expect(body.get("code_verifier")).toBe("verifier");
    expect(body.get("client_id")).toBe("client");
    expect(body.has("client_secret")).toBe(false);
    return Response.json({
      ok: true, access_token: "xoxb-ignore",
      authed_user: { access_token: "xoxp-user", token_type: "user", scope: "chat:write" },
    });
  }) as unknown as typeof fetch;
  expect((await exchangeUserToken(app, "one-time", "http://localhost:8765/oauth/callback", ["chat:write"], "verifier")).token).toBe("xoxp-user");
});

test("missing permissions and bot-only authorizations are rejected", async () => {
  globalThis.fetch = (async () => Response.json({ ok: true, access_token: "xoxb-bot" })) as unknown as typeof fetch;
  await expect(exchangeUserToken(app, "code", "http://localhost", ["im:read"], "verifier")).rejects.toThrow("user token");
  globalThis.fetch = (async () => Response.json({
    ok: true, authed_user: { access_token: "xoxp-user", token_type: "user", scope: "chat:write" },
  })) as unknown as typeof fetch;
  await expect(exchangeUserToken(app, "code", "http://localhost", ["im:read"], "verifier")).rejects.toThrow("im:read");
});

test("expiring user tokens refresh once for concurrent requests and persist rotated credentials", async () => {
  const dir = await mkdtemp(join(tmpdir(), "slack-tui-refresh-"));
  const path = join(dir, ".env");
  let calls = 0;
  globalThis.fetch = (async (_url: unknown, init?: RequestInit) => {
    calls++;
    const body = new URLSearchParams(init?.body as URLSearchParams);
    expect(body.get("grant_type")).toBe("refresh_token");
    expect(body.get("refresh_token")).toBe("xoxe-old");
    expect(body.has("client_secret")).toBe(false);
    return Response.json({
      ok: true, access_token: "xoxe.xoxp-new", token_type: "user",
      refresh_token: "xoxe-new", expires_in: 43200,
    });
  }) as unknown as typeof fetch;
  try {
    const getToken = tokenProvider({ token: "xoxe.xoxp-old", clientId: "123.456", refreshToken: "xoxe-old", expiresAt: 1 }, path);
    expect(await Promise.all([getToken(), getToken()])).toEqual(["xoxe.xoxp-new", "xoxe.xoxp-new"]);
    expect(await getToken()).toBe("xoxe.xoxp-new");
    expect(calls).toBe(1);
    const saved = await readFile(path, "utf8");
    expect(saved).toContain("SLACK_REFRESH_TOKEN=xoxe-new");
    expect(saved).toContain("SLACK_TOKEN_EXPIRES_AT=");
    expect((await stat(path)).mode & 0o777).toBe(0o600);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test("a new non-rotating authorization removes obsolete refresh credentials", () => {
  const env = updateEnv("OTHER=value\nSLACK_REFRESH_TOKEN=xoxe-old\nSLACK_TOKEN_EXPIRES_AT=1\n", "xoxp-new", { token: "xoxp-new", clientId: "123.456" });
  expect(env).not.toContain("SLACK_REFRESH_TOKEN");
  expect(env).not.toContain("SLACK_TOKEN_EXPIRES_AT");
  expect(env).toContain("OTHER=value");
});

test("Slack errors do not expose response credentials", async () => {
  globalThis.fetch = (async () => Response.json({ ok: false, error: "token_expired", token: "secret" })) as unknown as typeof fetch;
  await expect(slackRequest("apps.manifest.create", {}, "Bearer config")).rejects.toThrow("apps.manifest.create: token_expired");
});

test("credential save preserves other settings, removes duplicate assignments and sets mode 600", async () => {
  const dir = await mkdtemp(join(tmpdir(), "slack-tui-oauth-"));
  const path = join(dir, ".env");
  try {
    await writeFile(path, "# settings\nOTHER=value\nexport SLACK_USER_TOKEN=xoxp-old\nSLACK_USER_TOKEN=xoxp-duplicate\n");
    await saveUserToken(path, "xoxp-new");
    expect(await readFile(path, "utf8")).toBe("# settings\nOTHER=value\nSLACK_USER_TOKEN=xoxp-new\n");
    expect((await stat(path)).mode & 0o777).toBe(0o600);
    expect(() => updateEnv("", "xoxp-token\nEVIL=1")).toThrow();
  } finally { await rm(dir, { recursive: true, force: true }); }
});
