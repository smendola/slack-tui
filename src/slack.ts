// Agent sessions: OC:x13-cachy:sal:ses_df1c1ceedffe0p5mflr3l2vNvR Edited
import { type ImageAttachment } from "./attachment";
import { downloadMessageImage, type MessageImage } from "./message-images";
import { renderEmoji } from "./emoji";

export type MessageFile = {
  name?: string; title?: string; mimetype?: string; filetype?: string;
  thumb_360?: string; thumb_480?: string; thumb_720?: string; url_private?: string;
  is_external?: boolean; mode?: string; previewBytes?: Uint8Array;
};
type ImageBlock = { type: string; image_url?: string; alt_text?: string; accessory?: { type: string; image_url?: string; alt_text?: string } };

export type Presence = "active" | "away";
export type Channel = {
  id: string; name?: string; user?: string; is_im?: boolean; is_mpim?: boolean; is_private?: boolean;
  is_open?: boolean;
  unread?: boolean;
  presence?: Presence;
  last_read?: string;
  unread_count_display?: number;
  unread_count?: number;
  properties?: { has_custom_mpdm_name?: boolean; is_dormant?: boolean };
};
export type Message = {
  ts: string; text?: string; user?: string; bot_id?: string;
  username?: string; icons?: { image_48?: string };
  bot_profile?: { name?: string; icons?: { image_48?: string; image_72?: string } };
  reply_count?: number; thread_ts?: string; latest_reply?: string; files?: MessageFile[];
  blocks?: ImageBlock[];
  reactions?: { name: string; count: number; users?: string[] }[];
  attachments?: {
    pretext?: string; author_name?: string; title?: string; title_link?: string;
    text?: string; fallback?: string; footer?: string;
    image_url?: string; thumb_url?: string; blocks?: ImageBlock[];
    fields?: { title?: string; value?: string }[];
    actions?: { text?: string; url?: string }[];
  }[];
};
type User = { id: string; name: string; is_bot?: boolean; is_app_user?: boolean; profile?: { display_name?: string; real_name?: string; image_48?: string; image_72?: string } };
export interface Chat {
  users: Map<string, string>;
  avatars: Map<string, string>;
  connect(): Promise<{ team: string; user: string; team_id: string; user_id: string }>;
  channels(): Promise<Channel[]>;
  conversation(id: string): Promise<Channel>;
  history(channel: string): Promise<Message[]>;
  replies(channel: string, ts: string): Promise<Message[]>;
  unread(channel: string, locallyRead?: string): Promise<boolean | undefined>;
  markRead(channel: string, ts: string): Promise<void>;
  presence(user: string): Promise<Presence | undefined>;
  send(channel: string, text: string, image?: ImageAttachment, threadTs?: string): Promise<Message>;
  edit(channel: string, ts: string, text: string): Promise<void>;
  setReaction(channel: string, ts: string, name: string, add: boolean): Promise<void>;
  readImage(image: MessageImage): Promise<Uint8Array>;
}

export class Slack implements Chat {
  botUsers = new Set(["USLACKBOT"]);
  users = new Map<string, string>();
  avatars = new Map<string, string>();
  private blockedUntil = new Map<string, number>();
  private userId?: string;
  private grantedScopes?: Set<string>;
  private readUpdates = new Map<string, Promise<void>>();
  private confirmedRead = new Map<string, string>();
  constructor(private token: string | (() => Promise<string>)) {}

