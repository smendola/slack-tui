// Agent sessions: OC:x13-cachy:sal:ses_df1c1ceedffe0p5mflr3l2vNvR Edited
import type { Credentials, Manifest } from "./oauth";
import { setupCommand } from "./commands";

export type SetupOptions = { help: boolean; newApp: boolean; socket: boolean; noSocket: boolean };

export function setupOptions(args: string[]): SetupOptions {
  const options = {
    help: args.includes("--help"), newApp: args.includes("--new-app"),
    socket: args.includes("--socket"), noSocket: args.includes("--no-socket"),
  };
  if (options.help) return options;
  if (args.includes("--replace")) throw new Error("--replace was renamed to --new-app. This creates another Slack app; any existing app remains in the workspace.");
  if (args.some(arg => !["--new-app", "--socket", "--no-socket"].includes(arg))) {
    throw new Error(`Unknown option. Run ${setupCommand} --help.`);
  }
  if (options.socket && (options.noSocket || options.newApp)) {
    throw new Error("--socket cannot be combined with --no-socket or --new-app.");
  }
  return options;
}

export function setupAction(options: SetupOptions, existing?: Credentials) {
  if (options.socket) {
    if (!existing) throw new Error(`Run ${setupCommand} first to connect your Slack user.`);
    return "socket";
  }
  if (existing && !options.newApp) return !options.noSocket && !existing.appToken ? "socket" : "ready";
  return "create";
}

export function setupManifest(manifest: Manifest, options: SetupOptions): Manifest {
  const copy = structuredClone(manifest);
  copy.settings = { ...copy.settings, token_rotation_enabled: false };
  if (options.noSocket) {
    copy.settings.socket_mode_enabled = false;
    delete copy.settings.event_subscriptions;
  }
  return copy;
}
