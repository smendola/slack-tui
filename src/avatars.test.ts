import { expect, test } from "bun:test";
import sharp from "sharp";
import { roundAvatar } from "./avatars";

test("avatar mask rounds all four corners, preserving the center and existing alpha", async () => {
  for (const alpha of [1, 0.5]) {
    const input = await sharp({
      create: { width: 100, height: 100, channels: 4, background: { r: 200, g: 100, b: 50, alpha } },
    }).png().toBuffer();
    const output = await roundAvatar(input);
    const { data, info } = await sharp(output).raw().toBuffer({ resolveWithObject: true });
    const opacity = (x: number, y: number) => data[(y * info.width + x) * 4 + 3]!;
    expect([info.width, info.height, info.channels]).toEqual([100, 100, 4]);
    for (const [x, y] of [[0, 0], [99, 0], [0, 99], [99, 99]]) expect(opacity(x!, y!)).toBe(0);
    expect(opacity(50, 50)).toBe(Math.round(alpha * 255));
    expect(opacity(25, 0)).toBe(opacity(50, 50));
    expect(opacity(7, 7)).toBeGreaterThan(0);
    expect(opacity(7, 7)).toBeLessThan(opacity(50, 50));
  }
});

test("non-square avatars are cropped before masking so cover rendering preserves corners", async () => {
  const input = await sharp({ create: { width: 120, height: 80, channels: 3, background: "#ffffff" } }).jpeg().toBuffer();
  const result = await sharp(await roundAvatar(input)).metadata();
  expect([result.width, result.height, result.format, result.hasAlpha]).toEqual([80, 80, "png", true]);
});