  private async call<T>(method: string, params: Record<string, unknown> = {}): Promise<T> {
    const wait = Math.ceil(((this.blockedUntil.get(method) ?? 0) - Date.now()) / 1000);
    if (wait > 0) throw new Error(`Rate limited: retry ${method} in ${wait}s.`);
    const form = method.startsWith("files.");
    const write = method === "chat.postMessage" || method === "chat.update" || method.startsWith("reactions.") || method === "conversations.mark" || form;
    const url = new URL(`https://slack.com/api/${method}`);
    if (!write) {
      for (const [key, value] of Object.entries(params)) url.searchParams.set(key, String(value));
    }
    const token = typeof this.token === "function" ? await this.token() : this.token;
    const response = await fetch(url, {
      method: write ? "POST" : "GET",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": form ? "application/x-www-form-urlencoded" : "application/json; charset=utf-8" },
      body: form ? new URLSearchParams(Object.entries(params).map(([key, value]) => [key, typeof value === "object" ? JSON.stringify(value) : String(value)]))
        : write ? JSON.stringify(params) : undefined,
      signal: AbortSignal.timeout(20_000),
    });
    const scopes = response.headers.get("x-oauth-scopes");
    if (scopes !== null) this.grantedScopes = new Set(scopes.split(",").map(scope => scope.trim()));
    if (response.status === 429) {
      const seconds = Number(response.headers.get("retry-after")) || 60;
      this.blockedUntil.set(method, Date.now() + seconds * 1000);
      throw new Error(`Rate limited: retry ${method} in ${seconds}s.`);
    }
    if (!response.ok) throw new Error(`Slack HTTP ${response.status}`);
    const data = await response.json() as T & { ok: boolean; error?: string; needed?: string };
    if (!data.ok) throw new Error(`${method}: ${data.error}${data.needed ? ` (needs ${data.needed})` : ""}`);
    return data;
  }

  private async pages<T>(method: string, field: string, params = {}): Promise<T[]> {
    const result: T[] = [];
    let cursor = "";
    do {
      const data = await this.call<Record<string, unknown> & { response_metadata?: { next_cursor?: string } }>(
        method, { ...params, limit: 200, cursor },
      );
      result.push(...data[field] as T[]);
      cursor = data.response_metadata?.next_cursor ?? "";
    } while (cursor);
    return result;
  }

