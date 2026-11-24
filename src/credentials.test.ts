import { expect, test } from "bun:test";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadCredentials, parseCredentialsFile } from "./credentials";
import { saveUserToken, updateEnv } from "./oauth";

test("legacy credentials migrate outside project and preserve unrelated environment settings", async () => {
  const dir = await mkdtemp(join(tmpdir(), "slack-tui-migration-"));
  const path = join(dir, "config", "credentials.env");
  const legacyPath = join(dir, ".env");
  try {
    await writeFile(legacyPath, "OTHER=keep\nSLACK_USER_TOKEN=xoxp-old\nSLACK_CLIENT_ID=123.456\nSLACK_REFRESH_TOKEN=xoxe-refresh\nSLACK_TOKEN_EXPIRES_AT=1234\n");
    const credentials = await loadCredentials({ path, legacyPath, env: {} });
    expect(credentials).toEqual({ token: "xoxp-old", clientId: "123.456", refreshToken: "xoxe-refresh", expiresAt: 1234 });
    expect(await readFile(legacyPath, "utf8")).toBe("OTHER=keep\n");
    expect((await stat(path)).mode & 0o777).toBe(0o600);
    expect(await loadCredentials({ path, legacyPath, env: { SLACK_USER_TOKEN: "xoxp-stale" } })).toEqual(credentials);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test("credential-only legacy file is removed after migration; saved config wins over stale local file", async () => {
  const dir = await mkdtemp(join(tmpdir(), "slack-tui-migration-"));
  const path = join(dir, "config", "credentials.env");
  const legacyPath = join(dir, ".env");
  try {
    await writeFile(legacyPath, 'export SLACK_USER_TOKEN="xoxp-old"\n');
    await loadCredentials({ path, legacyPath, env: {} });
    await expect(stat(legacyPath)).rejects.toThrow();
    await writeFile(legacyPath, "SLACK_USER_TOKEN=xoxp-stale\n");
    await saveUserToken(path, "xoxp-new");
    expect((await loadCredentials({ path, legacyPath, env: {} }))?.token).toBe("xoxp-new");
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test("credential parsing accepts quoted values and rejects malformed token/expiry", () => {
  expect(parseCredentialsFile('SLACK_USER_TOKEN="xoxp-test" # comment\n')?.token).toBe("xoxp-test");
  expect(() => parseCredentialsFile("SLACK_USER_TOKEN=invalid")).toThrow("Invalid Slack user token");
  expect(() => parseCredentialsFile("SLACK_USER_TOKEN=xoxp-test\nSLACK_TOKEN_EXPIRES_AT=oops")).toThrow("expiry");
});

test("Socket Mode credentials survive user token refresh and can be removed when replacing the app", () => {
  const file = "SLACK_USER_TOKEN=xoxp-old\nSLACK_APP_TOKEN=xapp-example\n";
  expect(parseCredentialsFile(file)?.appToken).toBe("xapp-example");
  const refreshed = updateEnv(file, "xoxp-new", { token: "xoxp-new", clientId: "1.2" });
  expect(parseCredentialsFile(refreshed)?.appToken).toBe("xapp-example");
  const replaced = updateEnv(refreshed, "xoxp-other", { token: "xoxp-other", appToken: "" });
  expect(parseCredentialsFile(replaced)?.appToken).toBeUndefined();
  expect(() => parseCredentialsFile("SLACK_USER_TOKEN=xoxp-test\nSLACK_APP_TOKEN=xoxb-wrong")).toThrow("Invalid Slack app token");
});
