import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { chmod, mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

export type Manifest = {
  display_information: { name: string };
  oauth_config: { scopes: { user: string[] }; redirect_urls?: string[]; pkce_enabled?: boolean };
  settings?: Record<string, unknown>;
};
export type App = { app_id: string; credentials: { client_id: string } };
export type Credentials = { token: string; clientId?: string; refreshToken?: string; expiresAt?: number; appToken?: string };
type TokenResponse = { access_token?: string; token_type?: string; scope?: string; refresh_token?: string; expires_in?: number };
export const isUserToken = (token: string) => /^(?:xoxp-|xoxe\.xoxp-)[A-Za-z0-9-]+$/.test(token);
export const isAppToken = (token: string) => /^xapp-[A-Za-z0-9-]+$/.test(token);

export function createPKCE() {
  const verifier = randomBytes(32).toString("base64url");
  return { verifier, challenge: createHash("sha256").update(verifier).digest("base64url") };
}

export async function slackRequest<T>(
  method: string, params: Record<string, string>, authorization?: string, signal?: AbortSignal,
): Promise<T> {
  const response = await fetch(`https://slack.com/api/${method}`, {
    method: "POST",
    headers: { ...(authorization ? { Authorization: authorization } : {}), "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(params),
    signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(30_000)]) : AbortSignal.timeout(30_000),
  });
  if (!response.ok) throw new Error(`${method}: HTTP ${response.status}${response.status === 429 ? `; retry after ${response.headers.get("retry-after") || "60"} seconds` : ""}`);
  const data = await response.json() as T & { ok: boolean; error?: string };
  // Never print response bodies: successful responses contain credentials.
  if (!data.ok) throw new Error(`${method}: ${data.error || "unknown_error"}`);
  return data;
}

export function authorizationURL(app: App, redirect: string, state: string, scopes: string[], challenge: string) {
  const url = new URL("https://slack.com/oauth/v2/authorize");
  url.search = new URLSearchParams({
    client_id: app.credentials.client_id, user_scope: scopes.join(","),
    redirect_uri: redirect, state,
    code_challenge: challenge, code_challenge_method: "S256",
  }).toString();
  return url.toString();
}

function parseCredentials(user: TokenResponse | undefined, clientId: string): Credentials {
  if (!user?.access_token || !isUserToken(user.access_token) || user.token_type !== "user") {
    throw new Error("Slack did not return a supported user token. No credentials were saved.");
  }
  if (user.expires_in !== undefined && (!(user.expires_in > 0) || !user.refresh_token)) {
    throw new Error("Slack returned an expiring token without valid refresh credentials.");
  }
  return {
    token: user.access_token, clientId,
    refreshToken: user.refresh_token,
    expiresAt: user.expires_in ? Date.now() + user.expires_in * 1000 : undefined,
  };
}

export async function exchangeUserToken(app: App, code: string, redirect: string, scopes: string[], verifier: string, signal?: AbortSignal) {
  const data = await slackRequest<{ authed_user?: TokenResponse }>("oauth.v2.access", {
    code, redirect_uri: redirect, client_id: app.credentials.client_id, code_verifier: verifier,
  }, undefined, signal);
  const user = data.authed_user;
  const credentials = parseCredentials(user, app.credentials.client_id);
  const granted = new Set(user?.scope?.split(","));
  const missing = scopes.filter(scope => !granted.has(scope));
  if (missing.length) throw new Error(`Missing user permissions: ${missing.join(", ")}`);
  return credentials;
}

