import { expect, test } from "bun:test";
import { TextAttributes } from "@opentui/core";
import { createTestRenderer } from "@opentui/core/testing";
import { ChannelSelect } from "./channel-select";
import type { Channel } from "./slack";

test("DM presence indicators distinguish active, away and unknown without losing unread bold", async () => {
  const screen = await createTestRenderer({ width: 24, height: 4 });
  try {
    const channels: Channel[] = [
      { id: "D1", is_im: true, presence: "active", unread: true },
      { id: "D2", is_im: true, presence: "away" },
      { id: "D3", is_im: true },
      { id: "C1" },
    ];
    const menu = new ChannelSelect(screen.renderer, {
      width: 24, height: 4, showDescription: false,
      options: channels.map((value, i) => ({ name: i < 3 ? `@ User${i}` : "# general", description: "", value })),
    });
    screen.renderer.root.add(menu);
    await screen.renderOnce();
    const frame = screen.captureCharFrame();
    expect(frame).toContain("● User0");
    expect(frame).toContain("○ User1");
    expect(frame).toContain("· User2");
    expect(frame).toContain("# general");
    const spans = screen.captureSpans().lines[0]!.spans;
    expect(spans.find(span => span.text.includes("User0"))!.attributes & TextAttributes.BOLD).toBe(TextAttributes.BOLD);
    channels[0]!.presence = "away";
    menu.requestRender();
    await screen.renderOnce();
    expect(screen.captureCharFrame()).toContain("○ User0");
    expect(menu.getSelectedIndex()).toBe(0);
  } finally {
    await screen.dispose();
  }
});

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
