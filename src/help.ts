import { BoxRenderable, ScrollBoxRenderable, TextRenderable, type RenderContext } from "@opentui/core";
import { credentialsPath, settingsPath } from "./config-paths";

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
      "Up / Down, then Enter — Choose and open a conversation in the sidebar.",
      "Ctrl+D — Switch between channels / group DMs and one-to-one DMs.",
      "Ctrl+L — Toggle active-only / all conversations.",
      "Ctrl+R — Refresh current messages, unread status and DM presence.",
      "Page Up / Page Down — Scroll messages.",
      "Ctrl+C — Quit.",
    ]],
    ["Writing messages", [
      "Enter — Send the message and any attached image.",
      "Shift+Enter — Expand the composer and insert a newline.",
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
      "Unread and presence checks run gradually in the background at startup and with Ctrl+R.",
      "Switching to DMs also checks presence. These are snapshots, not live updates.",
      "The active-only sidebar hides conversations Slack marks dormant and explicitly closed DMs; it is not an online-user filter.",
    ]],
    ["Files and storage", [
      `Credentials: ${credentialsPath}`,
      `Settings: ${settingsPath}`,
      "These paths honor XDG_CONFIG_HOME; otherwise they use ~/.config/slack-tui/.",
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
      "Incoming messages refresh manually with Ctrl+R; each history load shows up to 50 recent messages.",
      "No thread navigation, search, adding/removing reactions, or persistent message cache yet.",
      "Standard emoji and reaction counts are shown; custom workspace emoji remain shortcode names.",
      "If a send reports uncertain delivery, check Slack before retrying to avoid duplicates.",
    ]],
  ] as const;
  for (const [title, lines] of sections) {
    scroll.add(new TextRenderable(context, {
      content: title, fg: "#9ccfd8", width: "100%", flexShrink: 0, wrapMode: "word",
    }));
    scroll.add(new TextRenderable(context, {
      content: `${lines.join("\n")}\n\n`, fg: "#e0def4", width: "100%", flexShrink: 0, wrapMode: "word",
    }));
  }
  screen.add(new TextRenderable(context, {
    content: "[Back] Esc / F1 · ↑↓ / PgUp / PgDn / mouse wheel: scroll · Home / End",
    fg: "#9ccfd8", flexShrink: 0, wrapMode: "word",
    onMouseDown(event) {
      if (event.button === 0) { close(); event.stopPropagation(); }
    },
  }));
  return { screen, scroll };
}
