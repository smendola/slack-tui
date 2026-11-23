import { expect, test } from "bun:test";
import { TextAttributes } from "@opentui/core";
import { createTestRenderer } from "@opentui/core/testing";
import { ChannelSelect } from "./channel-select";

test("unread rows stay bold through selection and scrolling, then clear when read", async () => {
  const screen = await createTestRenderer({ width: 24, height: 3 });
  try {
    const options = Array.from({ length: 8 }, (_, i) => ({
      name: `channel-${i}`, description: "", value: { unread: i === 5 },
    }));
    const menu = new ChannelSelect(screen.renderer, {
      width: 24, height: 3, showDescription: false, options,
    });
    screen.renderer.root.add(menu);
    menu.setSelectedIndex(4);
    await screen.renderOnce();
    const span = () => screen.captureSpans().lines.flatMap(line => line.spans)
      .find(part => part.text.includes("channel-5"))!;
    expect(span().attributes & TextAttributes.BOLD).toBe(TextAttributes.BOLD);
    await screen.mockMouse.click(5, 2);
    expect(menu.getSelectedIndex()).toBe(5);
    await screen.renderOnce();
    expect(span().attributes & TextAttributes.BOLD).toBe(TextAttributes.BOLD);
    options[5]!.value.unread = false;
    menu.requestRender();
    await screen.renderOnce();
    expect(span().attributes & TextAttributes.BOLD).toBe(0);
  } finally {
    await screen.dispose();
  }
});
