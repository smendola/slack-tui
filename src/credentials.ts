import { readFile, rename, unlink, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { credentialsPath } from "./config-paths";
import { isUserToken, isAppToken, saveUserToken, type Credentials } from "./oauth";

const legacyPath = fileURLToPath(new URL("../.env", import.meta.url));
const keys = new Set(["SLACK_USER_TOKEN", "SLACK_CLIENT_ID", "SLACK_REFRESH_TOKEN", "SLACK_TOKEN_EXPIRES_AT", "SLACK_APP_TOKEN", "SLACK_APP_ID"]);
const assignment = /^\s*(?:export\s+)?([A-Z_]+)\s*=\s*(.*?)\s*$/;

function fromValues(values: Record<string, string | undefined>, ignoreInvalidAppToken = false): Credentials | undefined {
  const token = values.SLACK_USER_TOKEN;
  if (!token) return undefined;
  if (!isUserToken(token)) throw new Error("Invalid Slack user token. Run bun run setup --replace.");
  const expiresAt = values.SLACK_TOKEN_EXPIRES_AT ? Number(values.SLACK_TOKEN_EXPIRES_AT) : undefined;
  if (expiresAt !== undefined && (!Number.isFinite(expiresAt) || expiresAt <= 0)) throw new Error("Invalid Slack token expiry in credentials.");
  let appToken = values.SLACK_APP_TOKEN || undefined;
  if (appToken && !isAppToken(appToken)) {
    if (!ignoreInvalidAppToken) throw new Error("Invalid Slack app token. Run bun run setup --socket.");
    appToken = undefined;
  }
  const appId = values.SLACK_APP_ID || undefined;
  if (appId && !/^A[A-Z0-9]+$/.test(appId)) throw new Error("Invalid Slack app ID in credentials.");
  return { token, clientId: values.SLACK_CLIENT_ID, refreshToken: values.SLACK_REFRESH_TOKEN, expiresAt,
    ...(appToken ? { appToken } : {}), ...(appId ? { appId } : {}) };
}

export function parseCredentialsFile(contents: string, ignoreInvalidAppToken = false): Credentials | undefined {
  const values: Record<string, string> = {};
  for (const line of contents.split(/\r?\n/)) {
    const match = line.match(assignment);
    if (!match || !keys.has(match[1])) continue;
    const raw = match[2];
    const quoted = raw.match(/^(["'])(.*?)\1\s*(?:#.*)?$/);
    values[match[1]] = quoted ? quoted[2] : raw.replace(/\s+#.*$/, "").trim();
  }
  return fromValues(values, ignoreInvalidAppToken);
}

async function readOptional(path: string) {
  try { return await readFile(path, "utf8"); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
}

export async function loadCredentials(options: {
  path?: string; legacyPath?: string; env?: Record<string, string | undefined>; ignoreInvalidAppToken?: boolean;
} = {}): Promise<Credentials | undefined> {
  const path = options.path ?? credentialsPath;
  const legacy = options.legacyPath ?? legacyPath;
  const stored = await readOptional(path);
  if (stored !== undefined) {
    const parsed = parseCredentialsFile(stored, options.ignoreInvalidAppToken);
    if (!parsed) throw new Error(`No Slack user token in ${path}. Run bun run setup --replace.`);
    return parsed;
  }
  const oldContents = await readOptional(legacy);
  const previous = oldContents === undefined ? undefined : parseCredentialsFile(oldContents, options.ignoreInvalidAppToken);
  if (previous) {
    // Persist the new copy before removing anything from the legacy file.
    await saveUserToken(path, previous.token, previous);
    const remaining = oldContents!.split(/\r?\n/).filter(line => {
      const key = line.match(assignment)?.[1];
      return !key || !keys.has(key);
    }).join("\n");
    if (!remaining.trim()) await unlink(legacy);
    else {
      const temporary = `${legacy}.${randomUUID()}.tmp`;
      try {
        await writeFile(temporary, remaining, { mode: 0o600, flag: "wx" });
        await rename(temporary, legacy);
      } finally { await unlink(temporary).catch(() => {}); }
    }
    return previous;
  }
  return fromValues(options.env ?? process.env, options.ignoreInvalidAppToken);
}
