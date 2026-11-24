import { applyLiveEvent, type LiveEvent } from "./live";
import { laterTimestamp, type Message } from "./slack";

/** Thread messages never leak into the channel timeline unless explicitly broadcast. */
export function applyThreadEvent(messages: Message[], root: string, event: LiveEvent): Message[] {
  if (event.type !== "message" || ["message_changed", "message_deleted", "message_replied"].includes(event.subtype ?? "")) {
    return applyLiveEvent(messages, event);
  }
  if (event.thread_ts !== root || !event.ts || event.hidden) return messages;
  return applyLiveEvent(messages, { ...event, subtype: "thread_broadcast" });
}

export function threadLabel(message: Message) {
  if (!message.reply_count) return "↳ Reply";
  const age = message.latest_reply ? Math.max(0, Math.floor((Date.now() / 1000 - Number(message.latest_reply)) / 60)) : undefined;
  const when = age === undefined ? "" : age < 1 ? " · just now" : age < 60 ? ` · ${age}m ago`
    : age < 1440 ? ` · ${Math.floor(age / 60)}h ago` : ` · ${Math.floor(age / 1440)}d ago`;
  return `↳ ${message.reply_count} ${message.reply_count === 1 ? "reply" : "replies"}${when}`;
}

export function summarizeThread(parent: Message, replies: Message[]) {
  const children = replies.filter(message => message.ts !== parent.ts);
  return { ...parent, reply_count: children.length,
    latest_reply: children.reduce<string | undefined>((last, message) => laterTimestamp(last, message.ts), undefined) };
}
