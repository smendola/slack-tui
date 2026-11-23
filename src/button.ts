// Agent sessions: OC:x13-cachy:sal:ses_df58f4884ffeQ73n6oD4HRDj22 Created
import { TextRenderable, type RenderContext } from "@opentui/core";

export const buttonBackground = "#c4c4c4";
export function button(context: RenderContext, label: string, action: () => void) {
  return new TextRenderable(context, {
    content: ` ${label} `, height: 1, alignSelf: "flex-start", selectable: false,
    bg: buttonBackground, fg: "#343434",
    onMouseOver() { this.bg = "#ffffff"; },
    onMouseOut() { this.bg = buttonBackground; },
    onMouseDown(event) {
      if (event.button !== 0) return;
      event.stopPropagation();
      action();
    },
  });
}
