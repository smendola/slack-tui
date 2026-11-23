import type { TextareaRenderable } from "@opentui/core";

/** setText resets undo history, but retains the previous document's selection. */
export function restoreDraft(composer: TextareaRenderable, text: string) {
  composer.clearSelection();
  composer.setText(text);
  composer.gotoBufferEnd();
}
