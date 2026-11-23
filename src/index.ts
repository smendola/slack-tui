import {
  BoxRenderable, TextRenderable, ScrollBoxRenderable,
  SelectRenderableEvents, TextareaRenderable, createCliRenderer,
  StyledText, bg, fg, BorderChars, ImageRenderable, createHostClipboard, type HostClipboardService,
} from "@opentui/core";
import { Slack, Demo, channelName, displayText, messageText, isSidebarActive, laterTimestamp, type Channel, type Message } from "./slack";
import { ChannelSelect } from "./channel-select";
import { tokenProvider } from "./oauth";
import { credentialsPath } from "./config-paths";
import { loadCredentials } from "./credentials";
import { clipboardImage, MAX_IMAGE_BYTES, type ImageAttachment } from "./attachment";
import { AvatarCache } from "./avatars";
import { defaultSettings, loadSettings, saveSettings, settingsPath, type Settings } from "./settings";
import { messageImages, MessageImageCache } from "./message-images";
import { renderEmoji } from "./emoji";

const demo = process.argv.includes("--demo");
let settingsLoadError = "";
let settings: Settings = await loadSettings().catch(error => {
  settingsLoadError = `Could not load settings: ${String(error)}`;
  return { ...defaultSettings };
});
const credentials = demo ? undefined : await loadCredentials().catch(error => {
  console.error(error instanceof Error ? error.message : "Unable to load credentials.");
  process.exit(1);
});
if (!demo && !credentials) {
  console.error(`Run bun run setup to connect Slack.\nCredentials are stored in ${credentialsPath}.\nOr try: bun run demo`);
  process.exit(1);
}
const chat = demo ? new Demo() : new Slack(tokenProvider(credentials!, credentialsPath));
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
const pane = new BoxRenderable(renderer, { flexGrow: 1, minWidth: 0, flexDirection: "column" });
body.add(pane);
const chatSection = new BoxRenderable(renderer, {
  flexGrow: 1, minHeight: 2, flexDirection: "column",
  border: ["top", "left", "right"], borderColor: "#524f67",
});
pane.add(chatSection);
const heading = new TextRenderable(renderer, { content: "Select a conversation", height: 1, fg: "#9ccfd8" });
chatSection.add(heading);
const scroll = new ScrollBoxRenderable(renderer, { flexGrow: 1, minHeight: 0, scrollX: false, stickyScroll: true, stickyStart: "bottom" });
chatSection.add(scroll);
const messages = new BoxRenderable(renderer, { width: "100%", flexDirection: "column", flexShrink: 0 });
scroll.add(messages);
const avatarCache = new AvatarCache();
const messageImageCache = new MessageImageCache(image => chat.readImage(image));
let messageRenderVersion = 0;
function clearMessages() {
  messageRenderVersion++;
  for (const child of [...messages.getChildren()]) {
    messages.remove(child);
    child.destroyRecursively();
  }
}
function showMessageStatus(content: string) {
  clearMessages();
  messages.add(new TextRenderable(renderer, { content, fg: "#e0def4" }));
}
const composerSection = new BoxRenderable(renderer, {
  flexDirection: "column", flexShrink: 0, border: true, borderColor: "#524f67",
  customBorderChars: { ...BorderChars.single, topLeft: "├", topRight: "┤" },
});
pane.add(composerSection);
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
composerSection.add(attachmentBox);
let composerExpanded = false;
let lastComposerClick: { time: number; x: number; y: number } | undefined;
const composer = new TextareaRenderable(renderer, {
  width: "100%", height: 1, flexShrink: 0, minHeight: 1,
  placeholder: "Message…", backgroundColor: "#191724", focusedBackgroundColor: "#191724",
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
composerSection.add(composer);
function setComposerExpanded(expanded: boolean) {
  composerExpanded = expanded;
  scroll.visible = !expanded;
  chatSection.flexGrow = expanded ? 0 : 1;
  composerSection.flexGrow = expanded ? 1 : 0;
  composerSection.border = expanded ? ["left", "right", "bottom"] : true;
  composer.height = expanded ? "auto" : 1;
  composer.flexGrow = expanded ? 1 : 0;
  if (expanded) composer.focus();
}
const status = new TextRenderable(renderer, { content: "Connecting…", height: 1, fg: "#908caa" });
let settingsOpen = false;
let settingsSaving = false;
let returnToComposer = false;
const settingsScreen = new BoxRenderable(renderer, {
  flexGrow: 1, minHeight: 0, flexDirection: "column", padding: 1,
  border: true, title: "Settings", borderColor: "#524f67", visible: false, focusable: true,
});
root.add(settingsScreen);
const photosSetting = new TextRenderable(renderer, {
  content: "", fg: "#e0def4", height: 2,
  onMouseDown(event) {
    if (event.button === 0) { void toggleProfilePhotos(); event.stopPropagation(); }
  },
});
settingsScreen.add(photosSetting);
const settingsNotice = new TextRenderable(renderer, { content: "", fg: "#908caa", wrapMode: "word" });
settingsScreen.add(settingsNotice);
settingsScreen.add(new TextRenderable(renderer, {
  content: "\n[Back to chat]  Esc / F2", fg: "#9ccfd8", height: 2,
  onMouseDown(event) { if (event.button === 0) { closeSettings(); event.stopPropagation(); } },
}));
function updateSettingsScreen() {
  photosSetting.content = `Show profile photos:  ${settings.showProfilePhotos ? "[Yes]  No" : "Yes  [No]"}${settingsSaving ? "  Saving…" : ""}`;
  settingsNotice.content = `${settingsLoadError || "Click or press Space / Enter to toggle. Changes save automatically."}\n\nStored in ${settingsPath}`;
}
function openSettings() {
  if (settingsOpen) return;
  returnToComposer = composer.focused;
  settingsOpen = true;
  body.visible = false;
  settingsScreen.visible = true;
  updateSettingsScreen();
  settingsScreen.focus();
}
function closeSettings() {
  if (!settingsOpen) return;
  settingsOpen = false;
  settingsScreen.visible = false;
  body.visible = true;
  if (returnToComposer) composer.focus(); else menu.focus();
}
async function toggleProfilePhotos() {
  if (settingsSaving || !settingsOpen) return;
  settingsSaving = true;
  updateSettingsScreen();
  const next = { ...settings, showProfilePhotos: !settings.showProfilePhotos };
  try {
    await saveSettings(next);
    settings = next;
    settingsLoadError = "";
    if (!closed && currentMessages.length) {
      const position = scroll.scrollTop;
      renderMessages();
      scroll.scrollTo(position);
    }
  } catch (error) {
    settingsLoadError = `Could not save settings: ${String(error)}`;
  } finally {
    settingsSaving = false;
    if (!closed) updateSettingsScreen();
  }
}
root.add(status);
root.add(new TextRenderable(renderer, {
  content: " F2: settings · Ctrl+V: paste image/text · Ctrl+G: remove image · Shift+Enter: newline · Enter: send · Ctrl+D: DMs · Ctrl+R: refresh",
  height: 1, fg: "#908caa",
}));

let selected: Channel | undefined;
let allChannels: Channel[] = [];
let showDMs = false;
let showAll = false;
const locallyRead = new Map<string, string>();
let checkingUnread = false;
let checkingPresence = false;
async function refreshPresence() {
  if (checkingPresence || closed) return;
  checkingPresence = true;
  const visible = new Set(menu.options.map(option => option.value.id));
  const channels = allChannels.filter(channel => channel.is_im && channel.user)
    .sort((a, b) => Number(visible.has(b.id)) - Number(visible.has(a.id))
      || Number(isSidebarActive(b)) - Number(isSidebarActive(a)));
  const checked = new Set<string>();
  try {
    for (const channel of channels) {
      if (closed) break;
      const user = channel.user!;
      if (checked.has(user)) continue;
      checked.add(user);
      const presence = await chat.presence(user);
      if (closed) break;
      for (const dm of channels) {
        if (dm.user === user) dm.presence = presence;
      }
      menu.requestRender();
      if (!demo) await new Promise(resolve => setTimeout(resolve, 1300));
    }
  } catch (error) {
    report(`Presence check paused: ${String(error)} · Ctrl+R to retry`);
  } finally {
    checkingPresence = false;
  }
}
async function refreshUnread() {
  if (checkingUnread || closed) return;
  checkingUnread = true;
  // Prioritize the current sidebar; spread requests across time to respect Slack's
  // per-method rate limits. This is a single sweep, not continuous polling.
  const visible = new Set(menu.options.map(option => option.value.id));
  const channels = [...allChannels].sort((a, b) => Number(visible.has(b.id)) - Number(visible.has(a.id)));
  try {
    for (const channel of channels) {
      if (closed) break;
      const cursor = locallyRead.get(channel.id);
      const unread = await chat.unread(channel.id, cursor);
      if (closed) break;
      // A history load completed while this request was in flight.
      if (cursor === locallyRead.get(channel.id)) {
        channel.unread = unread;
        menu.requestRender();
      }
      if (!demo) await new Promise(resolve => setTimeout(resolve, 1300));
    }
  } catch (error) {
    report(`Unread check paused: ${String(error)} · Ctrl+R to retry`);
  } finally {
    checkingUnread = false;
  }
}
function readLocally(channel: Channel, messages: Message[]) {
  let cursor = locallyRead.get(channel.id);
  for (const message of messages) cursor = laterTimestamp(cursor, message.ts);
  if (cursor) locallyRead.set(channel.id, cursor);
  channel.unread = false;
  menu.requestRender();
}
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
  clearMessages();
  const version = messageRenderVersion;
  if (!currentMessages.length) { showMessageStatus("No messages yet."); return; }
  for (const message of currentMessages) {
    const name = displayText(message.username || chat.users.get(message.user ?? "") || message.bot_profile?.name || message.user || message.bot_id || "Slack", chat.users);
    const time = new Date(Number(message.ts) * 1000).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    const images = messageImages(message);
    const imageLabels = new Set(images.map(image => image.label));
    const files = message.files?.filter(file => !imageLabels.has(file.name || file.title || "Image"))
      .map(file => `[file: ${file.name ?? "attachment"}]`).join("\n");
    const row = new BoxRenderable(renderer, { width: "100%", flexDirection: "row", flexShrink: 0, minHeight: settings.showProfilePhotos ? 2 : 0, marginBottom: 1, columnGap: settings.showProfilePhotos ? 1 : 0 });
    let avatarColumn: BoxRenderable | undefined;
    let fallback: TextRenderable | undefined;
    if (settings.showProfilePhotos) {
      avatarColumn = new BoxRenderable(renderer, { width: 4, height: 2, flexShrink: 0 });
      const initials = name.trim().split(/\s+/).slice(0, 2).map(part => Array.from(part)[0] ?? "").join("").toUpperCase();
      fallback = new TextRenderable(renderer, { content: initials, width: 4, height: 2, fg: "#b8b8b8", bg: "#403d52" });
      avatarColumn.add(fallback);
      row.add(avatarColumn);
    }
    const textColumn = new BoxRenderable(renderer, { flexDirection: "column", flexGrow: 1, flexBasis: 0, minWidth: 0 });
    textColumn.add(new TextRenderable(renderer, {
      width: "100%", flexShrink: 0, wrapMode: "word",
      content: new StyledText([bg("#444444")(fg("#b8b8b8")(` ${name}  ${time} `))]),
    }));
    textColumn.add(new TextRenderable(renderer, {
      width: "100%", flexShrink: 0, fg: "#e0def4", wrapMode: "word",
      content: `${messageText(message, chat.users)}${files ? `\n${files}` : ""}${message.reply_count ? `\n↳ ${message.reply_count} replies (not loaded)` : ""}`,
    }));
    for (const source of images) {
      const label = new TextRenderable(renderer, {
        content: `[image: ${displayText(source.label, chat.users)}] Loading…`,
        fg: "#908caa", width: "100%", flexShrink: 0, wrapMode: "word",
      });
      textColumn.add(label);
      let aspect = 1;
      const image = new ImageRenderable(renderer, {
        width: "100%", maxWidth: 60, height: 8, flexShrink: 0, fit: "fit",
        onLoad: loaded => {
          if (closed || version !== messageRenderVersion) return;
          aspect = loaded.height / Math.max(1, loaded.width);
          resizeImage();
          label.content = displayText(source.label, chat.users);
        },
        onError: () => {
          if (closed || version !== messageRenderVersion) return;
          image.visible = false;
          label.content = `[image: ${displayText(source.label, chat.users)}] Preview unavailable`;
        },
      });
      function resizeImage() {
        const height = Math.max(2, Math.min(12, Math.ceil(image.width * aspect / 2)));
        if (image.height !== height) image.height = height;
      }
      image.on("resize", resizeImage);
      textColumn.add(image);
      void messageImageCache.get(source).then(bytes => {
        if (!closed && version === messageRenderVersion) image.source = bytes;
      }).catch(error => {
        if (closed || version !== messageRenderVersion) return;
        image.visible = false;
        label.content = `[image: ${displayText(source.label, chat.users)}] ${displayText(String(error), chat.users)}`;
      });
    }
    if (message.reactions?.length) {
      textColumn.add(new TextRenderable(renderer, {
        width: "100%", flexShrink: 0, wrapMode: "word", fg: "#9ccfd8",
        content: message.reactions.map(reaction => `${renderEmoji(`:${reaction.name}:`)} ${reaction.count}`).join("  "),
      }));
    }
    row.add(textColumn);
    messages.add(row);
    const url = message.icons?.image_48 || message.bot_profile?.icons?.image_72 || message.bot_profile?.icons?.image_48 || chat.avatars.get(message.user ?? "");
    if (url && avatarColumn && fallback) {
      const avatarTarget = avatarColumn;
      const initialsFallback = fallback;
      void avatarCache.get(url).then(bytes => {
        if (!bytes || closed || version !== messageRenderVersion) return;
        const avatar = new ImageRenderable(renderer, {
          width: 4, height: 2, position: "absolute", top: 0, left: 0, fit: "cover",
          onLoad: () => { if (!closed && version === messageRenderVersion) initialsFallback.visible = false; },
          onError: () => { if (!closed && version === messageRenderVersion) initialsFallback.visible = true; },
        });
        avatarTarget.add(avatar);
        avatar.source = bytes;
      });
    }
  }
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
  composer.placeholder = `Message ${channelName(channel, chat.users).replace(/^[#@🔒]\s+/u, "")}`;
  currentMessages = [];
  showMessageStatus("Loading…");
  const request = ++generation;
  report("Loading recent messages…");
  try {
    const result = await chat.history(channel.id);
    if (closed || request !== generation) return;
    currentMessages = result;
    readLocally(channel, result);
    renderMessages();
    scroll.scrollTo(Infinity);
    report(`${result.length} recent messages · Refresh with Ctrl+R`);
    const latest = result.reduce<string | undefined>((cursor, message) => laterTimestamp(cursor, message.ts), undefined);
    if (latest) {
      try {
        await chat.markRead(channel.id, latest);
      } catch (error) {
        if (closed || request !== generation) return;
        const scope = channel.is_im ? "im:write" : channel.is_mpim ? "mpim:write"
          : channel.is_private ? "groups:write" : "channels:write";
        report(String(error).includes("missing_scope")
          ? `Read locally only: add ${scope} to User Token Scopes and reauthorize your Slack app. Ctrl+R to retry.`
          : `Messages loaded, but Slack read update failed: ${String(error)} · Ctrl+R to retry`);
      }
    }
  } catch (error) {
    if (closed || request !== generation) return;
    showMessageStatus("Unable to load history. Ctrl+R to retry.");
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
      readLocally(channel, currentMessages);
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
  if (key.name === "f2") {
    key.preventDefault();
    if (settingsOpen) closeSettings(); else openSettings();
    return;
  }
  if (settingsOpen) {
    key.preventDefault();
    if (key.name === "escape") closeSettings();
    else if (["space", "return", "enter"].includes(key.name)) void toggleProfilePhotos();
    return;
  }
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
    if (showDMs) void refreshPresence();
    menu.focus();
  } else if (key.ctrl && key.name === "l") {
    key.preventDefault();
    showAll = !showAll;
    updateSidebar();
    menu.focus();
  } else if (key.ctrl && key.name === "r") {
    key.preventDefault();
    if (selected) void load(selected);
    void refreshUnread();
    void refreshPresence();
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
    void refreshUnread();
    void refreshPresence();
    const first = menu.getSelectedOption()?.value as Channel | undefined;
    if (first) await load(first);
    else if (channels.length) report("No active conversations here · Ctrl+L: show all · Ctrl+D: DMs/channels");
    else report("No conversations found for this user.");
  }
} catch (error) { report(`${String(error)} · Check token/scopes, then restart.`); }
