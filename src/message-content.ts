import { StyledText, fg, link, underline, type TextChunk } from "@opentui/core";
import { displayText, messageSource, type Message } from "./slack";
import { renderEmoji } from "./emoji";

function linkTarget(raw: string) {
  const decoded = raw.replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">");
  if (/[\x00-\x20\x7f-\x9f]/.test(decoded)) return undefined;
  try {
    const url = new URL(decoded);
    if (url.protocol !== "https:" && url.protocol !== "http:") return undefined;
    // Asana's Slack previews wrap task URLs in tracking links that exceed
    // OpenTUI's 512-byte native hyperlink limit. Use their same-site destination.
    if (url.origin === "https://app.asana.com" && url.pathname === "/app/asana/-/log") {
      const dest = url.searchParams.get("dest");
      if (dest) {
        const target = new URL(dest);
        if (target.origin === url.origin) return target.href;
      }
    }
    return url.href;
  } catch {
    return undefined;
  }
}

export function messageContent(message: Message, users: Map<string, string>, suffix = "") {
  const source = messageSource(message);
  const chunks: TextChunk[] = [];
  const plain = (text: string) => {
    if (text) chunks.push({ __isChunk: true, text: renderEmoji(displayText(text, users)) });
  };
  // Keep code intact while interpreting Slack's <url|label> and <url> forms.
  const tokens = /```[\s\S]*?```|`[^`\n]*`|<(https?:\/\/[^>|]+)(?:\|([^>]+))?>/g;
  let offset = 0;
  for (const match of source.matchAll(tokens)) {
    plain(source.slice(offset, match.index));
    if (!match[1]) {
      chunks.push({ __isChunk: true, text: displayText(match[0], users) });
    } else {
      const label = renderEmoji(displayText(match[2] ?? match[1], users));
      const target = linkTarget(match[1]);
      chunks.push(target
        ? link(target)(underline(fg("#9ccfd8")(label)))
        : { __isChunk: true, text: label });
    }
    offset = match.index! + match[0].length;
  }
  plain(source.slice(offset));
  if (suffix) chunks.push({ __isChunk: true, text: suffix });
  return new StyledText(chunks);
}
