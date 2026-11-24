// Agent sessions: OC:x13-cachy:sal:ses_df58f4884ffeQ73n6oD4HRDj22 Created
// Agent sessions: OC:x13-cachy:sal:ses_df1c1ceedffe0p5mflr3l2vNvR Edited
import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { configDirectory } from "./config-paths";

function accountState(name: string, team: string, user: string) {
  const dir = join(configDirectory, name);
  const key = Buffer.from(JSON.stringify([team, user])).toString("base64url");
  const path = join(dir, key);
  return {
    read(): string | undefined {
      try { return readFileSync(path, "utf8").trim(); }
      catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      }
    },
    save(value: string) {
      mkdirSync(dir, { recursive: true, mode: 0o700 });
      const temporary = `${path}.${randomUUID()}.tmp`;
      try {
        writeFileSync(temporary, value, { mode: 0o600, flag: "wx" });
        renameSync(temporary, path);
      } finally { rmSync(temporary, { force: true }); }
    },
  };
}

export function lastConversation(team: string, user: string) {
  return accountState("last-conversation", team, user);
}

export function dmBotFilter(team: string, user: string) {
  const state = accountState("dm-bot-filter", team, user);
  return {
    read: () => state.read() === "hidden",
    save: (hidden: boolean) => state.save(hidden ? "hidden" : "shown"),
  };
}
