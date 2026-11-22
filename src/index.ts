import {
  BoxRenderable, TextRenderable, ScrollBoxRenderable,
  SelectRenderableEvents, TextareaRenderable, createCliRenderer,
  StyledText, bg, fg, ImageRenderable, createHostClipboard, type HostClipboardService,
} from "@opentui/core";
import { Slack, Demo, channelName, displayText, messageText, isSidebarActive, type Channel, type Message } from "./slack";
import { ChannelSelect } from "./channel-select";
import { isUserToken, tokenProvider } from "./oauth";
import { fileURLToPath } from "node:url";
import { clipboardImage, MAX_IMAGE_BYTES, type ImageAttachment } from "./attachment";

const demo = process.argv.includes("--demo");
const token = process.env.SLACK_USER_TOKEN;
if (!demo && (!token || !isUserToken(token))) {
  console.error("Set SLACK_USER_TOKEN to your xoxp- user OAuth token in .env.\nSee README.md for setup, or run: bun run demo");
  process.exit(1);
}
const chat = demo ? new Demo() : new Slack(tokenProvider({
  token: token!, clientId: process.env.SLACK_CLIENT_ID, refreshToken: process.env.SLACK_REFRESH_TOKEN,
  expiresAt: process.env.SLACK_TOKEN_EXPIRES_AT ? Number(process.env.SLACK_TOKEN_EXPIRES_AT) : undefined,
}, fileURLToPath(new URL("../.env", import.meta.url))));
const renderer = await createCliRenderer({ exitOnCtrlC: true });
const root = new BoxRenderable(renderer, { width: "100%", height: "100%", flexDirection: "column", backgroundColor: "#191724" });
renderer.root.add(root);
const title = new TextRenderable(renderer, { content: " slack-tui · Connecting…", height: 1, fg: "#c4a7e7" });
root.add(title);
const body = new BoxRenderable(renderer, {
  flexDirection: "row", flexGrow: 1, minHeight: 0,
  onMouseDown(event) {
    if (event.button !== 0 || (event.x !== sidebar.x + sidebar.width - 1 && event.x !== pane.x)) return;
    dragStart = { x: event.x, width: sidebar.width };
    event.stopPropagation();
  },
  onMouseDrag(event) {
    if (!dragStart) return;
    preferredSidebarWidth = dragStart.width + event.x - dragStart.x;
    resizeSidebar();
    event.stopPropagation();
  },
  onMouseUp() { finishDrag(); },
  onMouseDragEnd() { finishDrag(); },
});
root.add(body);
const sidebar = new BoxRenderable(renderer, { width: 28, flexShrink: 0, border: true, title: "Conversations", borderColor: "#524f67" });
body.add(sidebar);
const menu = new ChannelSelect(renderer, {
  width: "100%", height: "100%", options: [], showDescription: false,
  backgroundColor: "#191724", textColor: "#e0def4", selectedBackgroundColor: "#403d52",
  selectedTextColor: "#f6c177",
});
sidebar.add(menu);
let preferredSidebarWidth = 28;
let dragStart: { x: number; width: number } | undefined;
function resizeSidebar() {
  const available = Math.max(0, body.width);
  const minimum = Math.min(18, Math.floor(available / 3));
  const maximum = Math.max(minimum, available - Math.min(30, Math.floor(available * 2 / 3)));
  sidebar.width = Math.max(minimum, Math.min(maximum, preferredSidebarWidth));
}
function finishDrag() {
  if (!dragStart) return;
  dragStart = undefined;
  preferredSidebarWidth = sidebar.width;
}
body.on("resize", resizeSidebar);
const pane = new BoxRenderable(renderer, { flexGrow: 1, minWidth: 0, flexDirection: "column", border: true, borderColor: "#524f67" });
body.add(pane);
const heading = new TextRenderable(renderer, { content: "Select a conversation", height: 1, fg: "#9ccfd8" });
pane.add(heading);
const scroll = new ScrollBoxRenderable(renderer, { flexGrow: 1, minHeight: 0, scrollX: false, stickyScroll: true, stickyStart: "bottom" });
pane.add(scroll);
const messages = new TextRenderable(renderer, { width: "100%", content: "", fg: "#e0def4", flexShrink: 0, wrapMode: "word" });
scroll.add(messages);
const attachmentBox = new BoxRenderable(renderer, {
  width: "100%", height: 7, flexShrink: 0, flexDirection: "row", visible: false, backgroundColor: "#26233a",
});
const attachmentPreview = new ImageRenderable(renderer, {
  width: 18, height: 6, fit: "fit",
  onError: () => report("Image attached; preview unavailable. Enter sends it; Ctrl+G removes it."),
});
attachmentBox.add(attachmentPreview);
const attachmentDetails = new BoxRenderable(renderer, { flexGrow: 1, minWidth: 0, flexDirection: "column" });
attachmentBox.add(attachmentDetails);
const attachmentLabel = new TextRenderable(renderer, { content: "", fg: "#b8b8b8", wrapMode: "word" });
attachmentDetails.add(attachmentLabel);
attachmentDetails.add(new TextRenderable(renderer, {
  content: "[Remove image]  Ctrl+G", fg: "#9ccfd8", height: 1,
  onMouseDown(event) { if (event.button === 0) { removeImage(); event.stopPropagation(); } },
}));
pane.add(attachmentBox);
let composerExpanded = false;
let lastComposerClick: { time: number; x: number; y: number } | undefined;
const composer = new TextareaRenderable(renderer, {
  width: "100%", height: 1, flexShrink: 0, minHeight: 1,
  placeholder: "Message…", backgroundColor: "#26233a", focusedBackgroundColor: "#403d52",
  keyBindings: [{ name: "return", action: "submit" }],
  onSubmit: () => { void sendMessage(); },
  onMouseDown(event) {
    if (event.button !== 0) return;
    const now = Date.now();
    if (lastComposerClick && now - lastComposerClick.time < 400
      && Math.abs(event.x - lastComposerClick.x) <= 1 && Math.abs(event.y - lastComposerClick.y) <= 1) {
      setComposerExpanded(true);
      lastComposerClick = undefined;
    } else {
      lastComposerClick = { time: now, x: event.x, y: event.y };
    }
  },
});
pane.add(composer);
function setComposerExpanded(expanded: boolean) {
  composerExpanded = expanded;
  scroll.visible = !expanded;
  composer.height = expanded ? "auto" : 1;
  composer.flexGrow = expanded ? 1 : 0;
  if (expanded) composer.focus();
}
const status = new TextRenderable(renderer, { content: "Connecting…", height: 1, fg: "#908caa" });
root.add(status);
root.add(new TextRenderable(renderer, {
  content: " Ctrl+V: paste image/text · Ctrl+G: remove image · Shift+Enter: expand/newline · Enter: send · Ctrl+D: DMs · Ctrl+R: refresh",
  height: 1, fg: "#908caa",
}));

