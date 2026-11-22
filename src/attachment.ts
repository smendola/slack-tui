export const MAX_IMAGE_BYTES = 20 * 1024 * 1024;
export type ImageAttachment = { bytes: Uint8Array; mimeType: string; filename: string };

export function clipboardImage(bytes: Uint8Array, mimeType: string): ImageAttachment {
  if (!bytes.length || bytes.length > MAX_IMAGE_BYTES) throw new Error("Clipboard image must be between 1 byte and 20 MiB.");
  const extensions: Record<string, string> = { "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp", "image/gif": "gif" };
  const extension = extensions[mimeType];
  const ascii = (start: number, end: number) => new TextDecoder().decode(bytes.slice(start, end));
  const valid = mimeType === "image/png" ? [137, 80, 78, 71, 13, 10, 26, 10].every((byte, i) => bytes[i] === byte)
    : mimeType === "image/jpeg" ? bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255
    : mimeType === "image/webp" ? ascii(0, 4) === "RIFF" && ascii(8, 12) === "WEBP"
    : mimeType === "image/gif" ? ["GIF87a", "GIF89a"].includes(ascii(0, 6)) : false;
  if (!extension || !valid) throw new Error("Clipboard does not contain a supported PNG, JPEG, WebP or GIF image.");
  return { bytes, mimeType, filename: `clipboard-${Date.now()}.${extension}` };
}
