import { afterEach, expect, test } from "bun:test";
import { AvatarCache } from "./avatars";

const originalFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = originalFetch; });

test("avatar requests are shared and never carry Slack authorization", async () => {
  let calls = 0;
  globalThis.fetch = (async (_url: unknown, init?: RequestInit) => {
    calls++;
    expect(init?.headers).toBeUndefined();
    return new Response(new Uint8Array([1, 2, 3]));
  }) as unknown as typeof fetch;
  const cache = new AvatarCache();
  const [a, b] = await Promise.all([cache.get("https://example.com/avatar.png"), cache.get("https://example.com/avatar.png")]);
  expect(a).toEqual(new Uint8Array([1, 2, 3]));
  expect(a).toBe(b);
  expect(calls).toBe(1);
});

test("failed or oversized avatars fall back without breaking the message", async () => {
  const cache = new AvatarCache();
  globalThis.fetch = (async () => new Response("", { status: 404 })) as unknown as typeof fetch;
  expect(await cache.get("https://example.com/missing")).toBeUndefined();
  globalThis.fetch = (async () => new Response(new Uint8Array(1024 * 1024 + 1))) as unknown as typeof fetch;
  expect(await cache.get("https://example.com/oversized")).toBeUndefined();
  expect(await cache.get("file:///private")).toBeUndefined();
});
