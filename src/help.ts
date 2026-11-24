// Agent sessions: OC:x13-cachy:sal:ses_df1c1ceedffe0p5mflr3l2vNvR Edited
import { BoxRenderable, ScrollBoxRenderable, TextRenderable, StyledText, bold, fg, link, underline, stringToStyledText, type RenderContext } from "@opentui/core";
import { homedir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { credentialsPath, settingsPath } from "./config-paths";
import { button } from "./button";

function highlightKeys(text: string) {
  const keys = /(\b(?:Ctrl\+(?:Shift\+)?(?:[A-Z]|click)|Shift\+Enter|Page (?:Up|Down)|F[12]|Tab|Enter|Space|Escape|Esc|Up|Down|PgUp|PgDn|Home|End|(?:[Dd]ouble-|[Tt]riple-)?[Cc]lick(?! (?:Remove image|Show profile photos)\b)|Remove image|Show profile photos|[Dd]rag|[Mm]ouse wheel)\b|↑↓|^\/(?= in the sidebar))/gm;
  return new StyledText(text.split(keys).flatMap((part, index) =>
    index % 2 ? [bold(fg("#ffffff")(part))] : stringToStyledText(part).chunks));
}

function pathLine(prefix: string, path: string, label = path, suffix = "") {
  return new StyledText([
    ...stringToStyledText(prefix).chunks,
    link(pathToFileURL(path).href)(underline(fg("#9ccfd8")(label))),
    ...stringToStyledText(suffix).chunks,
  ]);
}

export function createHelpScreen(context: RenderContext, close: () => void) {
  const screen = new BoxRenderable(context, {
    flexGrow: 1, minHeight: 0, flexDirection: "column", padding: 1,
    border: true, title: "Help", borderColor: "#524f67", visible: false, focusable: true,
  });
  const scroll = new ScrollBoxRenderable(context, {
    flexGrow: 1, minHeight: 0, scrollX: false,
  });
  screen.add(scroll);
  const sections = [
    ["Navigation", [
      "F1 — Open / close help. Escape also closes help.",
      "F2 — Open / close settings.",
      "Tab — Switch focus between the sidebar and composer.",
      "Shift+F5 — Reload the app from disk. Unsaved drafts and edits are discarded.",
      "Up / Down, then Enter or Space — Choose and open a conversation in the sidebar.",
      "The arrow and gray bar mark the navigation row; orange text marks the open conversation. Moving the navigation row does not open it.",
      "/ in the sidebar, or click Search names — Search all names on the current tab, including inactive conversations. Esc clears the search.",
      "Click Channels or DMs, or press Ctrl+D, to switch lists. Group DMs are under Channels.",
      "Ctrl+L — Toggle active-only / all conversations.",
      "Ctrl+B — Hide or show bots and apps in the DM sidebar, including in search results. Remembered per workspace and user.",
      "Ctrl+R — Refresh current messages, unread status and DM presence.",
      "Page Up / Page Down — Scroll messages.",
      "Ctrl+C — Quit.",
    ]],
    ["Writing messages", [
      "Enter — Send the message and any attached image.",
      "Click ✎ beside your sent message. Ctrl+S saves; Esc cancels. Your composer draft is kept.",
      "Click the smiley-plus icon below a message to open its emoji palette. Click an emoji to toggle your reaction; ✓ means you reacted.",
      "In the emoji palette, arrows choose an emoji; Space or Enter selects it. Escape or clicking outside closes the palette.",
      "Click ↳ Reply or a reply count to open a thread. Wide terminals show a resizable right panel; narrow terminals show a Back button.",
      "Thread replies have their own composer, mentions and image attachments. Enter replies only to the thread. Drafts are kept per thread for this session.",
      "Tab cycles sidebar → channel composer → thread composer. Escape closes the thread (after dismissing a picker or collapsing its composer). Ctrl+R refreshes the focused thread.",
      "Shift+Enter — Expand the composer and insert a newline.",
      "Type @ and a name to mention someone. ↑/↓ chooses; Enter or Tab inserts; Escape closes. You can also click a match.",
      "Escape — Collapse the expanded composer, keeping the draft.",
      "Ctrl+V — Paste clipboard text or attach an image (composer focused).",
      "Ctrl+G — Remove the attached image.",
      "Text and image drafts stay with their conversation during this session.",
      "Shift+Enter needs terminal support; double-click the composer to expand it instead.",
    ]],
    ["Mouse controls", [
      "Click a conversation to open it; click the composer to start writing.",
      "Drag either adjoining vertical border to resize the sidebar and chat panes.",
      "Mouse wheel over the sidebar moves through conversations; over messages it scrolls chat.",
      "Drag over message text to select it; releasing the mouse automatically copies it to the clipboard.",
      "Double-click message text to select a word; triple-click selects a logical line. Selection stays highlighted.",
      "Underlined links show their label instead of the full URL. Use your terminal's link gesture (often Ctrl+click) to open them.",
      "Double-click the composer to expand it.",
      "Click Remove image to discard an attachment.",
      "In settings, click Show profile photos (or press Space / Enter) to toggle it.",
    ]],
    ["Unread and online status", [
      "Bold conversation names mean unread messages.",
      "Opening or refreshing a conversation marks it read in Slack through the newest loaded message.",
      "If that update fails, the status line explains why; Ctrl+R retries.",
      "DM indicators: green ● = active, ○ = away, · = unknown.",
      "Socket Mode pushes new messages, edits and reactions, and updates unread indicators. The title shows LIVE when connected.",
      "bun run setup includes live events. Use --socket to repair an existing connection, or --no-socket to skip live setup.",
      "Unread catch-up and presence checks run gradually at startup and with Ctrl+R.",
      "Switching to DMs also checks presence. These are snapshots, not live updates.",
      "The active-only sidebar hides conversations Slack marks dormant and explicitly closed DMs; it is not an online-user filter.",
    ]],
    ["Files and storage", [
      pathLine("Credentials: ", credentialsPath),
      pathLine("Settings: ", settingsPath),
      pathLine("These paths honor XDG_CONFIG_HOME; otherwise they use ", join(homedir(), ".config/slack-tui/"), "~/.config/slack-tui/", "."),
      "Credentials are saved with owner-only permissions. Settings save immediately.",
      "Messages, drafts, avatars and image previews are held in memory for this session, not saved as downloads.",
      "Sending an attached image uploads it to the selected Slack conversation.",
      "Quitting discards unsent drafts and in-memory caches.",
    ]],
    ["Images and clipboard", [
      "Attach one PNG, JPEG, WebP or GIF up to 20 MiB. Pasting another image replaces it.",
      "Add an optional caption, then Enter sends the caption and image together.",
      "Clipboard access is on the machine running slack-tui, not your laptop when connected over SSH.",
      "Terminal paste shortcuts such as Ctrl+Shift+V usually paste text, not images.",
      "Copying selected messages uses the local clipboard when available, with terminal OSC 52 as a fallback.",
      "Over SSH, copying targets your terminal's clipboard; your terminal must allow OSC 52 clipboard writes.",
      "Image rendering depends on terminal graphics support; a block-image fallback is available.",
      "F2 → Show profile photos hides or shows avatars without affecting image attachments.",
    ]],
    ["Current limits", [
      "Each history load shows up to 50 recent messages. After a connection gap, older messages outside that window may not be shown.",
      "Live updates preserve drafts and your scroll position. Rendering waits while you select text, edit, or use another screen.",
      "No thread navigation, message search, or persistent message cache yet.",
      "Standard emoji and reaction counts are shown; custom workspace emoji remain shortcode names.",
      "If a send reports uncertain delivery, check Slack before retrying to avoid duplicates.",
    ]],
  ] as const;
  for (const [title, lines] of sections) {
    scroll.add(new TextRenderable(context, {
      content: title, fg: "#9ccfd8", width: "100%", flexShrink: 0, wrapMode: "word",
    }));
    scroll.add(new TextRenderable(context, {
      content: new StyledText([...lines.flatMap(line => [
        ...(typeof line === "string" ? highlightKeys(line) : line).chunks,
        ...stringToStyledText("\n").chunks,
      ]), ...stringToStyledText("\n").chunks]),
      fg: "#e0def4", width: "100%", flexShrink: 0, wrapMode: "word",
    }));
  }
  const actions = new BoxRenderable(context, { flexDirection: "row", flexShrink: 0, columnGap: 1 });
  screen.add(actions);
  actions.add(button(context, "Back", close));
  actions.add(new TextRenderable(context, {
    content: highlightKeys("Esc / F1 · ↑↓ / PgUp / PgDn / mouse wheel: scroll · Home / End"),
    fg: "#9ccfd8", flexShrink: 0, wrapMode: "word",
  }));
  return { screen, scroll };
}
