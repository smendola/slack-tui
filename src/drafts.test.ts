import { expect, test } from "bun:test";
import { TextareaRenderable } from "@opentui/core";
import { createTestRenderer } from "@opentui/core/testing";
import { restoreDraft } from "./drafts";

test("a selection in another conversation cannot overwrite a restored draft when typing", async () => {
  const screen = await createTestRenderer({ width: 40, height: 10 });
  try {
    const composer = new TextareaRenderable(screen.renderer, { width: 40, height: 3 });
    screen.renderer.root.add(composer);
    composer.focus();
    restoreDraft(composer, "Draft for Jack");
    await screen.renderOnce();
    composer.selectAll();
    // Switching conversations must not apply Jack's selection to Mary's text.
    restoreDraft(composer, "Draft for Mary");
    await screen.mockInput.typeText("!");
    expect(composer.plainText).toBe("Draft for Mary!");
    expect(composer.getSelection()).toBeNull();

    composer.selectAll();
    restoreDraft(composer, "Draft for Jack");
    await screen.mockInput.typeText("?");
    expect(composer.plainText).toBe("Draft for Jack?");
  } finally {
    await screen.dispose();
  }
});

test("restored multiline Unicode drafts resume at the true end, not a UTF-16 offset", async () => {
  const screen = await createTestRenderer({ width: 40, height: 10 });
  try {
    const composer = new TextareaRenderable(screen.renderer, { width: 40, height: 3 });
    screen.renderer.root.add(composer);
    composer.focus();
    restoreDraft(composer, "Hello 👋\n世界");
    await screen.mockInput.typeText("!");
    expect(composer.plainText).toBe("Hello 👋\n世界!");
    composer.selectAll();
    restoreDraft(composer, "");
    await screen.mockInput.typeText("New draft");
    expect(composer.plainText).toBe("New draft");
  } finally {
    await screen.dispose();
  }
});
