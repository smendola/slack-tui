import { mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { randomUUID } from "node:crypto";
import { settingsPath } from "./config-paths";
export { settingsPath } from "./config-paths";

export type Settings = { showProfilePhotos: boolean };
export const defaultSettings: Settings = { showProfilePhotos: true };

export async function loadSettings(path = settingsPath): Promise<Settings> {
  let contents: string;
  try { contents = await readFile(path, "utf8"); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return { ...defaultSettings };
    throw error;
  }
  const value = JSON.parse(contents);
  if (!value || typeof value !== "object" || Array.isArray(value)
    || (value.showProfilePhotos !== undefined && typeof value.showProfilePhotos !== "boolean")) {
    throw new Error("Invalid settings: showProfilePhotos must be true or false.");
  }
  return { showProfilePhotos: value.showProfilePhotos ?? defaultSettings.showProfilePhotos };
}

export async function saveSettings(settings: Settings, path = settingsPath) {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const temporary = `${path}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporary, `${JSON.stringify(settings, null, 2)}\n`, { mode: 0o600, flag: "wx" });
    await rename(temporary, path);
  } finally { await unlink(temporary).catch(() => {}); }
}
