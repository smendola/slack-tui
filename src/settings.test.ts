import { expect, test } from "bun:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadSettings, saveSettings } from "./settings";

test("missing settings default to photos on; saved false survives a reload", async () => {
  const dir = await mkdtemp(join(tmpdir(), "slack-tui-settings-"));
  const path = join(dir, "nested", "settings.json");
  try {
    expect(await loadSettings(path)).toEqual({ showProfilePhotos: true });
    await saveSettings({ showProfilePhotos: false }, path);
    expect(await loadSettings(path)).toEqual({ showProfilePhotos: false });
    expect(JSON.parse(await readFile(path, "utf8"))).toEqual({ showProfilePhotos: false });
    await saveSettings({ showProfilePhotos: true }, path);
    expect(await loadSettings(path)).toEqual({ showProfilePhotos: true });
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test("invalid settings are reported rather than silently treated as enabled", async () => {
  const dir = await mkdtemp(join(tmpdir(), "slack-tui-settings-"));
  const path = join(dir, "settings.json");
  try {
    await writeFile(path, '{"showProfilePhotos":"no"}');
    await expect(loadSettings(path)).rejects.toThrow("must be true or false");
    await writeFile(path, "{broken");
    await expect(loadSettings(path)).rejects.toThrow();
    await writeFile(path, "{}");
    expect(await loadSettings(path)).toEqual({ showProfilePhotos: true });
  } finally { await rm(dir, { recursive: true, force: true }); }
});
