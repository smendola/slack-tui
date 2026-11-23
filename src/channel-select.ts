import { SelectRenderable, RGBA, TextAttributes, type OptimizedBuffer, type MouseEvent } from "@opentui/core";

const normal = RGBA.fromHex("#e0def4");
const selected = RGBA.fromHex("#f6c177");
const background = RGBA.fromHex("#191724");
const highlight = RGBA.fromHex("#403d52");
const indicator = RGBA.fromHex("#524f67");

/** Single-line, no-description menu; matches SelectRenderable's centered viewport. */
export class ChannelSelect extends SelectRenderable {
  private visibleOffset() {
    return Math.max(0, Math.min(
      this.getSelectedIndex() - Math.floor(this.height / 2),
      this.options.length - Math.max(1, Math.floor(this.height)),
    ));
  }

  // SelectRenderable has no per-option attributes. Keep its selection/key handling,
  // but draw our single-line rows with native bold attributes and cell clipping.
  protected override renderSelf(buffer: OptimizedBuffer) {
    const [x, y] = this._paintOrigin(buffer);
    const width = this._paintWidth;
    const height = Math.floor(this._paintHeight);
    const offset = this.visibleOffset();
    const scrolls = this.options.length > height;
    buffer.pushScissorRect(x, y, width, height);
    buffer.fillRect(x, y, width, height, background);
    for (let row = 0; row < height; row++) {
      const option = this.options[offset + row];
      if (!option) break;
      const active = offset + row === this.getSelectedIndex();
      const bg = active ? highlight : background;
      if (active) buffer.fillRect(x, y + row, width, 1, bg);
      buffer.pushScissorRect(x + 1, y + row, Math.max(0, width - 1 - Number(scrolls)), 1);
      buffer.drawText(`${active ? "▶ " : "  "}${option.name}`, x + 1, y + row,
        active ? selected : normal, bg, option.value?.unread ? TextAttributes.BOLD : 0);
      buffer.popScissorRect();
    }
    if (scrolls && height > 0 && width > 0) {
      const row = Math.min(height - 1, 1 + Math.floor(offset / (this.options.length - height) * Math.max(0, height - 2)));
      buffer.drawText("█", x + width - 1, y + row, indicator, background);
    }
    buffer.popScissorRect();
  }

  protected override onMouseEvent(event: MouseEvent) {
    if (event.type === "down" && event.button === 0) {
      const row = event.y - this.y;
      const offset = this.visibleOffset();
      const index = offset + row;
      if (row < 0 || row >= this.height || index >= this.options.length) return;
      this.focus();
      this.setSelectedIndex(index);
      this.selectCurrent();
      event.stopPropagation();
    } else if (event.type === "scroll") {
      const direction = event.scroll?.direction;
      const steps = Math.max(1, Math.round(event.scroll?.delta ?? 1));
      if (direction === "up") this.moveUp(steps);
      else if (direction === "down") this.moveDown(steps);
      event.stopPropagation();
    }
  }
}
