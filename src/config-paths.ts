import { homedir } from "node:os";
import { join } from "node:path";

export const configDirectory = join(process.env.XDG_CONFIG_HOME || join(homedir(), ".config"), "slack-tui");
export const credentialsPath = join(configDirectory, "credentials.env");
export const settingsPath = join(configDirectory, "settings.json");
