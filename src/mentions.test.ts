import { expect, test } from "bun:test";
import { BoxRenderable, TextareaRenderable } from "@opentui/core";
import { createTestRenderer } from "@opentui/core/testing";
import { createMentionPicker, mentionMatches, mentionQuery } from "./mentions";

test("mention queries recognize caret context without matching emails or Slack markup", () => {
  expect(mentionQuery("Hi @sal later", 7)).toEqual({ start: 3, end: 7, query: "sal" });
  expect(mentionQuery("a@sal", 5)).toBeUndefined();
  expect(mentionQuery("<@U123>", 6)).toBeUndefined();
  expect(mentionQuery("@", 1)?.query).toBe("");
  expect(mentionQuery("hi\n@Élo", 7)?.query).toBe("Élo");
  expect(mentionMatches(new Map([["U123", "Sal"], ["sal", "Sal"], ["U456", "Sally"]]), "SAL"))
    .toEqual([["U123", "Sal"], ["U456", "Sally"]]);
});

test("mention picker replaces only the query after wide text, preserving the suffix", async () => {
  const t = await createTestRenderer({ width: 70, height: 15 });
  try {
    const parent = new BoxRenderable(t.renderer, { width: "100%" });
    t.renderer.root.add(parent);
    const composer = new TextareaRenderable(t.renderer, { width: "100%", height: 1 });
    parent.add(composer);
    const picker = createMentionPicker(t.renderer, parent, composer, new Map([["U123", "Sal"]]));
    composer.focus();
    composer.insertText("😀 @sa later");
    composer.cursorOffset = composer.editBuffer.stringIndexToCellOffset(6);
    await Promise.resolve();
    await t.renderOnce();
    let prevented = false;
    expect(picker.key({ name: "return", preventDefault() { prevented = true; } } as any)).toBe(true);
    expect(prevented).toBe(true);
    expect(composer.plainText).toBe("😀 @Sal later");
    expect(picker.serialize()).toBe("😀 <@U123> later");
    composer.cursorOffset = 0;
    composer.insertText("Hi ");
    expect(picker.serialize()).toBe("Hi 😀 <@U123> later");
    composer.setText("Draft <@U123> and <@U123>");
    picker.restoreLabels();
    expect(composer.plainText).toBe("Draft @Sal and @Sal");
    expect(picker.serialize()).toBe("Draft <@U123> and <@U123>");
    await Promise.resolve();
    expect(picker.key({ name: "return" } as any)).toBe(false);
  } finally { await t.dispose(); }
});
