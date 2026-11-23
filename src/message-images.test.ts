import { afterEach, expect, test } from "bun:test";
import { downloadMessageImage, messageImages } from "./message-images";
import { renderEmoji } from "./emoji";

const originalFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = originalFetch; });

test("message images prefer thumbnails, include bot/block images and deduplicate URLs", () => {
  const images = messageImages({
    ts: "1",
    files: [
      { name: "photo.png", mimetype: "image/png", thumb_480: "https://files.slack.com/thumb", url_private: "https://files.slack.com/full" },
      { name: "doc.pdf", mimetype: "application/pdf", url_private: "https://files.slack.com/doc" },
      { name: "external.png", mimetype: "image/png", is_external: true, url_private: "https://example.com/image" },
    ],
    attachments: [{ title: "Preview", image_url: "https://example.com/preview" }],
    blocks: [{ type: "image", image_url: "https://example.com/preview", alt_text: "Duplicate" }],
  });
  expect(images.map(image => [image.url, image.private])).toEqual([
    ["https://files.slack.com/thumb", true], ["https://example.com/image", false], ["https://example.com/preview", false],
  ]);
});

test("private image credentials never follow an off-host redirect", async () => {
  const headers: Record<string, string>[] = [];
  globalThis.fetch = (async (_url: unknown, init?: RequestInit) => {
    headers.push(init?.headers as Record<string, string>);
    return headers.length === 1
      ? new Response(null, { status: 302, headers: { location: "https://cdn.example.com/photo.png" } })
      : new Response(new Uint8Array([1, 2]), { headers: { "content-type": "image/png" } });
  }) as unknown as typeof fetch;
  const bytes = await downloadMessageImage({ label: "Image", private: true, url: "https://files.slack.com/private" }, async () => "xoxp-test");
  expect(bytes).toEqual(new Uint8Array([1, 2]));
  expect(headers[0].Authorization).toBe("Bearer xoxp-test");
  expect(headers[1].Authorization).toBeUndefined();
});

test("external files and lookalike hosts get no credentials", async () => {
  globalThis.fetch = (async (_url: unknown, init?: RequestInit) => {
    expect((init?.headers as Record<string, string>).Authorization).toBeUndefined();
    return new Response(new Uint8Array([1]), { headers: { "content-type": "image/png" } });
  }) as unknown as typeof fetch;
  await downloadMessageImage({ label: "Image", private: false, url: "https://files.slack.com/external" }, async () => "secret");
  await downloadMessageImage({ label: "Image", private: true, url: "https://files.slack.com.example.com/external" }, async () => "secret");
});

test("permission failures explain missing access rather than decoding HTML as an image", async () => {
  globalThis.fetch = (async () => new Response(null, { status: 403 })) as unknown as typeof fetch;
  await expect(downloadMessageImage({ label: "Image", private: true, url: "https://files.slack.com/private" }, async () => "xoxp-test"))
    .rejects.toThrow("files:read");
  globalThis.fetch = (async () => new Response("<html>Sign in</html>", { headers: { "content-type": "text/html" } })) as unknown as typeof fetch;
  await expect(downloadMessageImage({ label: "Image", private: false, url: "https://example.com/image" })).rejects.toThrow("permissions");
});

test("standard Slack emoji and skin tones render; custom names, code and URLs remain intact", () => {
  expect(renderEmoji("Great :smile: :+1::skin-tone-3: :custom-team:")).toBe("Great 😄 👍🏼 :custom-team:");
  expect(renderEmoji("`:smile:` ```\n:heart:\n``` https://example.com/:smile: :tada:"))
    .toBe("`:smile:` ```\n:heart:\n``` https://example.com/:smile: 🎉");
});
