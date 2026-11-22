import { afterEach, expect, test } from "bun:test";
import { clipboardImage, MAX_IMAGE_BYTES } from "./attachment";
import { Slack } from "./slack";

const originalFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = originalFetch; });
const image = clipboardImage(new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]), "image/png");

test("image upload requests a URL, uploads bytes without OAuth, then shares with caption", async () => {
  const calls: string[] = [];
  globalThis.fetch = (async (input: unknown, init?: RequestInit) => {
    const url = String(input);
    calls.push(url);
    if (url.endsWith("files.getUploadURLExternal")) {
      expect(init?.method).toBe("POST");
      const params = new URLSearchParams(init?.body as URLSearchParams);
      expect(params.get("length")).toBe(String(image.bytes.length));
      expect(params.get("filename")).toBe(image.filename);
      return Response.json({ ok: true, file_id: "F1", upload_url: "https://files.slack.com/upload/test" });
    }
    if (url === "https://files.slack.com/upload/test") {
      expect((init?.headers as Record<string, string>).Authorization).toBeUndefined();
      expect(init?.body).toEqual(new Uint8Array(image.bytes));
      expect(init?.redirect).toBe("error");
      return new Response("OK");
    }
    expect(url).toEndWith("files.completeUploadExternal");
    const params = new URLSearchParams(init?.body as URLSearchParams);
    expect(params.get("channel_id")).toBe("D1");
    expect(params.get("initial_comment")).toBe("Screenshot\nDetails");
    expect(JSON.parse(params.get("files")!)).toEqual([{ id: "F1", title: image.filename }]);
    return Response.json({ ok: true });
  }) as unknown as typeof fetch;
  const result = await new Slack("xoxp-test").send("D1", "Screenshot\nDetails", image);
  expect(calls.length).toBe(3);
  expect(calls.some(url => url.includes("chat.postMessage"))).toBe(false);
  expect(result.files?.[0].name).toBe(image.filename);
});

test("failed byte upload is not finalized", async () => {
  let calls = 0;
  globalThis.fetch = (async () => {
    calls++;
    return calls === 1
      ? Response.json({ ok: true, file_id: "F1", upload_url: "https://files.slack.com/upload/test" })
      : new Response("failure", { status: 500 });
  }) as unknown as typeof fetch;
  await expect(new Slack("xoxp-test").send("C1", "", image)).rejects.toThrow("HTTP 500");
  expect(calls).toBe(2);
});

test("missing file permission is surfaced before uploading", async () => {
  globalThis.fetch = (async () => Response.json({ ok: false, error: "missing_scope", needed: "files:write" })) as unknown as typeof fetch;
  await expect(new Slack("xoxp-test").send("C1", "", image)).rejects.toThrow("files:write");
});

test("clipboard rejects unsupported, mismatched and oversized image data", () => {
  expect(() => clipboardImage(new Uint8Array([1, 2]), "image/png")).toThrow("supported");
  expect(() => clipboardImage(image.bytes, "text/plain")).toThrow("supported");
  expect(() => clipboardImage(new Uint8Array(MAX_IMAGE_BYTES + 1), "image/png")).toThrow("20 MiB");
});
