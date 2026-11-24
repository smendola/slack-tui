import { expect, test } from "bun:test";
import { SocketModeClient } from "@slack/socket-mode";
import { applyLiveEvent, connectLive, isNewMessage, type LiveEvent } from "./live";

test("pushed messages deduplicate outgoing echoes, order messages, and apply edits/deletes", () => {
  let messages = [{ ts: "100.000001", text: "First", user: "U1" }];
  messages = applyLiveEvent(messages, { type: "message", ts: "100.000002", text: "Second", user: "U2" }) as typeof messages;
  messages = applyLiveEvent(messages, { type: "message", ts: "100.000002", text: "Second", user: "U2" }) as typeof messages;
  expect(messages).toHaveLength(2);
  messages = applyLiveEvent(messages, { type: "message", subtype: "message_changed", message: { ts: "100.000001", text: "Edited" } }) as typeof messages;
  expect(messages[0]!.text).toBe("Edited");
  expect(messages[0]!.user).toBe("U1");
  messages = applyLiveEvent(messages, { type: "message", subtype: "message_deleted", deleted_ts: "100.000002" }) as typeof messages;
  expect(messages).toHaveLength(1);
});

test("thread replies do not masquerade as top-level messages and reactions are idempotent", () => {
  const initial = [{ ts: "1", text: "Hello" }];
  const reply = { type: "message", ts: "2", thread_ts: "1", text: "Thread reply" };
  expect(isNewMessage(reply)).toBe(false);
  expect(applyLiveEvent(initial, reply)).toEqual(initial);
  const reaction = { type: "reaction_added", user: "U1", reaction: "heart", item: { type: "message", ts: "1" } };
  let messages = applyLiveEvent(initial, reaction);
  messages = applyLiveEvent(messages, reaction);
  expect(messages[0]!.reactions).toEqual([{ name: "heart", count: 1, users: ["U1"] }]);
  expect(initial).toEqual([{ ts: "1", text: "Hello" }]);
  messages = applyLiveEvent(messages, { ...reaction, type: "reaction_removed" });
  expect(messages[0]!.reactions).toEqual([]);
});

test("real Socket Mode transport acknowledges duplicates, filters workspaces and reconnects", async () => {
  const events: LiveEvent[] = [];
  const acknowledgements: string[] = [];
  const states: string[] = [];
  let connections = 0;
  const sockets = new Set<{ terminate(): void }>();
  let complete!: () => void;
  const done = new Promise<void>(resolve => { complete = resolve; });
  const server = Bun.serve({
    port: 0, hostname: "127.0.0.1",
    fetch(request, server) {
      if (new URL(request.url).pathname === "/socket") {
        if (server.upgrade(request)) return;
        return new Response("Upgrade failed", { status: 400 });
      }
      return Response.json({ ok: true, url: `ws://127.0.0.1:${server.port}/socket` });
    },
    websocket: {
      open(socket) {
        sockets.add(socket);
        connections++;
        socket.send(JSON.stringify({ type: "hello" }));
        const batch = connections === 1
          ? [["one", "E1", "T1"], ["retry", "E1", "T1"], ["other", "E2", "T2"]]
          : [["retry-again", "E1", "T1"], ["new", "E3", "T1"]];
        for (const [envelope_id, event_id, team_id] of batch) {
          socket.send(JSON.stringify({
            type: "events_api", envelope_id,
            payload: { event_id, team_id, authorizations: [{ user_id: "U1" }], event: { type: "message", channel: "C1", ts: "1", text: "Live!" } },
          }));
        }
      },
      message(socket, message) {
        const data = JSON.parse(String(message));
        if (data.envelope_id) acknowledgements.push(data.envelope_id);
        if (acknowledgements.length === 3) setTimeout(() => socket.close(1001, "reconnect test"), 100);
        if (acknowledgements.length === 5) complete();
      },
    },
  });
  const live = connectLive("xapp-test", "T1", "U1", {
    event: event => { events.push(event); }, state: state => { states.push(state); },
  }, options => new SocketModeClient({ ...options, clientOptions: { slackApiUrl: `http://127.0.0.1:${server.port}/api/` } }));
  try {
    await Promise.race([done, new Promise((_, reject) => {
      setTimeout(() => reject(new Error(`Socket test timed out: ${JSON.stringify({ states, acknowledgements, connections })}`)), 8000).unref();
    })]);
    expect(acknowledgements).toEqual(["one", "retry", "other", "retry-again", "new"]);
    expect(events).toHaveLength(2);
    expect(events[0]!.text).toBe("Live!");
    expect(states).toContain("reconnecting");
    expect(states.filter(state => state === "live")).toHaveLength(2);
  } finally {
    await live.stop();
    for (const socket of sockets) socket.terminate();
    // Stop accepting requests and terminate sockets; Bun 1.3.11's stop promise
    // can stay pending after a peer-initiated WebSocket reconnect.
    void server.stop(true);
  }
}, 10_000);
