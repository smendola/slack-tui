import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { authorizationURL, createPKCE, exchangeUserToken, saveUserToken, slackRequest, startCallback, type App, type Manifest } from "./oauth";

const root = new URL("../", import.meta.url);
const envPath = fileURLToPath(new URL(".env", root));

function openBrowser(url: string) {
  const command = process.platform === "darwin" ? "open" : "xdg-open";
  const binary = Bun.which(command);
  if (!binary) return;
  const child = spawn(binary, [url], { stdio: "ignore" });
  child.on("error", () => {});
  child.unref();
}

function readSecret(signal: AbortSignal): Promise<string> {
  if (!process.stdin.isTTY) throw new Error("Run setup in an interactive terminal to paste the configuration token.");
  process.stdout.write("Configuration access token (hidden): ");
  return new Promise((resolve, reject) => {
    let input = "";
    const previousRaw = process.stdin.isRaw;
    const cleanup = () => {
      process.stdin.off("data", onData);
      signal.removeEventListener("abort", onAbort);
      process.stdin.setRawMode(previousRaw);
      process.stdin.pause();
      process.stdout.write("\n");
    };
    const onAbort = () => { cleanup(); reject(new Error("Setup cancelled.")); };
    const onData = (data: Buffer) => {
      // Strip bracketed-paste delimiters; do not echo secrets.
      for (const char of data.toString().replace(/\x1b\[(?:200|201)~/g, "")) {
        if (char === "\x03") { onAbort(); return; }
        if (char === "\r" || char === "\n") { cleanup(); resolve(input.trim()); return; }
        if (char === "\x7f" || char === "\b") input = input.slice(0, -1);
        else if (char >= " " && char <= "~") input += char;
      }
    };
    signal.addEventListener("abort", onAbort, { once: true });
    process.stdin.setRawMode(true);
    process.stdin.resume();
    process.stdin.on("data", onData);
  });
}

function waitFor<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise((resolve, reject) => {
    const abort = () => reject(new Error("Setup cancelled or timed out."));
    if (signal.aborted) { abort(); return; }
    signal.addEventListener("abort", abort, { once: true });
    promise.then(resolve, reject).finally(() => signal.removeEventListener("abort", abort));
  });
}

async function setup() {
  if (process.argv.includes("--help")) {
    console.log("bun run setup [--replace]\nCreates your own Slack app and authorizes it using PKCE and a localhost callback.\nRequires a Slack app configuration access token and a browser on this machine. No tunnel or domain needed.\n--replace: replace an existing SLACK_USER_TOKEN after successful authorization.");
    return;
  }
  if (process.argv.slice(2).some(arg => arg !== "--replace")) throw new Error("Unknown option. Run bun run setup --help.");
  const existing = await Bun.file(envPath).text().catch(error => {
    if (error.code === "ENOENT") return "";
    throw error;
  });
  if (!process.argv.includes("--replace") && (process.env.SLACK_USER_TOKEN || /^\s*(?:export\s+)?SLACK_USER_TOKEN\s*=/m.test(existing))) {
    throw new Error("A Slack token is already configured. Run bun start, or bun run setup --replace to connect a new app.");
  }
  const controller = new AbortController();
  const cancel = () => controller.abort();
  process.once("SIGINT", cancel);
  process.once("SIGTERM", cancel);
  const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(15 * 60_000)]);
  let callback: ReturnType<typeof startCallback> | undefined;
  let app: App | undefined;
  let saved = false;
  try {
    console.log("This wizard will create the Slack app for you. Do not click Create New App.");
    console.log("Run this command on the same machine as your browser. Setup uses a local OAuth callback.");
    console.log("\nFirst, give the wizard permission to create an app in your workspace:");
    console.log("  1. Open https://api.slack.com/apps and sign in if needed.");
    console.log("  2. Below the app list, find Your App Configuration Tokens.");
    console.log("  3. Click Generate Token and select the workspace where you want to use slack-tui.");
    console.log("  4. Copy the generated access token (not the refresh token).");
    console.log("  5. Return here, paste it into the hidden prompt, and press Enter.");
    console.log("\nThen the wizard will create the app and open Slack's permission-approval page.");
    console.log("The configuration token will not be saved.\n");
    openBrowser("https://api.slack.com/apps");
    const configToken = await readSecret(signal);
    if (!configToken) throw new Error("No configuration token supplied.");
    const manifest = Bun.YAML.parse(await Bun.file(new URL("slack-app.yaml", root)).text()) as Manifest;
    callback = startCallback();
    const redirect = `http://localhost:${callback.port}/oauth/callback`;
    const pkce = createPKCE();
    console.log(`Listening for Slack authorization at ${redirect}`);
    manifest.oauth_config.redirect_urls = [redirect];
    manifest.oauth_config.pkce_enabled = true;
    manifest.settings = { ...manifest.settings, token_rotation_enabled: false };
    console.log("Creating app with the permissions in slack-app.yaml…");
    app = await slackRequest<App>("apps.manifest.create", { manifest: JSON.stringify(manifest) }, `Bearer ${configToken}`, signal);
    if (!app.app_id || !app.credentials?.client_id) throw new Error("Slack returned incomplete app credentials.");
    console.log(`Created app ${app.app_id}. Approve access in your browser (workspace admin approval may be required).`);
    const url = authorizationURL(app, redirect, callback.state, manifest.oauth_config.scopes.user, pkce.challenge);
    console.log(`\n${url}\n`);
    openBrowser(url);
    const result = await waitFor(callback.result, signal);
    if (result.error) throw new Error("Slack authorization was declined or requires administrator approval.");
    const credentials = await exchangeUserToken(app, result.code!, redirect, manifest.oauth_config.scopes.user, pkce.verifier, signal);
    const identity = await slackRequest<{ team: string; user: string }>("auth.test", {}, `Bearer ${credentials.token}`, signal);
    await saveUserToken(envPath, credentials.token, credentials);
    saved = true;
    console.log(`Connected to ${identity.team} as ${identity.user}. Saved user token to .env (owner-only permissions).`);
    console.log("Run bun start to open Slack.");
  } finally {
    process.off("SIGINT", cancel);
    process.off("SIGTERM", cancel);
    await callback?.stop();
    if (app?.app_id && !saved) {
      console.log(`App ${app.app_id} was created but setup did not finish. Existing credentials were not changed.`);
      console.log(`You can install it manually at https://api.slack.com/apps/${app.app_id}/oauth or delete it before retrying. Each setup run creates a new app.`);
    }
  }
}

await setup().catch(error => {
  console.error(error instanceof Error ? error.message : "Setup failed.");
  process.exitCode = 1;
});