let selected: Channel | undefined;
let allChannels: Channel[] = [];
let showDMs = false;
let showAll = false;
function updateSidebar() {
  const channels = allChannels.filter(channel => !!channel.is_im === showDMs
    && (showAll || channel.id === selected?.id || isSidebarActive(channel)));
  sidebar.title = `${showDMs ? "DMs" : "Channels"} · ${showAll ? "All" : "Active"} (${channels.length})`;
  menu.options = channels.map(channel => ({ name: channelName(channel, chat.users), description: "", value: channel }));
  const index = channels.findIndex(channel => channel.id === selected?.id);
  menu.setSelectedIndex(Math.max(0, index));
}
let currentMessages: Message[] = [];
let generation = 0;
let sending = false;
let closed = false;
const drafts = new Map<string, string>();
const imageDrafts = new Map<string, ImageAttachment>();
let clipboard: HostClipboardService | undefined;
let readingClipboard = false;
let pasteGeneration = 0;
renderer.once("destroy", () => {
  closed = true;
  imageDrafts.clear();
  void clipboard?.dispose().catch(() => {});
});
function report(text: string) { if (!closed) status.content = displayText(text, chat.users); }
function updateAttachment() {
  const image = selected ? imageDrafts.get(selected.id) : undefined;
  attachmentBox.visible = !!image;
  attachmentPreview.source = image?.bytes;
  attachmentLabel.content = image ? `${image.filename}\n${image.mimeType} · ${Math.ceil(image.bytes.length / 1024)} KiB\nAdd an optional caption below; Enter sends both.` : "";
}
function removeImage() {
  if (sending) { report("Wait for the current send to finish."); return; }
  pasteGeneration++;
  if (selected) imageDrafts.delete(selected.id);
  updateAttachment();
  composer.focus();
}
async function pasteClipboard() {
  if (readingClipboard || sending || !selected) return;
  const channel = selected.id;
  const request = ++pasteGeneration;
  readingClipboard = true;
  report("Reading clipboard…");
  try {
    clipboard ??= createHostClipboard({ maxReadBytes: MAX_IMAGE_BYTES, timeoutMs: 5_000, maxImagePixels: 40_000_000 });
    const result = await clipboard.read({ preferredTypes: ["image/png", "image/jpeg", "image/webp", "image/gif", "text/plain"] });
    if (closed || request !== pasteGeneration || selected?.id !== channel) return;
    if (result.status !== "read") {
      report(`Clipboard ${result.status}. Ctrl+V reads this machine's clipboard; terminal paste still works for text.`);
      return;
    }
    const { mimeType, bytes } = result.representation;
    if (mimeType === "text/plain") {
      const text = new TextDecoder().decode(bytes).replace(/\r\n?/g, "\n").replace(/[\x00-\x08\x0b-\x1f\x7f]/g, "");
      if (text.includes("\n")) setComposerExpanded(true);
      composer.insertText(text);
      report("Text pasted");
    } else {
      const image = clipboardImage(bytes, mimeType);
      imageDrafts.set(channel, image);
      updateAttachment();
      report("Image attached · Enter sends image + caption · Ctrl+G removes");
    }
  } catch (error) { if (request === pasteGeneration) report(String(error)); }
  finally { readingClipboard = false; }
}
function renderMessages() {
  messages.content = currentMessages.length ? new StyledText(currentMessages.flatMap((message, index) => {
    const name = chat.users.get(message.user ?? "") ?? message.user ?? message.bot_id ?? "Slack";
    const time = new Date(Number(message.ts) * 1000).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    const files = message.files?.map(file => `[file: ${file.name ?? "attachment"}]`).join("\n");
    return [
      fg("#e0def4")(index ? "\n\n" : ""),
      bg("#444444")(fg("#b8b8b8")(` ${displayText(name, chat.users)}  ${time} `)),
      fg("#e0def4")(`\n${messageText(message, chat.users)}${files ? `\n${files}` : ""}${message.reply_count ? `\n↳ ${message.reply_count} replies (not loaded)` : ""}`),
    ];
  })) : "No messages yet.";
}
async function load(channel: Channel) {
  if (closed) return;
  if (sending) { report("Wait for the current send to finish."); return; }
  if (selected) drafts.set(selected.id, composer.plainText);
  pasteGeneration++;
  const changedChannel = selected?.id !== channel.id;
  selected = channel;
  composer.setText(drafts.get(channel.id) ?? "");
  updateAttachment();
  if (changedChannel) setComposerExpanded(composer.plainText.includes("\n"));
  heading.content = channelName(channel, chat.users);
  currentMessages = [];
  messages.content = "Loading…";
  const request = ++generation;
  report("Loading recent messages…");
  try {
    const result = await chat.history(channel.id);
    if (closed || request !== generation) return;
    currentMessages = result;
    renderMessages();
    scroll.scrollTo(Infinity);
    report(`${result.length} recent messages · Refresh with Ctrl+R`);
  } catch (error) {
    if (closed || request !== generation) return;
    messages.content = "Unable to load history. Ctrl+R to retry.";
    report(String(error));
  }
}
menu.on(SelectRenderableEvents.ITEM_SELECTED, (_index, option) => {
  if (option?.value) void load(option.value);
});
async function sendMessage() {
  const text = composer.plainText.trim();
  const image = selected ? imageDrafts.get(selected.id) : undefined;
  if ((!text && !image) || !selected || sending || readingClipboard) return;
  const channel = selected;
  const original = composer.plainText;
  const request = ++generation; // A pending history response must not overwrite this send.
  sending = true;
  report(image ? "Uploading image and sending caption…" : "Sending…");
  try {
    const message = await chat.send(channel.id, text, image);
    if (closed) return;
    if (request === generation) {
      currentMessages.push(message);
      renderMessages();
      scroll.scrollTo(Infinity);
    }
    if (composer.plainText === original) {
      composer.setText("");
      setComposerExpanded(false);
    }
    drafts.set(channel.id, composer.plainText);
    if (imageDrafts.get(channel.id) === image) imageDrafts.delete(channel.id);
    updateAttachment();
    report("Sent · Ctrl+R to fetch incoming messages");
  } catch (error) {
    report(String(error).includes("missing_scope")
      ? "Image upload needs files:write under User Token Scopes. Add it in Slack app settings and reinstall/reauthorize. Draft kept."
      : `${String(error)} · Draft kept; check Slack before retrying if delivery is uncertain.`);
  } finally { sending = false; }
}
renderer.keyInput.on("keypress", key => {
  if (composer.focused && key.ctrl && key.name === "v") {
    key.preventDefault();
    void pasteClipboard();
  } else if (key.ctrl && key.name === "g") {
    key.preventDefault();
    removeImage();
  } else if (composer.focused && key.shift && (key.name === "return" || key.name === "enter")) {
    key.preventDefault();
    setComposerExpanded(true);
    composer.newLine();
  } else if (key.name === "escape" && composerExpanded) {
    key.preventDefault();
    setComposerExpanded(false);
  } else if (key.name === "tab") {
    key.preventDefault();
    if (composer.focused) menu.focus(); else composer.focus();
  } else if (key.ctrl && key.name === "d") {
    key.preventDefault();
    showDMs = !showDMs;
    updateSidebar();
    menu.focus();
  } else if (key.ctrl && key.name === "l") {
    key.preventDefault();
    showAll = !showAll;
    updateSidebar();
    menu.focus();
  } else if (key.ctrl && key.name === "r") {
    key.preventDefault();
    if (selected) void load(selected);
  } else if (!composerExpanded && (key.name === "pageup" || key.name === "pagedown")) {
    key.preventDefault();
    scroll.scrollBy(key.name === "pageup" ? -10 : 10);
  }
});
menu.focus();
try {
  const identity = await chat.connect();
  const channels = await chat.channels();
  if (!closed) {
    title.content = ` slack-tui · ${identity.team} · ${identity.user}${demo ? " · DEMO" : ""}`;
    channels.sort((a, b) => Number(!!a.is_im) - Number(!!b.is_im) || channelName(a, chat.users).localeCompare(channelName(b, chat.users)));
    allChannels = channels;
    showDMs = channels.length > 0 && channels.every(channel => channel.is_im);
    updateSidebar();
    const first = menu.getSelectedOption()?.value as Channel | undefined;
    if (first) await load(first);
    else if (channels.length) report("No active conversations here · Ctrl+L: show all · Ctrl+D: DMs/channels");
    else report("No conversations found for this user.");
  }
} catch (error) { report(`${String(error)} · Check token/scopes, then restart.`); }
