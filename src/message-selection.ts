import type { Renderable, Selection } from "@opentui/core";

/** Only completed selections entirely inside the message pane are auto-copied. */
export function messageSelectionText(selection: Selection | null, messages: Renderable): string {
  if (!selection || selection.isDragging || !selection.selectedRenderables.length) return "";
  for (const selected of selection.selectedRenderables) {
    let parent: Renderable | null = selected;
    while (parent && parent !== messages) parent = parent.parent;
    if (!parent) return "";
  }
  return selection.getSelectedText();
}
