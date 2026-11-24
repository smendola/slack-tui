// Agent sessions: OC:x13-cachy:sal:ses_df1c1ceedffe0p5mflr3l2vNvR Edited
import { BoxRenderable, MarkdownRenderable, ScrollBoxRenderable, SyntaxStyle, type RenderContext } from "@opentui/core";
import { homedir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { credentialsPath, settingsPath } from "./config-paths";
import { button } from "./button";

function fileLink(path: string, label = path) {
  const escaped = label.replace(/[\\[\]*_`<>]/g, "\\$&");
  return `[${escaped}](<${pathToFileURL(path).href}>)`;
}

const guide = `## Navigation

- **F1** opens or closes Help. **Esc** also closes it. **F2** opens or closes Settings.
- **Tab** cycles between the sidebar, the channel composer, and the thread composer if a thread is open.
- **↑ / ↓** moves the arrow and gray bar in the sidebar. **Enter** or **Space** opens that conversation; orange text marks the open one.
- Press **/** in the sidebar or click **Search names** to search the current tab, including inactive conversations. **Esc** clears the search.
- Click **Channels** or **DMs**, or press **Ctrl+D**, to switch tabs. Group DMs appear under Channels.
- **Ctrl+L** toggles Active / All. Active hides dormant conversations and closed DMs; it does not filter by online status.
- **Ctrl+B** in the DM sidebar hides or shows bots and apps, including in search results. This is remembered per workspace and user.
- **Ctrl+R** refreshes messages, unread status, and DM presence. **Page Up / Page Down** scrolls messages.
- **Shift+F5** reloads the app from disk, discarding unsaved drafts and edits. **Ctrl+C** quits.

## Writing messages

- **Enter** sends the message and any attached image. **Shift+Enter** expands the composer and inserts a newline. If your terminal doesn't support it, **double-click** the composer to expand it. **Esc** collapses it.
- Type **@** and a name to mention someone. Choose with **↑ / ↓**, then **Enter** or **Tab**, or click a match. **Esc** cancels.
- Click **✎** beside a message you sent to edit it. **Ctrl+S** saves and **Esc** cancels. Your composer draft is kept.
- Click **🗑** to preview a message and its reply count. Choose **Delete** or press **Y** to confirm; **Esc** cancels.
- Click the **smiley-plus icon** to open the emoji palette. Use the arrows and **Space / Enter** to select, or click an emoji. **Esc** or clicking outside closes the palette. Click an existing reaction to toggle yours; ✓ means you've reacted.
- Click **↳ Reply** or a **reply count** to open a thread. Wide terminals show a resizable side panel; narrow terminals show a **Back** button.
- Threads have their own drafts, mentions, and attachments. **Enter** in the thread composer replies only to the thread. **Ctrl+R** refreshes the focused thread. **Esc** closes a picker or collapses an expanded composer before closing the thread.

## Mouse controls

- **Click** a conversation to open it, or the composer to start writing.
- **Drag** an adjoining pane border to resize. **Mouse wheel** moves through sidebar conversations or scrolls messages.
- **Drag** over message text to select it; release to copy. **Double-click** selects a word; **triple-click** selects a logical line. The selection stays highlighted.
- Use your terminal's link gesture (often **Ctrl+click**) to open an underlined link.
- Click **Remove image** to discard an attachment. In Settings, click **Show profile photos** or press **Space / Enter** to toggle avatars without affecting attachments.

## Unread and online status

- **Bold conversation names** mean unread messages. Opening or refreshing a conversation marks it read in Slack through the newest loaded message. If that fails, check the status line and retry with **Ctrl+R**.
- In DMs, green **●** means active, **○** away, and **·** unknown. Presence is checked gradually at startup, when switching to DMs, and with **Ctrl+R**; it is not a live subscription.
- **LIVE** in the title means Socket Mode is connected. Messages, edits, deletions, reactions, and unread indicators update automatically. Unread catch-up also runs at startup and with **Ctrl+R**.
- \`bun run setup\` includes live events. Use \`--socket\` to repair an existing connection or \`--no-socket\` to skip live setup.

## Files and storage

- Credentials: ${fileLink(credentialsPath)} (owner-only permissions).
- Settings: ${fileLink(settingsPath)} (changes save immediately).
- These paths honor \`XDG_CONFIG_HOME\`. The default directory is ${fileLink(join(homedir(), ".config/slack-tui/"), "~/.config/slack-tui/")}.
- Messages, drafts, avatars, and image previews stay in memory. Switching conversations or a failed send preserves text and image drafts; quitting discards them. Sending an image uploads it to the selected Slack conversation.

## Images and clipboard

- **Ctrl+V** in the composer pastes clipboard text or attaches one PNG, JPEG, WebP, or GIF up to 20 MiB. Pasting another image replaces it. Add an optional caption and press **Enter** to send both. **Ctrl+G** removes the image.
- Pasting reads the clipboard on the machine running slack-tui. Over SSH it cannot read your laptop's clipboard. Terminal paste shortcuts such as **Ctrl+Shift+V** usually deliver text.
- Copying selected messages uses the local clipboard when available. Over SSH it uses the terminal clipboard via OSC 52, which your terminal must allow.
- Image quality depends on terminal graphics support; other terminals use a block-image fallback.

## Current limits

- Each channel history load shows up to 50 recent messages. After a connection gap, older messages outside that window may not appear. Opened threads fetch all reply pages.
- Live updates preserve drafts and scroll position. Redraws wait while you select text, edit a message, or use another screen.
- No message search or persistent message cache yet. Standard emoji and skin tones render as Unicode; custom workspace emoji keep their shortcode names.
- If delivery is uncertain, check Slack before retrying to avoid a duplicate.`;

export function createHelpScreen(context: RenderContext, close: () => void) {
  const syntaxStyle = SyntaxStyle.fromStyles({
    default: { fg: "#e0def4" },
    "markup.heading.2": { fg: "#9ccfd8", bold: true, underline: true },
    "markup.strong": { fg: "#ffffff", bold: true },
    "markup.link": { fg: "#9ccfd8", underline: true },
    "markup.raw": { fg: "#f6c177" },
  }, context.nativeScene);
  const markdown = (content: string) => new MarkdownRenderable(context, {
    content, syntaxStyle, conceal: true, flexShrink: 0,
  });
  const screen = new BoxRenderable(context, {
    flexGrow: 1, minHeight: 0, flexDirection: "column", padding: 1,
    border: true, title: "Help", borderColor: "#524f67", visible: false, focusable: true,
  });
  const scroll = new ScrollBoxRenderable(context, { flexGrow: 1, minHeight: 0, scrollX: false });
  screen.add(scroll);
  scroll.add(markdown(guide));
  const actions = new BoxRenderable(context, { flexDirection: "row", flexShrink: 0, columnGap: 1 });
  screen.add(actions);
  actions.add(button(context, "Back", close));
  const shortcuts = markdown("**Esc / F1** · **↑↓ / PgUp / PgDn / mouse wheel**: scroll · **Home / End**");
  shortcuts.flexShrink = 1;
  actions.add(shortcuts);
  return { screen, scroll };
}
