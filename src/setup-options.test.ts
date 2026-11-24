import { expect, test } from "bun:test";
import { setupAction, setupManifest, setupOptions } from "./setup-options";
import type { Manifest } from "./oauth";

test("setup includes Socket Mode by default and resumes partial authorization", () => {
  const options = setupOptions([]);
  expect(options.noSocket).toBe(false);
  expect(setupAction(options)).toBe("create");
  expect(setupAction(options, { token: "xoxp-existing" })).toBe("socket");
  expect(setupAction(options, { token: "xoxp-existing", appToken: "xapp-existing" })).toBe("ready");
  expect(setupAction(setupOptions(["--new-app"]), { token: "xoxp-existing" })).toBe("create");
  expect(() => setupOptions(["--replace"])).toThrow("renamed to --new-app");
});

test("explicit skip and repair flags do not accidentally create another app", () => {
  expect(setupAction(setupOptions(["--no-socket"]), { token: "xoxp-existing" })).toBe("ready");
  expect(setupAction(setupOptions(["--socket"]), { token: "xoxp-existing", appToken: "xapp-old" })).toBe("socket");
  expect(() => setupAction(setupOptions(["--socket"]))).toThrow("Run bun run setup first");
  expect(() => setupOptions(["--socket", "--no-socket"])).toThrow("cannot be combined");
  expect(() => setupOptions(["--socket", "--new-app"])).toThrow("cannot be combined");
  expect(() => setupOptions(["--socket", "--typo"])).toThrow("Unknown option");
  expect(setupOptions(["--socket", "--help"]).help).toBe(true);
});

test("--no-socket disables event delivery in the created manifest without mutating the default", async () => {
  const manifest = Bun.YAML.parse(await Bun.file(new URL("../slack-app.yaml", import.meta.url)).text()) as Manifest;
  const normal = setupManifest(manifest, setupOptions([]));
  expect(normal.settings?.socket_mode_enabled).toBe(true);
  expect(normal.settings?.event_subscriptions).toBeDefined();
  const skipped = setupManifest(manifest, setupOptions(["--new-app", "--no-socket"]));
  expect(skipped.settings?.socket_mode_enabled).toBe(false);
  expect(skipped.settings?.event_subscriptions).toBeUndefined();
  expect(manifest.settings?.socket_mode_enabled).toBe(true);
});
