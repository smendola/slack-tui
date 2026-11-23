import { expect, test } from "bun:test";
import { TextRenderable } from "@opentui/core";
import { createTestRenderer } from "@opentui/core/testing";
import { messageContent } from "./message-content";

test("Slack link labels render without URLs while retaining clickable targets", async () => {
  const content = messageContent({
    ts: "1", text: "Hi <@U1>: <https://example.com/task?a=1&amp;b=2|Read &amp; reply> :smile:",
  }, new Map([["U1", "Alice"]]));
  expect(content.chunks.map(chunk => chunk.text).join("")).toBe("Hi @Alice: Read & reply 😄");
  expect(content.chunks.find(chunk => chunk.link)?.link?.url).toBe("https://example.com/task?a=1&b=2");
  const screen = await createTestRenderer({ width: 50, height: 3 });
  try {
    screen.renderer.root.add(new TextRenderable(screen.renderer, { content, width: 50 }));
    await screen.renderOnce();
    expect(screen.captureCharFrame()).toContain("Read & reply");
    expect(screen.captureCharFrame()).not.toContain("https://");
  } finally {
    await screen.dispose();
  }
});

test("attachment titles and actions use labels, and Asana trackers link directly to the task", () => {
  const destination = "https://app.asana.com/0/0/1220384402749187/f";
  const tracking = `https://app.asana.com/app/asana/-/log?hash=abc&dest=${encodeURIComponent(destination)}&se=${"x".repeat(600)}`;
  const content = messageContent({
    ts: "1", attachments: [{
      title: "Weekly digest", title_link: tracking, text: "Task details",
      actions: [{ text: "View task", url: destination }],
    }],
  }, new Map(), "\n1 reply");
  expect(content.chunks.map(chunk => chunk.text).join("")).toBe("Weekly digest\nTask details\nView task\n1 reply");
  expect(content.chunks.filter(chunk => chunk.link).map(chunk => chunk.link!.url)).toEqual([destination, destination]);
});

test("unlabeled URLs stay visible and code does not become a hyperlink", () => {
  const content = messageContent({
    ts: "1", text: "<https://example.com/path> `:smile:` `<https://example.com/code>`",
  }, new Map());
  expect(content.chunks.filter(chunk => chunk.link).map(chunk => chunk.link!.url)).toEqual(["https://example.com/path"]);
  expect(content.chunks.map(chunk => chunk.text).join("")).toContain("`:smile:`");
});

test("control characters cannot become hyperlink targets", () => {
  const content = messageContent({ ts: "1", text: "<https://example.com/\x1b|label>" }, new Map());
  expect(content.chunks.map(chunk => chunk.text).join("")).toBe("label");
  expect(content.chunks.some(chunk => chunk.link)).toBe(false);
});
