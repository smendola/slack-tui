import { spawn } from "node:child_process";
import { credentialsPath } from "./config-paths";
import { loadCredentials } from "./credentials";
import { authorizationURL, createPKCE, exchangeUserToken, isAppToken, saveUserToken, slackRequest, startCallback, type App, type Credentials, type Manifest } from "./oauth";
import { verifySocketConnection } from "./live";
import { setupAction, setupManifest, setupOptions } from "./setup-options";

const root = new URL("../", import.meta.url);

function openBrowser(url: string) {
  const command = process.platform === "darwin" ? "open" : "xdg-open";
  const binary = Bun.which(command);
  if (!binary) return;
  const child = spawn(binary, [url], { stdio: "ignore" });
  child.on("error", () => {});
  child.unref();
}

function readSecret(signal: AbortSignal, label = "Configuration access token"): Promise<string> {
  if (signal.aborted) throw new Error("Setup cancelled or timed out.");
  if (!process.stdin.isTTY) throw new Error("Run setup in an interactive terminal to paste the token.");
  process.stdout.write(`${label} (masked): `);
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
        if (char === "\x7f" || char === "\b") {
          if (input.length) {
            input = input.slice(0, -1);
            process.stdout.write("\b \b");
          }
        } else if (char >= " " && char <= "~") {
          input += char;
          process.stdout.write("*");
        }
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
    promise.then(
      value => { signal.removeEventListener("abort", abort); resolve(value); },
      error => { signal.removeEventListener("abort", abort); reject(error); },
    );
  });
}

async function setupSocket(credentials: Credentials, signal: AbortSignal, configured = false) {
  const appUrl = credentials.appId ? `https://api.slack.com/apps/${credentials.appId}/general` : "https://api.slack.com/apps";
  if (!configured) {
    console.log("Enable live events for the SAME Slack app that issued your saved user token:");
    console.log(`${appUrl} → Socket Mode → Enable Socket Mode.`);
    if (credentials.clientId) console.log(`Its Client ID is ${credentials.clientId}.`);
    console.log("Event Subscriptions → Enable Events → Subscribe to events on behalf of users:");
    console.log("  message.channels, message.groups, message.im, message.mpim, reaction_added, reaction_removed");
    console.log("OAuth & Permissions → User Token Scopes: add reactions:read if it is missing.");
    console.log("Save changes and reinstall/reauthorize if Slack asks.");
  } else {
    console.log("\nNext: connect live events. Socket Mode and event subscriptions are already enabled.");
  }
  console.log(`Open ${appUrl}`);
  console.log("Basic Information → App-Level Tokens → Generate Token and Scopes.");
  console.log("Name it slack-tui-live, add connections:write, and generate the token.");
  openBrowser(appUrl);
  const appToken = await readSecret(signal, "App-level token (xapp-)");
  if (!isAppToken(appToken)) throw new Error("Expected an xapp- app-level token.");
  console.log("Verifying the live WebSocket connection…");
  await verifySocketConnection(appToken, signal, credentials.appId);
  // Re-read so a concurrent user-token refresh is not overwritten by stale credentials.
  const latest = await loadCredentials({ ignoreInvalidAppToken: true });
  if (!latest || latest.clientId !== credentials.clientId || latest.appId !== credentials.appId) {
    throw new Error("The saved Slack connection changed during setup. Run bun run setup --socket again.");
  }
  await saveUserToken(credentialsPath, latest.token, { ...latest, appToken });
  console.log(`Live connection verified. Saved app-level token to ${credentialsPath} (owner-only permissions).`);
}

async function setup() {
  const options = setupOptions(process.argv.slice(2));
  if (options.help) {
    console.log("bun run setup [--replace] [--no-socket]\nbun run setup --socket\n\nDefault: create your Slack app, authorize your user, and configure and verify live Socket Mode events in one wizard.\nRequires a Slack app configuration access token and a browser on this machine. No tunnel or domain needed.\n\n--replace: connect a new app, including live events by default.\n--no-socket: skip Socket Mode setup (manual refresh only); does not remove an existing app-level token.\n--socket: add or repair Socket Mode for the existing connection; does not create an app.\n\nIf user authorization is already saved but Socket Mode is missing, plain setup resumes the live-events step.");
    return;
  }
  const existing = options.replace ? undefined : await loadCredentials({ ignoreInvalidAppToken: options.socket });
  const action = setupAction(options, existing);
  if (action === "ready") {
    console.log("Slack is already configured. Run bun start, bun run setup --socket to repair live events, or bun run setup --replace to connect a new app.");
    return;
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
    if (action === "socket") {
      await setupSocket(existing!, signal);
      console.log("Setup complete. Run bun start (or restart slack-tui) and look for LIVE in the title.");
      return;
    }
    console.log("This wizard will create the Slack app for you. Do not click Create New App.");
    console.log("Run this command on the same machine as your browser. Setup uses a local OAuth callback.");
    console.log("\nFirst, give the wizard permission to create an app in your workspace:");
    console.log("  1. Open https://api.slack.com/apps and sign in if needed.");
    console.log("  2. Below the app list, find Your App Configuration Tokens.");
    console.log("  3. Click Generate Token and select the workspace where you want to use slack-tui.");
    console.log("  4. Copy the generated access token (not the refresh token).");
    console.log("  5. Return here, paste it into the masked prompt, and press Enter.");
    console.log("\nThen the wizard will create the app and open Slack's permission-approval page.");
    console.log("The configuration token will not be saved.\n");
    openBrowser("https://api.slack.com/apps");
    const configToken = await readSecret(signal);
    if (!configToken) throw new Error("No configuration token supplied.");
    const manifest = setupManifest(Bun.YAML.parse(await Bun.file(new URL("slack-app.yaml", root)).text()) as Manifest, options);
    callback = startCallback();
    const redirect = `http://localhost:${callback.port}/oauth/callback`;
    const pkce = createPKCE();
    console.log(`Listening for Slack authorization at ${redirect}`);
    manifest.oauth_config.redirect_urls = [redirect];
    manifest.oauth_config.pkce_enabled = true;
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
    credentials.appId = app.app_id;
    await saveUserToken(credentialsPath, credentials.token, { ...credentials, appToken: "" });
    saved = true;
    console.log(`Connected to ${identity.team} as ${identity.user}. Saved credentials to ${credentialsPath} (owner-only permissions).`);
    await callback.stop();
    callback = undefined;
    if (!options.noSocket) {
      try { await setupSocket(credentials, signal, true); }
      catch (error) {
        console.log("User authorization is saved. Run bun run setup again to finish live events without creating another app.");
        throw error;
      }
      console.log("Setup complete. Run bun start and look for LIVE in the title.");
    } else {
      console.log("Setup complete; Socket Mode was skipped. Run bun start. Run bun run setup later to add live events.");
    }
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
