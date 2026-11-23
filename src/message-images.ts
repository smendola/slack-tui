import type { Message } from "./slack";

export type MessageImage = { label: string; url?: string; private: boolean; bytes?: Uint8Array };

export function messageImages(message: Message): MessageImage[] {
  const images: MessageImage[] = [];
  for (const file of message.files ?? []) {
    if (!file.mimetype?.startsWith("image/") && !["png", "jpg", "jpeg", "gif", "webp"].includes(file.filetype ?? "")) continue;
    const url = file.thumb_480 || file.thumb_360 || file.thumb_720 || file.url_private;
    if (!url && !file.previewBytes) continue;
    images.push({
      label: file.name || file.title || "Image",
      url, private: !file.is_external && file.mode !== "external" && file.filetype !== "remote",
      bytes: file.previewBytes,
    });
  }
  for (const attachment of message.attachments ?? []) {
    const url = attachment.image_url || attachment.thumb_url;
    if (url) images.push({ label: attachment.title || "Image", url, private: false });
  }
  const blocks = [...(message.blocks ?? []), ...(message.attachments ?? []).flatMap(attachment => attachment.blocks ?? [])];
  for (const block of blocks) {
    if (block.type === "image" && block.image_url) {
      images.push({ label: block.alt_text || "Image", url: block.image_url, private: false });
    }
    if (block.accessory?.type === "image" && block.accessory.image_url) {
      images.push({ label: block.accessory.alt_text || "Image", url: block.accessory.image_url, private: false });
    }
  }
  const seen = new Set<string>();
  return images.filter(image => {
    if (!image.url) return true;
    if (seen.has(image.url)) return false;
    seen.add(image.url);
    return true;
  });
}

export async function downloadMessageImage(image: MessageImage, getToken?: () => Promise<string>): Promise<Uint8Array> {
  if (image.bytes) return image.bytes;
  if (!image.url) throw new Error("No image URL");
  let url = new URL(image.url);
  let authorize = image.private;
  const signal = AbortSignal.timeout(20_000);
  for (let redirects = 0; redirects <= 4; redirects++) {
    if (url.protocol !== "https:") throw new Error("Image URL must use HTTPS");
    authorize = authorize && url.hostname === "files.slack.com";
    const headers: Record<string, string> = {};
    if (authorize && getToken) headers.Authorization = `Bearer ${await getToken()}`;
    const response = await fetch(url, { headers, redirect: "manual", signal });
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const location = response.headers.get("location");
      await response.body?.cancel();
      if (!location) throw new Error("Image redirect has no destination");
      url = new URL(location, url);
      continue;
    }
    if (!response.ok) {
      await response.body?.cancel();
      throw new Error(image.private && [401, 403].includes(response.status)
        ? "Slack denied image access; check files:read permission"
        : `Image unavailable (HTTP ${response.status})`);
    }
    if (!response.body || !response.headers.get("content-type")?.toLowerCase().startsWith("image/")) {
      await response.body?.cancel();
      throw new Error("Image unavailable; check Slack file permissions");
    }
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let size = 0;
    try {
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > 8 * 1024 * 1024) throw new Error("Image preview exceeds 8 MiB");
        chunks.push(value);
      }
    } finally { await reader.cancel(); }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
    return bytes;
  }
  throw new Error("Too many image redirects");
}

export class MessageImageCache {
  private cache = new Map<string, Promise<Uint8Array>>();
  constructor(private load: (image: MessageImage) => Promise<Uint8Array>) {}
  get(image: MessageImage): Promise<Uint8Array> {
    if (image.bytes) return Promise.resolve(image.bytes);
    const key = `${image.private}:${image.url}`;
    const existing = this.cache.get(key);
    if (existing) return existing;
    const result = this.load(image).catch(error => {
      this.cache.delete(key);
      throw error;
    });
    if (this.cache.size >= 32) this.cache.delete(this.cache.keys().next().value!);
    this.cache.set(key, result);
    return result;
  }
}
