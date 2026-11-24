import type { Credentials, Manifest } from "./oauth";

export type SetupOptions = { help: boolean; replace: boolean; socket: boolean; noSocket: boolean };

export function setupOptions(args: string[]): SetupOptions {
  const options = {
    help: args.includes("--help"), replace: args.includes("--replace"),
    socket: args.includes("--socket"), noSocket: args.includes("--no-socket"),
  };
  if (options.help) return options;
  if (args.some(arg => !["--replace", "--socket", "--no-socket"].includes(arg))) {
    throw new Error("Unknown option. Run bun run setup --help.");
  }
  if (options.socket && (options.noSocket || options.replace)) {
    throw new Error("--socket cannot be combined with --no-socket or --replace.");
  }
  return options;
}

export function setupAction(options: SetupOptions, existing?: Credentials) {
  if (options.socket) {
    if (!existing) throw new Error("Run bun run setup first to connect your Slack user.");
    return "socket";
  }
  if (existing && !options.replace) return !options.noSocket && !existing.appToken ? "socket" : "ready";
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