  async connect() {
    const auth = await this.call<{ team: string; user: string; team_id: string; user_id: string }>("auth.test");
    this.userId = auth.user_id;
    const users = await this.pages<User>("users.list", "members");
    for (const user of users) this.rememberUser(user);
    return auth;
  }
  private rememberUser(user: User) {
    const name = user.profile?.display_name || user.profile?.real_name || user.name;
    this.users.set(user.id, name);
    if (user.name) this.users.set(user.name, name);
    const avatar = user.profile?.image_72 || user.profile?.image_48;
    if (avatar) this.avatars.set(user.id, avatar);
    if (user.is_bot || user.is_app_user) this.botUsers.add(user.id);
  }
  async channels() {
    const channels = await this.pages<Channel>("users.conversations", "channels", {
      types: "public_channel,private_channel,im,mpim", exclude_archived: true,
    });
    // Slack Connect users may be absent from users.list.
    const missing = new Set(channels.filter(channel => channel.is_im && channel.user && !this.users.has(channel.user))
      .map(channel => channel.user!));
    for (const id of missing) {
      try {
        const { user } = await this.call<{ user: User }>("users.info", { user: id });
        this.rememberUser(user);
      } catch {
        // Keep the conversation accessible under its ID if a profile is unavailable.
      }
    }
    return channels;
  }
  async history(channel: string) {
    const data = await this.call<{ messages: Message[] }>("conversations.history", { channel, limit: 50 });
    return data.messages.toReversed();
  }
  async conversation(id: string) {
    const data = await this.call<{ channel: Channel }>("conversations.info", { channel: id });
    return data.channel;
  }
  async presence(user: string): Promise<Presence | undefined> {
    try {
      const data = await this.call<{ presence?: string }>("users.getPresence", { user });
      return data.presence === "active" || data.presence === "away" ? data.presence : undefined;
    } catch (error) {
      // Some external users cannot be looked up. Unknown is not away.
      if (/users\.getPresence: (user_not_found|user_not_visible)\b/.test(String(error))) return undefined;
      throw error;
    }
  }
  async markRead(channel: string, ts: string): Promise<void> {
    // Serialize updates per conversation so a slower, older load cannot rewind it.
    const previous = this.readUpdates.get(channel);
    const update = (async () => {
      await previous?.catch(() => {});
      const confirmed = this.confirmedRead.get(channel);
      if (confirmed && confirmed !== ts && laterTimestamp(confirmed, ts) === confirmed) return;
      await this.call("conversations.mark", { channel, ts });
      this.confirmedRead.set(channel, ts);
    })();
    this.readUpdates.set(channel, update);
    try {
      await update;
    } finally {
      if (this.readUpdates.get(channel) === update) this.readUpdates.delete(channel);
    }
  }
  async unread(channel: string, locallyRead?: string): Promise<boolean | undefined> {
    const { channel: info } = await this.call<{ channel: Channel }>("conversations.info", { channel });
    if (!locallyRead) {
      const count = info.unread_count_display ?? info.unread_count;
      if (count !== undefined) return count > 0;
    }
    const cursor = laterTimestamp(info.last_read, locallyRead);
    if (!cursor) return undefined; // Missing metadata is not evidence of unread messages.
    const { messages } = await this.call<{ messages: Message[] }>("conversations.history", {
      channel, oldest: cursor, inclusive: false, limit: 1,
    });
    return messages.length > 0;
  }
  async replies(channel: string, ts: string): Promise<Message[]> {
    return this.pages<Message>("conversations.replies", "messages", { channel, ts });
  }
  async send(channel: string, text: string, image?: ImageAttachment, threadTs?: string): Promise<Message> {
    if (image) {
      const upload = await this.call<{ upload_url: string; file_id: string }>("files.getUploadURLExternal", {
        filename: image.filename, length: image.bytes.byteLength,
      });
      const url = new URL(upload.upload_url);
      if (url.protocol !== "https:" || url.hostname !== "files.slack.com") throw new Error("Unexpected Slack upload URL.");
      // The upload URL is already authorized; never forward our OAuth token.
      const response = await fetch(url, {
        method: "POST", headers: { "Content-Type": image.mimeType },
        body: new Uint8Array(image.bytes), redirect: "error", signal: AbortSignal.timeout(120_000),
      });
      if (!response.ok) throw new Error(`Image upload failed: HTTP ${response.status}`);
      await this.call("files.completeUploadExternal", {
        files: [{ id: upload.file_id, title: image.filename }],
        channel_id: channel, ...(text ? { initial_comment: text } : {}),
        ...(threadTs ? { thread_ts: threadTs } : {}),
      });
      // Optimistic display only; a refresh replaces this with Slack's message.
      return { ts: String(Date.now() / 1000), user: this.userId, text, thread_ts: threadTs, files: [{ name: image.filename, mimetype: image.mimeType, previewBytes: image.bytes }] };
    }
    const data = await this.call<{ message: Message }>("chat.postMessage", { channel, text, ...(threadTs ? { thread_ts: threadTs } : {}) });
    return data.message;
  }
  async edit(channel: string, ts: string, text: string) {
    await this.call("chat.update", { channel, ts, text });
  }
  async setReaction(channel: string, ts: string, name: string, add: boolean) {
    await this.call(add ? "reactions.add" : "reactions.remove", { channel, timestamp: ts, name });
  }
  readImage(image: MessageImage) {
    if (!image.bytes && image.private && this.grantedScopes && !this.grantedScopes.has("files:read")) {
      return Promise.reject(new Error("Missing files:read permission. Add it to User Token Scopes and reauthorize the app."));
    }
    return downloadMessageImage(image, async () => typeof this.token === "function" ? this.token() : this.token);
  }
}

export function updateReaction(message: Message, user: string, name: string, add: boolean) {
  const reactions = message.reactions ??= [];
  const reaction = reactions.find(item => item.name === name);
  if (!reaction) {
    if (add) reactions.push({ name, count: 1, users: [user] });
  } else if (add && !reaction.users?.includes(user)) {
    (reaction.users ??= []).push(user);
    reaction.count++;
  } else if (!add && reaction.users?.includes(user)) {
    reaction.users = reaction.users.filter(id => id !== user);
    if (--reaction.count === 0) reactions.splice(reactions.indexOf(reaction), 1);
  }
}

export function laterTimestamp(a?: string, b?: string): string | undefined {
  if (!a) return b;
  if (!b) return a;
  // Slack timestamps have microsecond precision; avoid floating-point rounding.
  const parts = (value: string) => {
    const [seconds, fraction = ""] = value.split(".");
    return BigInt(seconds) * 1_000_000n + BigInt(fraction.padEnd(6, "0").slice(0, 6));
  };
  return parts(a) >= parts(b) ? a : b;
}

