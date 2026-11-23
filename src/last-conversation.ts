// Agent sessions: OC:x13-cachy:sal:ses_df58f4884ffeQ73n6oD4HRDj22 Created
import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { configDirectory } from "./config-paths";

export function lastConversation(team: string, user: string) {
  const dir = join(configDirectory, "last-conversation");
  const key = Buffer.from(JSON.stringify([team, user])).toString("base64url");
  const path = join(dir, key);
  return {
    read(): string | undefined {
      try { return readFileSync(path, "utf8").trim(); }
      catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      }
    },
    save(id: string) {
      mkdirSync(dir, { recursive: true, mode: 0o700 });
      const temporary = `${path}.${randomUUID()}.tmp`;
      try {
        writeFileSync(temporary, id, { mode: 0o600, flag: "wx" });
        renameSync(temporary, path);
      } finally { rmSync(temporary, { force: true }); }
    },
  };
}
