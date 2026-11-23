import { expect, test } from "bun:test";
import { BoxRenderable, TextRenderable, TextareaRenderable, type Selection } from "@opentui/core";
import { createTestRenderer } from "@opentui/core/testing";
import { messageSelectionText } from "./message-selection";

test("message text is copied on release, stays selected, and composer selections are ignored", async () => {
  const screen = await createTestRenderer({ width: 32, height: 8 });
  try {
    const messages = new BoxRenderable(screen.renderer, { width: 32, height: 3, flexDirection: "column" });
    messages.add(new TextRenderable(screen.renderer, { content: "Hello world", height: 1 }));
    messages.add(new TextRenderable(screen.renderer, { content: "Second line", height: 1 }));
    screen.renderer.root.add(messages);
    const composer = new TextareaRenderable(screen.renderer, { width: 32, height: 2, initialValue: "Unsent draft" });
    screen.renderer.root.add(composer);
    const copied: string[] = [];
    screen.renderer.on("selection", (selection: Selection | null) => {
      const text = messageSelectionText(selection, messages);
      if (text) copied.push(text);
    });
    await screen.renderOnce();
    await screen.mockMouse.pressDown(0, 0);
    await screen.mockMouse.moveTo(4, 0);
    expect(copied).toEqual([]);
    expect(messageSelectionText(screen.renderer.getSelection(), messages)).toBe("");
    await screen.mockMouse.release(4, 0);
    expect(copied).toEqual(["Hello"]);
    expect(screen.renderer.getSelection()?.getSelectedText()).toBe("Hello");

    await screen.mockMouse.drag(0, composer.y, 6, composer.y);
    expect(copied).toEqual(["Hello"]);
    expect(composer.plainText).toBe("Unsent draft");

    screen.renderer.clearSelection();
    await screen.mockMouse.drag(0, 0, 5, 1);
    expect(copied.at(-1)).toBe("Hello world\nSecond");
  } finally {
    await screen.dispose();
  }
});