export function compactName(name: string) {
  const parts = name.trim().split(/\s+/);
  if (parts.length < 2) return name.trim();
  return `${parts[0]} ${Array.from(parts.at(-1)!)[0]}.`;
}

export function channelName(channel: Channel, users: Map<string, string>) {
  if (channel.is_mpim) {
    const name = channel.name?.trim();
    if (name && (channel.properties?.has_custom_mpdm_name || !name.startsWith("mpdm-"))) return name;
    // Slack's generated MPIM name encodes usernames, separated by "--".
    // Resolve those using the user directory already loaded at startup.
    if (name?.startsWith("mpdm-")) {
      return name.slice(5).replace(/-\d+$/, "").split("--")
        .map(username => compactName(users.get(username) ?? username)).join(", ");
    }
    return "Group conversation";
  }
  return channel.is_im ? `@ ${users.get(channel.user!) ?? channel.user ?? channel.id}`
    : `${channel.is_private ? "🔒" : "#"} ${channel.name ?? channel.id}`;
}

// Slack supplies this metadata on some conversation objects. Unknown state stays
// visible; this approximates the GUI filter without fetching every history.
export function isSidebarActive(channel: Channel) {
  if ((channel.is_im || channel.is_mpim) && channel.is_open === false) return false;
  return channel.properties?.is_dormant !== true;
}

