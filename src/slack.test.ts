import { afterEach, expect, test } from "bun:test";
import { Slack, displayText, messageText, channelName, compactName, isSidebarActive } from "./slack";

const originalFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = originalFetch; });

test("external DM participants missing from the directory get a profile lookup", async () => {
  globalThis.fetch = (async (input: unknown) => {
    const url = new URL(String(input));
    if (url.pathname.endsWith("users.info")) {
      expect(url.searchParams.get("user")).toBe("UEXTERNAL");
      return Response.json({ ok: true, user: { id: "UEXTERNAL", name: "vlad", profile: { real_name: "Vladimir K", display_name: "" } } });
    }
    return Response.json({ ok: true, channels: [{ id: "D1", is_im: true, user: "UEXTERNAL" }] });
  }) as unknown as typeof fetch;
  const client = new Slack("xoxp-test");
  const channels = await client.channels();
  expect(channelName(channels[0], client.users)).toBe("@ Vladimir K");
});

test("attachment-only build messages render details and links without duplicate fallback", () => {
  const text = messageText({
    ts: "1", text: "", attachments: [{
      pretext: "Build finished", text: "Successful &amp; deployed",
      fallback: "Duplicate notification", fields: [{ title: "Branch", value: "main" }],
      actions: [{ text: "View build", url: "https://example.com/build" }],
      footer: "Codemagic",
    }],
  }, new Map());
  expect(text).toBe("Build finished\nSuccessful & deployed\nBranch: main\nView build (https://example.com/build)\nCodemagic");
});

test("attachment fallback and supplemental attachments preserve ordinary message text", () => {
  expect(messageText({ ts: "1", text: "Message", attachments: [{ fallback: "Details" }] }, new Map()))
    .toBe("Message\n\nDetails");
});

test("sidebar hides dormant and explicitly closed DMs but keeps unknown state", () => {
  expect(isSidebarActive({ id: "C1", properties: { is_dormant: true } })).toBe(false);
  expect(isSidebarActive({ id: "G1", is_mpim: true, is_open: false })).toBe(false);
  expect(isSidebarActive({ id: "D1", is_im: true, is_open: false })).toBe(false);
  expect(isSidebarActive({ id: "C1" })).toBe(true);
  expect(isSidebarActive({ id: "D1", is_im: true, properties: { is_dormant: false } })).toBe(true);
});

test("group DM labels prefer custom names, otherwise resolve generated usernames", () => {
  const users = new Map([["alice", "Alice A"], ["bob-smith", "Bob Smith"]]);
  expect(channelName({ id: "G1", is_mpim: true, name: "mpdm-alice--bob-smith--unknown-1" }, users))
    .toBe("Alice A., Bob S., unknown");
  expect(channelName({ id: "G1", is_mpim: true, name: "Launch team" }, users)).toBe("Launch team");
  expect(channelName({
    id: "G1", is_mpim: true, name: "mpdm-custom-team", properties: { has_custom_mpdm_name: true },
  }, users)).toBe("mpdm-custom-team");
  expect(channelName({ id: "G1", is_mpim: true }, users)).toBe("Group conversation");
  expect(channelName({ id: "C1", name: "mpdm-normal-channel" }, users)).toBe("# mpdm-normal-channel");
});

test("compact participant names keep first name and final surname initial", () => {
  expect(compactName("Jane Smith")).toBe("Jane S.");
  expect(compactName("Mary Jane Watson")).toBe("Mary W.");
  expect(compactName("Prince")).toBe("Prince");
  expect(compactName("  José   Álvarez ")).toBe("José Á.");
});

test("conversation pagination uses the user token and follows cursors", async () => {
  const requests: Record<string, unknown>[] = [];
  globalThis.fetch = (async (_url: unknown, init?: RequestInit) => {
    expect((init?.headers as Record<string, string>).Authorization).toBe("Bearer xoxp-test");
    expect(init?.method).toBe("GET");
    expect(init?.body).toBeUndefined();
    requests.push(Object.fromEntries(new URL(String(_url)).searchParams));
    return Response.json({
      ok: true, channels: [{ id: requests.length === 1 ? "C1" : "C2" }],
      response_metadata: { next_cursor: requests.length === 1 ? "next" : "" },
    });
  }) as unknown as typeof fetch;
  expect((await new Slack("xoxp-test").channels()).map(channel => channel.id)).toEqual(["C1", "C2"]);
  expect(requests[1].cursor).toBe("next");
  expect(requests[0].types).toBe("public_channel,private_channel,im,mpim");
});

test("rate limiting blocks repeat history requests without retrying sends", async () => {
  let calls = 0;
  globalThis.fetch = (async () => {
    calls++;
    return new Response("", { status: 429, headers: { "Retry-After": "60" } });
  }) as unknown as typeof fetch;
  const client = new Slack("xoxp-test");
  await expect(client.history("C1")).rejects.toThrow("Rate limited");
  await expect(client.history("C2")).rejects.toThrow("Rate limited");
  expect(calls).toBe(1);
});

test("Slack logical errors are surfaced even on HTTP 200", async () => {
  globalThis.fetch = (async () => Response.json({ ok: false, error: "missing_scope", needed: "chat:write" })) as unknown as typeof fetch;
  await expect(new Slack("xoxp-test").send("C1", "hello")).rejects.toThrow("missing_scope (needs chat:write)");
});

test("message display resolves Slack syntax and removes terminal controls", () => {
  expect(displayText("<@U1> &amp; <https://example.com|site>\x1b", new Map([["U1", "Alice"]])))
    .toBe("@Alice & site (https://example.com)");
});
