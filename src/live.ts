import { SocketModeClient, LogLevel, type SocketModeOptions } from "@slack/socket-mode";
import { laterTimestamp, updateReaction, type Message } from "./slack";

function socketOptions(appToken: string): SocketModeOptions {
  const quiet = () => {};
  return {
    appToken, autoReconnectEnabled: true,
    logger: { debug: quiet, info: quiet, warn: quiet, error: quiet, setLevel: quiet, setName: quiet, getLevel: () => LogLevel.ERROR },
    clientOptions: { retryConfig: { retries: 3 }, timeout: 20_000 },
  };
}

/** Setup succeeds only after Slack's WebSocket hello, not just issuing a URL. */
export async function verifySocketConnection(appToken: string, signal: AbortSignal, appId?: string,
  createClient: (options: SocketModeOptions) => SocketModeClient = options => new SocketModeClient(options)) {
  if (signal.aborted) throw new Error("Socket verification cancelled.");
  const client = createClient({ ...socketOptions(appToken), autoReconnectEnabled: false });
  let connectedApp: string | undefined;
  client.on("ws_message", (raw: string) => {
    try {
      const event = JSON.parse(String(raw));
      if (event.type === "hello") connectedApp = event.connection_info?.app_id;
    } catch { /* The SDK handles malformed frames. */ }
  });
  client.on("slack_event", ({ ack }) => { void ack().catch(() => {}); });
  const deadline = AbortSignal.any([signal, AbortSignal.timeout(30_000)]);
  let abort!: () => void;
  const cancelled = new Promise<never>((_, reject) => {
    abort = () => reject(new Error("Socket verification cancelled or timed out."));
    deadline.addEventListener("abort", abort, { once: true });
    if (deadline.aborted) abort();
  });
  try {
    await Promise.race([client.start(), cancelled]);
    if (appId && connectedApp && appId !== connectedApp) {
      throw new Error("That app-level token belongs to a different Slack app.");
    }
  } catch (error) {
    if (error instanceof Error && /^(That app-level|Socket verification)/.test(error.message)) throw error;
    throw new Error("Could not connect to Slack Socket Mode. Check the app-level token, connections:write scope, Socket Mode setting and network.");
  } finally {
    deadline.removeEventListener("abort", abort);
    await client.disconnect();
  }
}

export type LiveEvent = {
  type: string; channel?: string; subtype?: string; ts?: string; user?: string;
  text?: string; thread_ts?: string; hidden?: boolean; deleted_ts?: string;
  message?: Message & { thread_ts?: string };
  item?: { type?: string; channel?: string; ts?: string };
  reaction?: string;
};
export function eventChannel(event: LiveEvent) { return event.channel ?? event.item?.channel; }
export function isNewMessage(event: LiveEvent) {
  return event.type === "message" && !!event.ts && !event.hidden
    && !["message_changed", "message_deleted", "message_replied"].includes(event.subtype ?? "")
    && (!event.thread_ts || event.thread_ts === event.ts || event.subtype === "thread_broadcast");
}

/** Apply a pushed event to the loaded history without duplicating echoed sends. */
export function applyLiveEvent(messages: Message[], event: LiveEvent): Message[] {
  if (event.type === "reaction_added" || event.type === "reaction_removed") {
    if (event.item?.type !== "message" || !event.user || !event.reaction) return messages;
    return messages.map(message => {
      if (message.ts !== event.item!.ts) return message;
      const copy = structuredClone(message);
      updateReaction(copy, event.user!, event.reaction!, event.type === "reaction_added");
      return copy;
    });
  }
  if (event.type !== "message") return messages;
  if (event.subtype === "message_deleted") return messages.filter(message => message.ts !== event.deleted_ts);
  if (event.subtype === "message_changed" || event.subtype === "message_replied") {
    if (!event.message) return messages;
    return messages.map(message => message.ts === event.message!.ts ? { ...message, ...event.message } : message);
  }
  if (!isNewMessage(event)) return messages;
  const incoming = event as Message;
  const existing = messages.findIndex(message => message.ts === incoming.ts);
  if (existing >= 0) return messages.map((message, index) => index === existing ? { ...message, ...incoming } : message);
  return [...messages, incoming].sort((a, b) => a.ts === b.ts ? 0 : laterTimestamp(a.ts, b.ts) === a.ts ? 1 : -1);
}

export function connectLive(appToken: string, team: string, user: string, handlers: {
  event(event: LiveEvent): void;
  state(state: "connecting" | "live" | "reconnecting" | "offline"): void;
}, createClient: (options: SocketModeOptions) => SocketModeClient = options => new SocketModeClient(options)) {
  // SDK logs can contain full event payloads or connection URLs. Keep them out
  // of the terminal/transcript; surface only connection state to the UI.
  const client = createClient(socketOptions(appToken));
  let stopped = false;
  const seen = new Set<string>();
  client.on("slack_event", ({ ack, body, type, envelope_id }) => {
    // Acknowledge immediately, even duplicates and unrelated workspace events.
    void ack().catch(() => {});
    if (stopped || type !== "events_api" || body?.team_id !== team || !body.event) return;
    if (body.authorizations?.length && !body.authorizations.some((auth: { user_id?: string }) => auth.user_id === user)) return;
    const id = body.event_id ?? envelope_id;
    if (seen.has(id)) return;
    seen.add(id);
    if (seen.size > 2000) seen.delete(seen.values().next().value!);
    handlers.event(body.event);
  });
  for (const [event, state] of [["connecting", "connecting"], ["connected", "live"], ["reconnecting", "reconnecting"], ["disconnected", "offline"]] as const) {
    client.on(event, () => { if (!stopped) handlers.state(state); });
  }
  client.on("error", () => { if (!stopped) handlers.state("offline"); });
  void client.start().catch(() => { if (!stopped) handlers.state("offline"); });
  return {
    stop() { stopped = true; return client.disconnect(); },
  };
}