export function displayText(text: string, users: Map<string, string>) {
  return text
    .replace(/<@([^>|]+)(?:\|[^>]+)?>/g, (_, id) => `@${users.get(id) ?? id}`)
    .replace(/<#([^>|]+)\|([^>]+)>/g, "#$2")
    .replace(/<(https?:\/\/[^>|]+)\|([^>]+)>/g, "$2 ($1)")
    .replace(/<(https?:\/\/[^>]+)>/g, "$1")
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&")
    .replace(/[\x00-\x08\x0b-\x1f\x7f-\x9f]/g, "");
}

function attachmentLink(label: string, url: string) {
  if (!/^https?:\/\//.test(url)) return `${label} (${url})`;
  return `<${url.replace(/</g, "%3C").replace(/>/g, "%3E").replace(/\|/g, "%7C")}|${label.replace(/</g, "&lt;").replace(/>/g, "&gt;")}>`;
}

export function messageSource(message: Message) {
  const attachments = (message.attachments ?? []).map(attachment => {
    const title = attachment.title_link
      ? attachmentLink(attachment.title || "Open", attachment.title_link) : attachment.title;
    const content = [
      attachment.pretext, attachment.author_name, title, attachment.text,
      ...(attachment.fields ?? []).map(field => [field.title, field.value].filter(Boolean).join(": ")),
    ].filter(part => part?.trim()).join("\n");
    const links = (attachment.actions ?? [])
      .filter(action => action.url)
      .map(action => attachmentLink(action.text || "Open", action.url!));
    return [content || attachment.fallback, ...links, attachment.footer]
      .filter(part => part?.trim()).join("\n");
  });
  return [message.text, ...attachments].filter(part => part?.trim()).join("\n\n");
}

export function messageText(message: Message, users: Map<string, string>) {
  return renderEmoji(displayText(messageSource(message), users));
}

export class Demo implements Chat {
  botUsers = new Set(["USLACKBOT"]);
  users = new Map([["alice", "Alice"], ["you", "You"], ["USLACKBOT", "Slackbot"]]);
  avatars = new Map<string, string>();
  private messages = new Map<string, Message[]>([
    ["general", [
      { ts: "1769913600", user: "alice", text: "Welcome to slack-tui! Channels on the left, messages on the right.", reply_count: 2, latest_reply: "1769913720" },
      { ts: "1769913660", thread_ts: "1769913600", user: "you", text: "Threads keep the channel tidy." },
      { ts: "1769913720", thread_ts: "1769913600", user: "alice", text: "Try replying here! Your channel draft stays separate." },
      { ts: "1770000060", user: "alice", text: "Tab switches panes. Enter opens a channel or sends a message.\nCtrl+R refreshes. Page Up/Down scrolls." },
      { ts: "1770000120", user: "you", text: "This is an offline demo. Messages stay in memory; nothing goes to Slack." },
    ]],
    ["dev", [
      { ts: "1770000300", user: "alice", text: "The smallest possible chat client. Try sending a message!" },
      {
        ts: "1770000360", user: "alice", text: "Images in chat! :tada: :smile: :+1::skin-tone-3:",
        reactions: [{ name: "heart", count: 2 }, { name: "+1", count: 3 }],
        files: [{
          name: "demo-gradient.png", mimetype: "image/png",
          previewBytes: new Uint8Array(Buffer.from("iVBORw0KGgoAAAANSUhEUgAAABAAAAAICAIAAAB/FOjAAAAA9UlEQVR4nAXBoQ3AIBRAwe7CAAzAAAyAw2BJ8DBA8U2wGBzuGyx5DNABuk7vLuXRHuOxHucJnuQpntvzeLpnepbneF7P57lUREdMxEZcJERSpETuyBPpkRlZkRN5I1/kUhmdMRmbcZmQSZmSuTNPpmdmZmVO5s18mUtVdMVUbMVVQiVVSuWuPJVemZVVOZW38lUu1dAN07AN1wiN1CiNu/E0emM2VuM03sbXuNRAD8zADtwgDNKgDO7BM+iDOViDM3gH3+BSghaMYAUnBCEJRbiFR+jCFJZwhFf4hEtt9MZs7MZtwiZtyubePJu+mZu1OZt3821+L3PjAXKpx9wAAAAASUVORK5CYII=", "base64")),
        }],
      },
    ]],
    ["dm", [{ ts: "1770000400", user: "alice", text: "Hello <@you> — DMs work here too." }]],
  ]);
  async connect() { return { team: "Offline demo", user: "You", team_id: "demo", user_id: "you" }; }
  async channels() { return [{ id: "general", name: "general" }, { id: "dev", name: "dev" }, { id: "dm", is_im: true, user: "alice" }, { id: "dm-bot", is_im: true, user: "USLACKBOT" }]; }
  async conversation(id: string): Promise<Channel> { return (await this.channels()).find(channel => channel.id === id) ?? { id }; }
  async history(channel: string) { return structuredClone((this.messages.get(channel) ?? []).filter(message => !message.thread_ts || message.thread_ts === message.ts)); }
  async replies(channel: string, ts: string) {
    return structuredClone((this.messages.get(channel) ?? []).filter(message => message.ts === ts || message.thread_ts === ts));
  }
  async setReaction(channel: string, ts: string, name: string, add: boolean) {
    const message = this.messages.get(channel)?.find(message => message.ts === ts);
    if (!message) throw new Error("Message not found.");
    updateReaction(message, "you", name, add);
  }
  async edit(channel: string, ts: string, text: string) {
    const message = this.messages.get(channel)?.find(message => message.ts === ts);
    if (!message || message.user !== "you") throw new Error("Cannot edit this message.");
    message.text = text;
  }
  async markRead(_channel: string, _ts: string) {}
  async presence(user: string): Promise<Presence> { return user === "alice" ? "active" : "away"; }
  async unread(channel: string, locallyRead?: string) {
    const latest = this.messages.get(channel)?.at(-1)?.ts;
    return !!latest && (!locallyRead || laterTimestamp(locallyRead, latest) !== locallyRead);
  }
  async send(channel: string, text: string, image?: ImageAttachment, threadTs?: string) {
    const message = { ts: String(Date.now() / 1000), user: "you", text, thread_ts: threadTs, ...(image ? { files: [{ name: image.filename, mimetype: image.mimeType, previewBytes: image.bytes }] } : {}) };
    if (threadTs) {
      const parent = this.messages.get(channel)?.find(message => message.ts === threadTs);
      if (!parent) throw new Error("Thread not found.");
      parent.reply_count = (parent.reply_count ?? 0) + 1;
      parent.latest_reply = message.ts;
    }
    this.messages.set(channel, [...(this.messages.get(channel) ?? []), message]);
    return message;
  }
  readImage(image: MessageImage) {
    if (!image.bytes) return Promise.reject(new Error("Offline demo has no remote image"));
    return Promise.resolve(image.bytes);
  }
}
