import sharp from "sharp";

/** Crop to the square avatar frame, then mask with antialiased transparent corners. */
export async function roundAvatar(bytes: Uint8Array): Promise<Uint8Array> {
  const image = sharp(bytes);
  const { width, height } = await image.metadata();
  if (!width || !height) throw new Error("Avatar has no dimensions");
  const size = Math.min(width, height);
  const radius = size * 0.25;
  const mask = Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}">` +
    `<rect width="${size}" height="${size}" rx="${radius}" ry="${radius}" fill="white"/></svg>`,
  );
  return image.resize(size, size, { fit: "cover" }).ensureAlpha()
    .composite([{ input: mask, blend: "dest-in" }]).png().toBuffer();
}

/** Cache small public profile images for this session; no Slack credentials sent. */
export class AvatarCache {
  private images = new Map<string, Promise<Uint8Array | undefined>>();
  get(url: string): Promise<Uint8Array | undefined> {
    const existing = this.images.get(url);
    if (existing) return existing;
    const result = this.download(url).catch(() => undefined);
    if (this.images.size >= 256) this.images.delete(this.images.keys().next().value!);
    this.images.set(url, result);
    return result;
  }
  private async download(url: string) {
    if (new URL(url).protocol !== "https:") return undefined;
    const response = await fetch(url, { signal: AbortSignal.timeout(10_000) });
    if (!response.ok || !response.body) return undefined;
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let length = 0;
    try {
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        length += value.byteLength;
        if (length > 1024 * 1024) return undefined;
        chunks.push(value);
      }
    } finally { await reader.cancel(); }
    const bytes = new Uint8Array(length);
    let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    return roundAvatar(bytes);
  }
}
