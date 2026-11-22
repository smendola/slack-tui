import { SelectRenderable, type MouseEvent } from "@opentui/core";

/** Single-line, no-description menu; matches SelectRenderable's centered viewport. */
export class ChannelSelect extends SelectRenderable {
  protected override onMouseEvent(event: MouseEvent) {
    if (event.type === "down" && event.button === 0) {
      const row = event.y - this.y;
      const visibleRows = Math.max(1, Math.floor(this.height));
      const offset = Math.max(0, Math.min(
        this.getSelectedIndex() - Math.floor(visibleRows / 2),
        this.options.length - visibleRows,
      ));
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
