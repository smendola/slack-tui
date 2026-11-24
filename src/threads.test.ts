import { expect, test } from "bun:test";
import { applyThreadEvent } from "./threads";
import { applyLiveEvent } from "./live";
import { Demo, type Message } from "./slack";
import { ThreadPanel } from "./thread-panel";
import { createTestRenderer } from "@opentui/core/testing";

test("thread events remain isolated, deduplicate echoes, and apply edits/deletes/reactions", () => {
  const parent: Message = { ts: "1.000001", text: "Parent", reply_count: 0 };
  const reply = { type: "message", ts: "2.000001", thread_ts: parent.ts, text: "Reply", user: "U1" };
  const channel = applyLiveEvent([parent], reply);
  expect(channel).toHaveLength(1);
  expect(channel[0]?.reply_count).toBe(1);
  expect(applyLiveEvent(channel, reply)[0]?.reply_count).toBe(1);
  let thread = applyThreadEvent([parent], parent.ts, reply);
  expect(thread).toHaveLength(2);
  expect(applyThreadEvent(thread, parent.ts, reply)).toHaveLength(2);
  expect(applyThreadEvent(thread, parent.ts, { ...reply, ts: "3", thread_ts: "other" })).toEqual(thread);
  thread = applyThreadEvent(thread, parent.ts, {
    type: "message", subtype: "message_changed", message: { ...thread[1]!, text: "Edited" },
  });
  expect(thread[1]?.text).toBe("Edited");
  thread = applyThreadEvent(thread, parent.ts, {
    type: "reaction_added", user: "U1", reaction: "heart", item: { type: "message", ts: reply.ts },
  });
  expect(thread[1]?.reactions?.[0]?.count).toBe(1);
  thread = applyThreadEvent(thread, parent.ts, { type: "message", subtype: "message_deleted", deleted_ts: reply.ts });
  expect(thread).toEqual([parent]);
});

test("thread panel preserves independent drafts and attachments, sends only to the chosen thread", async () => {
  const t = await createTestRenderer({ width: 120, height: 30 });
  const chat = new Demo();
  const parents = await chat.history("general");
  const panel = new ThreadPanel(t.renderer, chat, {
    render() {}, report() {}, layout() {}, closed() {}, canRender: () => true, summary() {},
  });
  t.renderer.root.add(panel.pane);
  panel.pane.width = 45;
  try {
    await panel.show("general", parents[0]!, "general");
    panel.insertText("draft one");
    panel.attach({ bytes: new Uint8Array([1, 2, 3]), mimeType: "image/png", filename: "test.png" });
    await panel.show("general", parents[1]!, "general");
    expect(panel.composer.plainText).toBe("");
    panel.insertText("draft two");
    panel.close();
    await panel.show("general", parents[0]!, "general");
    expect(panel.composer.plainText).toBe("draft one");
    await panel.send();
    const replies = await chat.replies("general", parents[0]!.ts);
    expect(replies.at(-1)?.text).toBe("draft one");
    expect(replies.at(-1)?.thread_ts).toBe(parents[0]!.ts);
    expect(replies.at(-1)?.files?.[0]?.name).toBe("test.png");
    expect((await chat.history("general")).some(message => message.text === "draft one")).toBe(false);
    await panel.show("general", parents[1]!, "general");
    expect(panel.composer.plainText).toBe("draft two");
  } finally { panel.dispose(); await t.dispose(); }
});

test("thread history replays live events and ignores a response for an abandoned thread", async () => {
  const t = await createTestRenderer({ width: 120, height: 30 });
  const chat = new Demo();
  const pending: Array<(messages: Message[]) => void> = [];
  chat.replies = () => new Promise(resolve => pending.push(resolve));
  const panel = new ThreadPanel(t.renderer, chat, {
    render() {}, report() {}, layout() {}, closed() {}, canRender: () => true, summary() {},
  });
  t.renderer.root.add(panel.pane);
  try {
    const first = panel.show("general", { ts: "1" }, "general");
    const second = panel.show("general", { ts: "2" }, "general");
    panel.receive({ type: "message", channel: "general", ts: "3", thread_ts: "2", text: "live reply" });
    pending[1]!([{ ts: "2" }]);
    await second;
    pending[0]!([{ ts: "1", text: "stale" }]);
    await first;
    expect(panel.rootTs).toBe("2");
    expect(panel.items.map(message => message.ts)).toEqual(["2", "3"]);
  } finally { panel.dispose(); await t.dispose(); }
});
