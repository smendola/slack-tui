// OC:x13-cachy:sal:ses_df1a0a3d0ffezEfNl4eWrA0klm Created
const installed = process.env.SLACK_TUI_INSTALLED === "1";
export const startCommand = installed ? "slack-tui" : "bun start";
export const setupCommand = installed ? "slack-tui setup" : "bun run setup";
export const demoCommand = installed ? "slack-tui --demo" : "bun run demo";
