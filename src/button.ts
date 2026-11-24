// Agent sessions: OC:x13-cachy:sal:ses_df58f4884ffeQ73n6oD4HRDj22 Created
import { TextRenderable, type RenderContext } from "@opentui/core";

export const buttonBackground = "#c4c4c4";
export function button(context: RenderContext, label: string, action: () => void,
  colors: { background?: string; hover?: string; foreground?: string } = {}) {
  const background = colors.background ?? buttonBackground;
  return new TextRenderable(context, {
    content: ` ${label} `, height: 1, alignSelf: "flex-start", selectable: false,
    bg: background, fg: colors.foreground ?? "#343434",
    onMouseOver() { this.bg = colors.hover ?? "#ffffff"; },
    onMouseOut() { this.bg = background; },
    onMouseDown(event) {
      if (event.button !== 0) return;
      event.stopPropagation();
      action();
    },
  });
}
