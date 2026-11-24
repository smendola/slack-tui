import { expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

test("reload starts fresh code with the same arguments and propagates the final exit code", async () => {
  const dir = await mkdtemp(join(tmpdir(), "slack-tui-reload-"));
  const entry = join(dir, "app.ts");
  const module = new URL("./reload.ts", import.meta.url).pathname;
  let child: ReturnType<typeof Bun.spawn> | undefined;
  try {
    const header = `import { superviseReload, RELOAD_EXIT_CODE } from ${JSON.stringify(module)};\nawait superviseReload();\n`;
    const replacement = header + `console.log(JSON.stringify({arg:process.argv[2], env:process.env.RELOAD_TEST}));process.exit(7);`;
    await Bun.write(entry, header +
      `await Bun.write(import.meta.path, ${JSON.stringify(replacement)});process.exit(RELOAD_EXIT_CODE);`);
    const processUnderTest = Bun.spawn([process.execPath, entry, "--demo"], {
      stdout: "pipe", stderr: "pipe", env: { ...process.env, SLACK_TUI_RELOAD_CHILD: "", RELOAD_TEST: "preserved" },
    });
    child = processUnderTest;
    expect(await processUnderTest.exited).toBe(7);
    expect(JSON.parse(await new Response(processUnderTest.stdout).text())).toEqual({ arg: "--demo", env: "preserved" });
  } finally {
    child?.kill();
    await rm(dir, { recursive: true, force: true });
  }
}, 10000);
