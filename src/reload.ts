export const RELOAD_EXIT_CODE = 75;
const childFlag = "SLACK_TUI_RELOAD_CHILD";

/** A stable parent restarts the UI in a fresh Bun process without nesting processes. */
export async function superviseReload() {
  if (process.env[childFlag] === "1") return;
  let child: ReturnType<typeof Bun.spawn> | undefined;
  let stopping = false;
  const stop = (signal: NodeJS.Signals) => {
    stopping = true;
    child?.kill(signal);
  };
  const interrupt = () => stop("SIGINT");
  const terminate = () => stop("SIGTERM");
  process.on("SIGINT", interrupt);
  process.on("SIGTERM", terminate);
  let code = 0;
  try {
    do {
      child = Bun.spawn([process.execPath, ...process.execArgv, ...process.argv.slice(1)], {
        stdin: "inherit", stdout: "inherit", stderr: "inherit",
        env: { ...process.env, [childFlag]: "1" },
      });
      code = await child.exited;
    } while (!stopping && code === RELOAD_EXIT_CODE);
  } finally {
    process.off("SIGINT", interrupt);
    process.off("SIGTERM", terminate);
  }
  process.exit(code);
}
