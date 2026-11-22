import { type ImageAttachment } from "./attachment";

export type Channel = {
  id: string; name?: string; user?: string; is_im?: boolean; is_mpim?: boolean; is_private?: boolean;
  is_open?: boolean;
  properties?: { has_custom_mpdm_name?: boolean; is_dormant?: boolean };
};
export type Message = {
  ts: string; text?: string; user?: string; bot_id?: string;
  reply_count?: number; files?: { name?: string }[];
  attachments?: {
    pretext?: string; author_name?: string; title?: string; title_link?: string;
    text?: string; fallback?: string; footer?: string;
    fields?: { title?: string; value?: string }[];
    actions?: { text?: string; url?: string }[];
  }[];
};
type User = { id: string; name: string; profile?: { display_name?: string; real_name?: string } };
export interface Chat {
  users: Map<string, string>;
  connect(): Promise<{ team: string; user: string }>;
  channels(): Promise<Channel[]>;
  history(channel: string): Promise<Message[]>;
  send(channel: string, text: string, image?: ImageAttachment): Promise<Message>;
}

export class Slack implements Chat {
  users = new Map<string, string>();
  private blockedUntil = new Map<string, number>();
  private userId?: string;
  constructor(private token: string | (() => Promise<string>)) {}

  private async call<T>(method: string, params: Record<string, unknown> = {}): Promise<T> {
    const wait = Math.ceil(((this.blockedUntil.get(method) ?? 0) - Date.now()) / 1000);
    if (wait > 0) throw new Error(`Rate limited: retry ${method} in ${wait}s.`);
    const form = method.startsWith("files.");
    const write = method === "chat.postMessage" || form;
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
    const auth = await this.call<{ team: string; user: string; user_id: string }>("auth.test");
    this.userId = auth.user_id;
    const users = await this.pages<User>("users.list", "members");
    for (const user of users) {
      const name = user.profile?.display_name || user.profile?.real_name || user.name;
      this.users.set(user.id, name);
      this.users.set(user.name, name);
    }
    return auth;
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
        const name = user.profile?.display_name || user.profile?.real_name || user.name;
        this.users.set(user.id, name);
        if (user.name) this.users.set(user.name, name);
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
  async send(channel: string, text: string, image?: ImageAttachment): Promise<Message> {
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
      });
      // Optimistic display only; a refresh replaces this with Slack's message.
      return { ts: String(Date.now() / 1000), user: this.userId, text, files: [{ name: image.filename }] };
    }
    const data = await this.call<{ message: Message }>("chat.postMessage", { channel, text });
    return data.message;
  }
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

export function messageText(message: Message, users: Map<string, string>) {
  const attachments = (message.attachments ?? []).map(attachment => {
    const title = attachment.title_link
      ? `${attachment.title || "Open"} (${attachment.title_link})` : attachment.title;
    const content = [
      attachment.pretext, attachment.author_name, title, attachment.text,
      ...(attachment.fields ?? []).map(field => [field.title, field.value].filter(Boolean).join(": ")),
    ].filter(part => part?.trim()).join("\n");
    const links = (attachment.actions ?? [])
      .filter(action => action.url)
      .map(action => `${action.text || "Open"} (${action.url})`);
    return [content || attachment.fallback, ...links, attachment.footer]
      .filter(part => part?.trim()).join("\n");
  });
  return displayText([message.text, ...attachments].filter(part => part?.trim()).join("\n\n"), users);
}

export class Demo implements Chat {
  users = new Map([["alice", "Alice"], ["you", "You"]]);
  private messages = new Map<string, Message[]>([
    ["general", [
      { ts: "1770000000", user: "alice", text: "Welcome to slack-tui! Channels on the left, messages on the right." },
      { ts: "1770000060", user: "alice", text: "Tab switches panes. Enter opens a channel or sends a message.\nCtrl+R refreshes. Page Up/Down scrolls." },
      { ts: "1770000120", user: "you", text: "This is an offline demo. Messages stay in memory; nothing goes to Slack." },
    ]],
    ["dev", [{ ts: "1770000300", user: "alice", text: "The smallest possible chat client. Try sending a message!" }]],
    ["dm", [{ ts: "1770000400", user: "alice", text: "Hello <@you> — DMs work here too." }]],
  ]);
  async connect() { return { team: "Offline demo", user: "You" }; }
  async channels() { return [{ id: "general", name: "general" }, { id: "dev", name: "dev" }, { id: "dm", is_im: true, user: "alice" }]; }
  async history(channel: string) { return [...(this.messages.get(channel) ?? [])]; }
  async send(channel: string, text: string, image?: ImageAttachment) {
    const message = { ts: String(Date.now() / 1000), user: "you", text, ...(image ? { files: [{ name: image.filename }] } : {}) };
    this.messages.set(channel, [...(this.messages.get(channel) ?? []), message]);
    return message;
  }
}