export function startCallback(port = 0) {
  const state = randomBytes(32).toString("hex");
  let resolve!: (value: { code?: string; error?: string }) => void;
  const result = new Promise<{ code?: string; error?: string }>(done => { resolve = done; });
  let consumed = false;
  const server = Bun.serve({
    hostname: "127.0.0.1", port,
    fetch(request) {
      const url = new URL(request.url);
      const reply = (text: string, status = 200) => new Response(text, {
        status, headers: { "Cache-Control": "no-store", "Referrer-Policy": "no-referrer", "Content-Type": "text/plain; charset=utf-8" },
      });
      if (url.pathname !== "/oauth/callback") return reply("Not found", 404);
      if (request.method !== "GET") return reply("Method not allowed", 405);
      const supplied = Buffer.from(url.searchParams.get("state") ?? "");
      const expected = Buffer.from(state);
      if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) return reply("Invalid OAuth state.", 403);
      if (consumed) return reply("This authorization has already been received. Return to the terminal.", 409);
      const error = url.searchParams.get("error");
      const code = url.searchParams.get("code");
      if (!error && !code) return reply("Missing authorization code.", 400);
      consumed = true;
      resolve(error ? { error } : { code: code! });
      return reply(error ? "Authorization was not granted. Return to the terminal." : "Authorization received. Return to the terminal to finish connecting.");
    },
  });
  return { state, result, port: server.port!, stop: () => server.stop(true) };
}

export function updateEnv(contents: string, token: string, credentials?: Credentials) {
  if (!isUserToken(token)) throw new Error("Invalid user token format.");
  const values: Record<string, string | undefined> = {
    SLACK_USER_TOKEN: token,
    ...(credentials?.appToken !== undefined ? { SLACK_APP_TOKEN: credentials.appToken } : {}),
    ...(credentials ? {
      SLACK_CLIENT_ID: credentials.clientId,
      SLACK_REFRESH_TOKEN: credentials.refreshToken,
      SLACK_TOKEN_EXPIRES_AT: credentials.expiresAt?.toString(),
    } : {}),
  };
  for (const value of Object.values(values)) {
    if (value && !/^[A-Za-z0-9._-]+$/.test(value)) throw new Error("Invalid credential format.");
  }
  const lines = contents.split(/\r?\n/);
  const found = new Set<string>();
  const updated = lines.flatMap(line => {
    const key = line.match(/^\s*(?:export\s+)?([A-Z_]+)\s*=/)?.[1];
    if (!key || !(key in values)) return [line];
    if (found.has(key)) return [];
    found.add(key);
    return values[key] ? [`${key}=${values[key]}`] : [];
  });
  for (const [key, value] of Object.entries(values)) {
    if (!found.has(key) && value) updated.push(`${key}=${value}`);
  }
  return `${updated.join("\n").replace(/\n+$/, "")}\n`;
}

export async function saveUserToken(path: string, token: string, credentials?: Credentials) {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const contents = await readFile(path, "utf8").catch(error => {
    if (error.code === "ENOENT") return "";
    throw error;
  });
  const temporary = `${path}.${randomBytes(8).toString("hex")}.tmp`;
  try {
    await writeFile(temporary, updateEnv(contents, token, credentials), { mode: 0o600, flag: "wx" });
    await rename(temporary, path);
    await chmod(path, 0o600);
  } finally {
    await unlink(temporary).catch(() => {});
  }
}

/** Refresh expiring desktop tokens before API requests; share concurrent refreshes. */
export function tokenProvider(initial: Credentials, path: string) {
  let current = initial;
  let refreshing: Promise<string> | undefined;
  return async () => {
    if (!current.expiresAt || current.expiresAt > Date.now() + 60_000) return current.token;
    if (!current.clientId || !current.refreshToken) throw new Error("Slack token expired. Run bun run setup --replace.");
    if (!refreshing) {
      refreshing = (async () => {
        const data = await slackRequest<TokenResponse>("oauth.v2.access", {
          grant_type: "refresh_token", refresh_token: current.refreshToken!, client_id: current.clientId!,
        });
        const next = parseCredentials(data, current.clientId!);
        await saveUserToken(path, next.token, next);
        current = next;
        return current.token;
      })().finally(() => { refreshing = undefined; });
    }
    return refreshing;
  };
}
