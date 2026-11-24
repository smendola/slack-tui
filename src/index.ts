// Agent sessions: OC:x13-cachy:sal:ses_df58f4884ffeQ73n6oD4HRDj22 Edited
import {
  BoxRenderable, TextRenderable, ScrollBoxRenderable, InputRenderable,
  SelectRenderableEvents, TextareaRenderable, createCliRenderer,
  StyledText, bg, fg, BorderChars, ImageRenderable, NativeImage, createHostClipboard, type HostClipboardService,
  createClipboard, createRendererClipboardAdapter, type ClipboardService, type Selection,
} from "@opentui/core";
import { Slack, Demo, channelName, displayText, isSidebarActive, laterTimestamp, updateReaction, type Channel, type Message } from "./slack";
import { ChannelSelect } from "./channel-select";
import { tokenProvider } from "./oauth";
import { credentialsPath } from "./config-paths";
import { loadCredentials } from "./credentials";
import { clipboardImage, MAX_IMAGE_BYTES, type ImageAttachment } from "./attachment";
import { AvatarCache } from "./avatars";
import { defaultSettings, loadSettings, saveSettings, settingsPath, type Settings } from "./settings";
import { messageImages, MessageImageCache } from "./message-images";
import { renderEmoji } from "./emoji";
import { createHelpScreen } from "./help";
import { button } from "./button";
import { createMentionPicker } from "./mentions";
import { messageSelectionText } from "./message-selection";
import { restoreDraft } from "./drafts";
import { lastConversation } from "./last-conversation";
import { messageContent } from "./message-content";
import { connectLive, applyLiveEvent, eventChannel, isNewMessage, type LiveEvent } from "./live";

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
const reactionPickerIcon = NativeImage.decode(await Bun.file(new URL("../assets/reaction-picker.png", import.meta.url)).bytes());
renderer.once("destroy", () => reactionPickerIcon.dispose());
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
const tabRow = new BoxRenderable(renderer, { flexDirection: "row", height: 1, flexShrink: 0 });
sidebar.add(tabRow);
const sidebarTabs = ["Channels", "DMs"].map(label => {
  const isDM = label === "DMs";
  const tab = new TextRenderable(renderer, {
    content: ` ${label} `, height: 1, selectable: false,
    onMouseDown(event) {
      if (event.button !== 0) return;
      switchSidebar(isDM);
      event.stopPropagation();
    },
  });
  tabRow.add(tab);
  return { tab, isDM };
});
const search = new InputRenderable(renderer, {
  placeholder: "/ Search names", width: "100%", flexShrink: 0,
  backgroundColor: "#191724", focusedBackgroundColor: "#403d52",
});
sidebar.add(search);
const menu = new ChannelSelect(renderer, {
  width: "100%", flexGrow: 1, minHeight: 0, options: [], showDescription: false,
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
const headingRow = new BoxRenderable(renderer, { flexDirection: "row", alignItems: "center", columnGap: 1, flexShrink: 0, backgroundColor: "#272735FF" });
const headingPhoto = new BoxRenderable(renderer, { width: 4, height: 2, flexShrink: 0, visible: false });
const headingPresence = new TextRenderable(renderer, { height: 1, visible: false, flexShrink: 0 });
headingRow.add(headingPhoto);
headingRow.add(heading);
headingRow.add(headingPresence);
chatSection.add(headingRow);
const scroll = new ScrollBoxRenderable(renderer, { flexGrow: 1, minHeight: 0, scrollX: false, stickyScroll: true, stickyStart: "bottom" });
chatSection.add(scroll);
const messages = new BoxRenderable(renderer, { width: "100%", flexDirection: "column", flexShrink: 0 });
scroll.add(messages);
const avatarCache = new AvatarCache();
menu.showPhotos = settings.showProfilePhotos;
menu.avatarSource = user => {
  const url = chat.avatars.get(user);
  return url ? avatarCache.get(url) : undefined;
};
const messageImageCache = new MessageImageCache(image => chat.readImage(image));
let messageRenderVersion = 0;
function clearMessages() {
  reactionPalette = undefined;
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
attachmentDetails.add(button(renderer, "Remove image · Ctrl+G", removeImage));
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
const mentions = createMentionPicker(renderer, composerSection, composer, chat.users);
function setComposerExpanded(expanded: boolean) {
  composerExpanded = expanded;
  scroll.visible = !expanded;
  chatSection.flexGrow = expanded ? 0 : 1;
  composerSection.flexGrow = expanded ? 1 : 0;
  composerSection.border = expanded ? ["left", "right", "bottom"] : true;
  composer.height = expanded ? "auto" : 1;
  composer.flexGrow = expanded ? 1 : 0;
  if (expanded) composer.focus();
  updateFooter();
}
const status = new TextRenderable(renderer, { content: "Connecting…", height: 1, fg: "#908caa" });
let ownUserId: string | undefined;
const paletteNames = ["+1", "-1", "heart", "tada", "smile", "joy", "eyes", "clap", "raised_hands",
  "fire", "rocket", "white_check_mark", "pray", "sunglasses", "wave", "star"];
function reactionIcon(name: string) {
  // The emoji-style heart has inconsistent cell width across terminals.
  return name === "heart" ? "💗" : renderEmoji(`:${name}:`);
}
let reactionPalette: BoxRenderable | undefined;
function closeReactionPalette() {
  if (reactionPalette?.parent) reactionPalette.parent.height = 1;
  reactionPalette?.destroyRecursively();
  reactionPalette = undefined;
}
function toggleReactionPalette(message: Message, picker: BoxRenderable, notice: TextRenderable) {
  const wasOpen = reactionPalette?.parent === picker;
  closeReactionPalette();
  if (wasOpen) return;
  const palette = new BoxRenderable(renderer, {
    position: "absolute", left: 3, top: 0, zIndex: 10,
    flexDirection: "row", flexWrap: "wrap",
    width: Math.max(6, Math.min(42, renderer.width - picker.x - 4)),
    border: true, borderStyle: "single", borderColor: "#686868", backgroundColor: "#272735FF",
  });
  reactionPalette = palette;
  picker.add(palette);
  for (const name of paletteNames) {
    palette.add(button(renderer, reactionIcon(name), () => {
      closeReactionPalette();
      const mine = message.reactions?.some(item => item.name === name && ownUserId && item.users?.includes(ownUserId));
      void react(message, name, !mine, notice);
    }, { background: "#272735FF", hover: "#505064FF", foreground: "#e0def4" }));
  }
  scroll.afterLayout(() => {
    if (reactionPalette !== palette) return;
    // Absolute children don't reserve scrollable space. Keep the + at the top
    // of its row while making room for the popup's measured height.
    picker.height = palette.height;
    scroll.afterLayout(() => {
      if (reactionPalette === palette) scroll.scrollChildIntoView(palette);
    });
  });
}
const pendingReactions = new Set<string>();
async function react(message: Message, name: string, add: boolean, notice: TextRenderable) {
  const channel = selected?.id;
  if (!channel || !ownUserId || !currentMessages.includes(message)) return;
  const key = JSON.stringify([channel, message.ts, name]);
  if (pendingReactions.has(key)) return;
  pendingReactions.add(key);
  notice.content = `${add ? "Adding" : "Removing"} :${name}:…`;
  notice.visible = true;
  try {
    await chat.setReaction(channel, message.ts, name, add);
    if (closed || channel !== selected?.id) return;
    const current = currentMessages.find(item => item.ts === message.ts);
    if (!current) return;
    updateReaction(current, ownUserId, name, add);
    const position = scroll.scrollTop;
    renderMessages();
    scroll.scrollTo(position);
    report(`Reaction ${add ? "added" : "removed"}: :${name}:`);
  } catch (error) {
    const reason = String(error).includes("missing_scope")
      ? "Add reactions:write to your Slack app’s User Token Scopes, then reinstall and reconnect with the updated user token."
      : String(error);
    const failure = `Could not ${add ? "add" : "remove"} :${name}: — ${reason}`;
    if (!notice.isDestroyed) notice.content = failure;
    report(failure);
  } finally { pendingReactions.delete(key); }
}
let editing: { channel: string; ts: string } | undefined;
let savingEdit = false;
const editScreen = new BoxRenderable(renderer, {
  flexGrow: 1, minHeight: 0, flexDirection: "column", border: true, title: "Edit sent message", visible: false,
});
root.add(editScreen);
const editText = new TextareaRenderable(renderer, { flexGrow: 1, minHeight: 1 });
editScreen.add(editText);
const editActions = new BoxRenderable(renderer, { flexDirection: "row", height: 1, columnGap: 1 });
editScreen.add(editActions);
editActions.add(button(renderer, "Save", saveEdit));
editActions.add(button(renderer, "Cancel", cancelEdit));
function openEdit(message: Message) {
  if (!selected || editing) return;
  editing = { channel: selected.id, ts: message.ts };
  body.visible = false;
  editScreen.visible = true;
  restoreDraft(editText, message.text ?? "");
  // Let mouse-down focus handling finish on the old message header first.
  queueMicrotask(() => { if (editing) editText.focus(); });
}
function cancelEdit() {
  if (savingEdit) return;
  editing = undefined;
  editScreen.visible = false;
  body.visible = true;
  composer.focus();
}
async function saveEdit() {
  if (!editing || savingEdit) return;
  const text = editText.plainText;
  if (!text.trim()) { report("Enter some text before saving."); return; }
  const { channel, ts } = editing;
  savingEdit = true;
  try {
    await chat.edit(channel, ts, text);
    if (closed) return;
    const message = currentMessages.find(message => message.ts === ts);
    if (message && selected?.id === channel) {
      message.text = text;
      const position = scroll.scrollTop;
      renderMessages();
      scroll.scrollTo(position);
    }
  } catch (error) {
    report(`Edit not saved: ${String(error)}`);
    return;
  } finally { savingEdit = false; }
  cancelEdit();
  report("Message edited.");
}
let settingsOpen = false;
let settingsSaving = false;
let returnToComposer = false;
let helpOpen = false;
let helpReturnToComposer = false;
const settingsScreen = new BoxRenderable(renderer, {
  flexGrow: 1, minHeight: 0, flexDirection: "column", padding: 1,
  border: true, title: "Settings", borderColor: "#524f67", visible: false, focusable: true,
});
root.add(settingsScreen);
const photosRow = new BoxRenderable(renderer, { flexDirection: "row", height: 2, columnGap: 1 });
settingsScreen.add(photosRow);
photosRow.add(new TextRenderable(renderer, { content: "Show profile photos:", fg: "#e0def4" }));
const photosSetting = button(renderer, "", toggleProfilePhotos);
photosRow.add(photosSetting);
const settingsNotice = new TextRenderable(renderer, { content: "", fg: "#908caa", wrapMode: "word" });
settingsScreen.add(settingsNotice);
const settingsBack = button(renderer, "Back to chat · Esc / F2", closeSettings);
settingsBack.marginTop = 1;
settingsScreen.add(settingsBack);
function updateSettingsScreen() {
  photosSetting.content = ` ${settings.showProfilePhotos ? "Yes" : "No"}${settingsSaving ? " · Saving…" : ""} `;
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
    menu.showPhotos = settings.showProfilePhotos;
    menu.requestRender();
    if (!closed && selected) updateHeading(selected);
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
const help = createHelpScreen(renderer, closeHelp);
root.add(help.screen);
function openHelp() {
  if (helpOpen) return;
  helpReturnToComposer = composer.focused;
  helpOpen = true;
  body.visible = false;
  settingsScreen.visible = false;
  help.screen.visible = true;
  help.scroll.scrollTo(0);
  help.screen.focus();
}
function closeHelp() {
  if (!helpOpen) return;
  helpOpen = false;
  help.screen.visible = false;
  settingsScreen.visible = settingsOpen;
  body.visible = !settingsOpen;
  if (settingsOpen) settingsScreen.focus();
  else if (helpReturnToComposer) composer.focus();
  else menu.focus();
}
root.add(status);
const footer = new TextRenderable(renderer, { height: 1, fg: "#908caa" });
root.add(footer);
function updateFooter() {
  // Help has its own navigation hints beneath the scroll area.
  footer.visible = !helpOpen;
  if (helpOpen) return;
  if (editing) footer.content = " Ctrl+S: save edit · Enter: newline · Esc: cancel";
  else if (settingsOpen) footer.content = " Space/Enter: toggle · Esc: back · F1: help";
  else if (search.focused) footer.content = " Type a name · ↑↓: choose · Enter: open · Esc: clear · F1: help";
  else if (composer.focused) {
    footer.content = ` Enter: send · Shift+Enter: newline · ${composerExpanded ? "Esc: collapse" : "Ctrl+V: paste"} · Tab: sidebar · F1: help`;
  } else {
    footer.content = " /: search · ↑↓: choose · Enter/Space: open · Ctrl+D: DMs · Ctrl+L: active/all · Tab: write · F1: help";
  }
}
for (const pane of [menu, search, composer, editText, settingsScreen, help.screen]) pane.on("focused", updateFooter);

let selected: Channel | undefined;
let lastOpened: ReturnType<typeof lastConversation> | undefined;
let allChannels: Channel[] = [];
let showDMs = false;
let showAll = false;
const locallyRead = new Map<string, string>();
let checkingUnread = false;
let checkingPresence = false;
function updateHeadingPresence(channel: Channel) {
  headingPresence.visible = !!channel.is_im;
  if (!channel.is_im) return;
  const active = channel.presence === "active";
  headingPresence.content = active ? "● Active" : channel.presence === "away" ? "○ Away" : "· Unknown";
  headingPresence.fg = active ? "#9ccf88" : "#908caa";
}
function updateHeading(channel: Channel) {
  const name = channelName(channel, chat.users);
  heading.content = channel.is_im ? name.replace(/^@ /, "") : name;
  updateHeadingPresence(channel);
  for (const child of [...headingPhoto.getChildren()]) child.destroyRecursively();
  headingPhoto.visible = !!channel.is_im && settings.showProfilePhotos;
  if (!headingPhoto.visible) return;
  const initials = name.replace(/^@ /, "").trim().split(/\s+/).slice(0, 2).map(part => Array.from(part)[0]).join("").toUpperCase();
  const fallback = new TextRenderable(renderer, { content: initials, width: 4, height: 2, fg: "#b8b8b8", bg: "#403d52", selectable: false });
  headingPhoto.add(fallback);
  const url = channel.user && chat.avatars.get(channel.user);
  if (url) void avatarCache.get(url).then(bytes => {
    if (!bytes || closed || fallback.isDestroyed) return;
    const photo = new ImageRenderable(renderer, {
      width: 4, height: 2, position: "absolute", fit: "cover",
      onLoad: () => { if (!fallback.isDestroyed) fallback.visible = false; },
      onError: () => { if (!fallback.isDestroyed) fallback.visible = true; },
    });
    headingPhoto.add(photo);
    photo.source = bytes;
  });
}
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
      if (selected?.is_im && selected.user === user) updateHeadingPresence(selected);
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
      const revision = liveRevision;
      const unread = await chat.unread(channel.id, cursor);
      if (closed) break;
      // A history load completed while this request was in flight.
      if (cursor === locallyRead.get(channel.id)
        && !liveJournal.some(item => item.revision > revision && eventChannel(item.event) === channel.id)) {
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
function switchSidebar(dms: boolean) {
  if (showDMs !== dms) {
    showDMs = dms;
    search.value = "";
    updateSidebar();
    if (showDMs) void refreshPresence();
  }
  menu.focus();
}
function updateSidebar(preferredId = selected?.id) {
  const query = search.value.trim().toLowerCase();
  const channels = allChannels.filter(channel => !!channel.is_im === showDMs
    && (query ? channelName(channel, chat.users).toLowerCase().includes(query)
      : showAll || channel.id === preferredId || isSidebarActive(channel)));
  sidebar.title = query ? `Matches (${channels.length})` : `${showAll ? "All" : "Active"} (${channels.length})`;
  for (const { tab, isDM } of sidebarTabs) {
    tab.bg = isDM === showDMs ? "#403d52" : "#191724";
    tab.fg = isDM === showDMs ? "#f6c177" : "#e0def4";
  }
  menu.options = channels.map(channel => ({ name: channelName(channel, chat.users), description: "", value: channel }));
  const index = channels.findIndex(channel => channel.id === preferredId);
  menu.setSelectedIndex(Math.max(0, index));
}
let currentMessages: Message[] = [];
let generation = 0;
let sending = false;
let closed = false;
const drafts = new Map<string, string>();
const imageDrafts = new Map<string, ImageAttachment>();
let clipboard: HostClipboardService | undefined;
let copyClipboard: ClipboardService | undefined;
let copyQueue = Promise.resolve();
let copyGeneration = 0;
let readingClipboard = false;
let pasteGeneration = 0;
let live: ReturnType<typeof connectLive> | undefined;
let liveRevision = 0;
const liveJournal: { revision: number; event: LiveEvent }[] = [];
let liveDirty = false;
let loadingHistory = false;
let liveTimer: ReturnType<typeof setTimeout> | undefined;
let liveReadTimer: ReturnType<typeof setTimeout> | undefined;
let resyncTimer: ReturnType<typeof setTimeout> | undefined;
let syncingLive = false;
const discoveringChannels = new Set<string>();
function eventsSince(messages: Message[], channel: string, revision: number) {
  for (const item of liveJournal) {
    if (item.revision > revision && eventChannel(item.event) === channel) messages = applyLiveEvent(messages, item.event);
  }
  return messages;
}
function scheduleLiveRender() {
  if (closed || liveTimer) return;
  liveTimer = setTimeout(() => {
    liveTimer = undefined;
    if (!liveDirty || closed) return;
    if (loadingHistory || sending || editing || settingsOpen || helpOpen || composerExpanded
      || reactionPalette || renderer.getSelection()?.getSelectedText()) {
      scheduleLiveRender();
      return;
    }
    const position = scroll.scrollTop;
    const atBottom = position + scroll.viewport.height >= scroll.scrollHeight - 1;
    liveDirty = false;
    renderMessages();
    scroll.scrollTo(atBottom ? Infinity : position);
    if (atBottom && selected) {
      if (liveReadTimer) clearTimeout(liveReadTimer);
      const channel = selected;
      const latest = currentMessages.at(-1)?.ts;
      liveReadTimer = setTimeout(() => {
        liveReadTimer = undefined;
        if (closed || selected !== channel || loadingHistory || editing || helpOpen || settingsOpen || composerExpanded
          || scroll.scrollTop + scroll.viewport.height < scroll.scrollHeight - 1 || !latest) return;
        readLocally(channel, [{ ts: latest }]);
        void chat.markRead(channel.id, latest).catch(() => report("Live messages received; Slack read update failed. Ctrl+R to retry."));
      }, 600);
    }
  }, 150);
}
function receiveLive(event: LiveEvent) {
  if (closed) return;
  const id = eventChannel(event);
  if (!id) return;
  liveJournal.push({ revision: ++liveRevision, event });
  if (liveJournal.length > 2000) liveJournal.shift();
  const incoming = isNewMessage(event);
  const channel = allChannels.find(channel => channel.id === id);
  if (channel && incoming) {
    if (event.user !== ownUserId) channel.unread = true;
    // A message makes a dormant/closed conversation relevant again.
    channel.properties = { ...channel.properties, is_dormant: false };
    if (channel.is_im || channel.is_mpim) channel.is_open = true;
    updateSidebar(menu.getSelectedOption()?.value?.id);
    if (event.user !== ownUserId && selected?.id !== id) report(`New message · ${channelName(channel, chat.users)}`);
  } else if (!channel && incoming && !discoveringChannels.has(id)) {
    discoveringChannels.add(id);
    void chat.conversation(id).then(channel => {
      if (closed || allChannels.some(item => item.id === id)) return;
      channel.unread = event.user !== ownUserId;
      channel.properties = { ...channel.properties, is_dormant: false };
      allChannels.push(channel);
      allChannels.sort((a, b) => Number(!!a.is_im) - Number(!!b.is_im) || channelName(a, chat.users).localeCompare(channelName(b, chat.users)));
      updateSidebar(menu.getSelectedOption()?.value?.id);
    }).catch(() => report("New conversation received, but its details could not be loaded."))
      .finally(() => discoveringChannels.delete(id));
  }
  if (selected?.id === id) {
    currentMessages = applyLiveEvent(currentMessages, event);
    liveDirty = true;
    scheduleLiveRender();
  }
}
// Catch up the open conversation after initial connection or reconnection.
// Events arriving during the HTTP request are replayed over its snapshot.
function scheduleLiveResync(delay = 500) {
  if (closed || resyncTimer) return;
  resyncTimer = setTimeout(() => {
    resyncTimer = undefined;
    void resyncLive();
  }, delay);
}
async function resyncLive() {
  if (closed || syncingLive || !selected) return;
  if (loadingHistory || sending || editing || pendingReactions.size) { scheduleLiveResync(); return; }
  syncingLive = true;
  const channel = selected;
  const request = generation;
  const revision = liveRevision;
  try {
    const result = await chat.history(channel.id);
    if (closed || request !== generation || selected !== channel) return;
    currentMessages = eventsSince(result, channel.id, revision);
    liveDirty = true;
    scheduleLiveRender();
  } catch {
    report("Live catch-up delayed; retrying automatically.");
    scheduleLiveResync(15_000);
  } finally { syncingLive = false; }
}
renderer.once("destroy", () => {
  closed = true;
  if (liveTimer) clearTimeout(liveTimer);
  if (liveReadTimer) clearTimeout(liveReadTimer);
  if (resyncTimer) clearTimeout(resyncTimer);
  void live?.stop().catch(() => {});
  imageDrafts.clear();
  void (copyClipboard ?? clipboard)?.dispose().catch(() => {});
});
function report(text: string) { if (!closed) status.content = displayText(text, chat.users); }
function hostClipboard() {
  return clipboard ??= createHostClipboard({ maxReadBytes: MAX_IMAGE_BYTES, timeoutMs: 5_000, maxImagePixels: 40_000_000 });
}
renderer.on("selection", (selection: Selection | null) => {
  if (closed || helpOpen || settingsOpen || composerExpanded) return;
  const text = messageSelectionText(selection, messages);
  if (!text) return;
  const request = ++copyGeneration;
  // Serialize writes so an older clipboard operation cannot overwrite a newer selection.
  copyQueue = copyQueue.then(async () => {
    if (closed || request !== copyGeneration) return;
    copyClipboard ??= createClipboard({
      host: hostClipboard(), terminal: createRendererClipboardAdapter(renderer),
    });
    const result = await copyClipboard.writeText(text, { destination: "best-available" });
    if (closed || request !== copyGeneration) return;
    if (result.host.status === "written") report("Selection copied to clipboard");
    else if (result.terminal.status === "attempted") report("Selection sent to terminal clipboard");
    else report("Could not copy selection: clipboard unavailable or blocked by terminal settings");
  }).catch(error => {
    if (!closed && request === copyGeneration) report(`Could not copy selection: ${String(error)}`);
  });
});
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
    const result = await hostClipboard().read({ preferredTypes: ["image/png", "image/jpeg", "image/webp", "image/gif", "text/plain"] });
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
const shortMonth = new Intl.DateTimeFormat("en-US", { month: "short" });
function dateDivider(date: Date, currentYear: number) {
  const day = date.getDate();
  const suffix = day >= 11 && day <= 13 ? "th" : ({ 1: "st", 2: "nd", 3: "rd" }[day % 10] ?? "th");
  const year = date.getFullYear() === currentYear ? "" : `, ${date.getFullYear()}`;
  const row = new BoxRenderable(renderer, { width: "100%", height: 1, flexShrink: 0, flexDirection: "row", marginBottom: 1 });
  const ruleColor = "#808080";
  const rule = () => new BoxRenderable(renderer, {
    flexBasis: 0, flexGrow: 1, height: 1, border: ["top"], borderColor: ruleColor,
  });
  row.add(rule());
  row.add(new TextRenderable(renderer, {
    content: ` ${shortMonth.format(date)} ${day}${suffix}${year} `,
    fg: "#b8b8b8", bg: "#444444", height: 1, selectable: false,
  }));
  row.add(rule());
  return row;
}
function renderMessages() {
  clearMessages();
  const version = messageRenderVersion;
  if (!currentMessages.length) { showMessageStatus("No messages yet."); return; }
  let previousDay: string | undefined;
  const currentYear = new Date().getFullYear();
  for (const message of currentMessages) {
    const timestamp = new Date(Number(message.ts) * 1000);
    const day = timestamp.toDateString();
    if (day !== previousDay && Number.isFinite(timestamp.getTime())) {
      messages.add(dateDivider(timestamp, currentYear));
      previousDay = day;
    }
    const name = displayText(message.username || chat.users.get(message.user ?? "") || message.bot_profile?.name || message.user || message.bot_id || "Slack", chat.users);
    const time = timestamp.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
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
      fallback = new TextRenderable(renderer, { content: initials, width: 4, height: 2, fg: "#b8b8b8", bg: "#403d52", selectable: false });
      avatarColumn.add(fallback);
      row.add(avatarColumn);
    }
    const textColumn = new BoxRenderable(renderer, { flexDirection: "column", flexGrow: 1, flexBasis: 0, minWidth: 0 });
    const header = new BoxRenderable(renderer, { flexDirection: "row", flexShrink: 0, flexWrap: "wrap" });
    textColumn.add(header);
    header.add(new TextRenderable(renderer, {
      wrapMode: "word",
      content: new StyledText([bg("#444444")(fg("#b8b8b8")(` ${name}  ${time} `))]),
    }));
    if (ownUserId && message.user === ownUserId && message.text && !message.files?.some(file => file.previewBytes)) {
      header.add(new TextRenderable(renderer, {
        content: " ✎ ", fg: "#9ccfd8", selectable: false,
        onMouseDown(event) { if (event.button === 0) { event.stopPropagation(); openEdit(message); } },
      }));
    }
    textColumn.add(new TextRenderable(renderer, {
      width: "100%", flexShrink: 0, fg: "#e0def4", wrapMode: "word",
      content: messageContent(message, chat.users, `${files ? `\n${files}` : ""}${message.reply_count ? `\n↳ ${message.reply_count} replies (not loaded)` : ""}`),
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
    if (demo || !message.files?.some(file => file.previewBytes)) {
      const reactions = new BoxRenderable(renderer, { flexDirection: "row", flexWrap: "wrap", flexShrink: 0, columnGap: 1 });
      const notice = new TextRenderable(renderer, { visible: false, width: "100%", flexShrink: 0, fg: "#f6c177", wrapMode: "word" });
      for (const reaction of message.reactions ?? []) {
        const mine = !!ownUserId && !!reaction.users?.includes(ownUserId);
        const label = `${reactionIcon(reaction.name)} ${reaction.count}${mine ? " ✓" : ""}`;
        reactions.add(button(renderer, label, () => { void react(message, reaction.name, !mine, notice); },
          { background: "#272735FF", hover: "#505064FF", foreground: "#e0def4" }));
      }
      const picker = new BoxRenderable(renderer, {
        flexDirection: "row", width: 2, height: 1, flexShrink: 0, overflow: "visible",
      });
      reactions.add(picker);
      picker.add(new ImageRenderable(renderer, {
        source: reactionPickerIcon, width: 2, height: 1, flexShrink: 0, fit: "fit",
        onMouseDown(event) {
          if (event.button !== 0) return;
          event.stopPropagation();
          toggleReactionPalette(message, picker, notice);
        },
      }));
      textColumn.add(reactions);
      textColumn.add(notice);
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
  if (selected) drafts.set(selected.id, mentions.serialize());
  pasteGeneration++;
  const changedChannel = selected?.id !== channel.id;
  selected = channel;
  menu.activeChannelId = channel.id;
  if (changedChannel) {
    restoreDraft(composer, drafts.get(channel.id) ?? "");
    mentions.restoreLabels();
  }
  updateAttachment();
  if (changedChannel) setComposerExpanded(composer.plainText.includes("\n"));
  updateHeading(channel);
  composer.placeholder = `Message ${channelName(channel, chat.users).replace(/^[#@🔒]\s+/u, "")}`;
  currentMessages = [];
  showMessageStatus("Loading…");
  const request = ++generation;
  const revision = liveRevision;
  loadingHistory = true;
  liveDirty = false;
  report("Loading recent messages…");
  try {
    const result = await chat.history(channel.id);
    if (closed || request !== generation) return;
    currentMessages = eventsSince(result, channel.id, revision);
    readLocally(channel, currentMessages);
    renderMessages();
    scroll.scrollTo(Infinity);
    report(`${currentMessages.length} recent messages · ${live ? "Live events enabled" : "Ctrl+R to refresh · bun run setup --socket for live events"}`);
    try { lastOpened?.save(channel.id); }
    catch (error) { report(`Could not remember conversation: ${String(error)}`); }
    const latest = currentMessages.reduce<string | undefined>((cursor, message) => laterTimestamp(cursor, message.ts), undefined);
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
  } finally {
    if (request === generation) loadingHistory = false;
  }
}
search.on("input", () => updateSidebar());
menu.on(SelectRenderableEvents.ITEM_SELECTED, (_index, option) => {
  if (!option?.value) return;
  void load(option.value);
  if (search.value && selected?.id === option.value.id) search.value = "";
});
async function sendMessage() {
  const text = mentions.serialize().trim();
  const image = selected ? imageDrafts.get(selected.id) : undefined;
  if ((!text && !image) || !selected || sending || readingClipboard) return;
  const channel = selected;
  const original = composer.plainText;
  const request = ++generation; // A pending history response must not overwrite this send.
  loadingHistory = false;
  sending = true;
  report(image ? "Uploading image and sending caption…" : "Sending…");
  try {
    const message = await chat.send(channel.id, text, image);
    if (closed) return;
    if (request === generation) {
      currentMessages = applyLiveEvent(currentMessages, { ...message, type: "message" });
      readLocally(channel, currentMessages);
      renderMessages();
      scroll.scrollTo(Infinity);
    }
    if (composer.plainText === original) {
      restoreDraft(composer, "");
      setComposerExpanded(false);
    }
    drafts.set(channel.id, mentions.serialize());
    if (imageDrafts.get(channel.id) === image) imageDrafts.delete(channel.id);
    updateAttachment();
    report(live ? "Sent" : "Sent · Ctrl+R to fetch incoming messages");
    if (live && image) scheduleLiveResync();
  } catch (error) {
    report(String(error).includes("missing_scope")
      ? "Image upload needs files:write under User Token Scopes. Add it in Slack app settings and reinstall/reauthorize. Draft kept."
      : `${String(error)} · Draft kept; check Slack before retrying if delivery is uncertain.`);
  } finally { sending = false; }
}
renderer.keyInput.on("keypress", key => {
  if (!editing && !settingsOpen && !helpOpen && mentions.key(key)) return;
  if (reactionPalette && !editing && !settingsOpen && !helpOpen && key.name === "escape") {
    key.preventDefault();
    closeReactionPalette();
    return;
  }
  if (editing) {
    if (savingEdit) { key.preventDefault(); return; }
    if (key.ctrl && key.name === "s") { key.preventDefault(); void saveEdit(); }
    else if (key.name === "escape") { key.preventDefault(); cancelEdit(); }
    return;
  }
  if (key.name === "f1") {
    key.preventDefault();
    if (helpOpen) closeHelp(); else openHelp();
    return;
  }
  if (key.name === "f2") {
    key.preventDefault();
    if (helpOpen) closeHelp();
    if (settingsOpen) closeSettings(); else openSettings();
    return;
  }
  if (helpOpen) {
    key.preventDefault();
    if (key.name === "escape") closeHelp();
    else if (key.name === "up" || key.name === "down") help.scroll.scrollBy(key.name === "up" ? -1 : 1);
    else if (key.name === "pageup" || key.name === "pagedown") help.scroll.scrollBy(key.name === "pageup" ? -1 : 1, "viewport");
    else if (key.name === "home") help.scroll.scrollTo(0);
    else if (key.name === "end") help.scroll.scrollTo(Infinity);
    return;
  }
  if (settingsOpen) {
    key.preventDefault();
    if (key.name === "escape") closeSettings();
    else if (["space", "return", "enter"].includes(key.name)) void toggleProfilePhotos();
    return;
  }
  if (menu.focused && key.name === "space" && !key.ctrl && !key.meta && !key.super && !key.hyper) {
    key.preventDefault();
    menu.selectCurrent();
  } else if (menu.focused && key.sequence === "/") {
    key.preventDefault();
    search.focus();
  } else if ((search.focused || (menu.focused && search.value)) && key.name === "escape") {
    key.preventDefault();
    search.value = "";
    menu.focus();
  } else if (search.focused && ["up", "down", "return", "enter"].includes(key.name)) {
    key.preventDefault();
    if (key.name === "up") menu.moveUp(1);
    else if (key.name === "down") menu.moveDown(1);
    else if (menu.getSelectedOption()) { menu.focus(); menu.selectCurrent(); }
  } else if (composer.focused && key.ctrl && key.name === "v") {
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
    switchSidebar(!showDMs);
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
  ownUserId = identity.user_id;
  const channels = await chat.channels();
  if (!closed) {
    title.content = ` slack-tui · ${identity.team} · ${identity.user}${demo ? " · DEMO" : ""}`;
    channels.sort((a, b) => Number(!!a.is_im) - Number(!!b.is_im) || channelName(a, chat.users).localeCompare(channelName(b, chat.users)));
    allChannels = channels;
    if (!demo && credentials?.appToken) {
      live = connectLive(credentials.appToken, identity.team_id, identity.user_id, {
        event: receiveLive,
        state(state) {
          if (closed) return;
          title.content = ` slack-tui · ${identity.team} · ${identity.user} · ${state === "live" ? "LIVE" : state}`;
          if (state === "live") {
            scheduleLiveResync();
            void refreshUnread();
          } else if (state === "offline") {
            report("Live connection offline. Check Socket Mode/app token; Ctrl+R still works.");
          }
        },
      });
    } else if (!demo) {
      title.content = ` slack-tui · ${identity.team} · ${identity.user} · manual refresh`;
    }
    lastOpened = lastConversation(identity.team_id, identity.user_id);
    let previousId: string | undefined;
    try { previousId = lastOpened.read(); }
    catch (error) { report(`Could not restore conversation: ${String(error)}`); }
    const previous = channels.find(channel => channel.id === previousId);
    showDMs = previous ? !!previous.is_im : channels.length > 0 && channels.every(channel => channel.is_im);
    updateSidebar(previous?.id);
    void refreshUnread();
    void refreshPresence();
    const first = menu.getSelectedOption()?.value as Channel | undefined;
    if (first) await load(first);
    else if (channels.length) report("No active conversations here · Ctrl+L: show all · Ctrl+D: DMs/channels");
    else report("No conversations found for this user.");
  }
} catch (error) { report(`${String(error)} · Check token/scopes, then restart.`); }
