import { get } from "node-emoji";

const aliases: Record<string, string> = { slightly_smiling_face: "slightly_smiling_face", simple_smile: "slightly_smiling_face" };

export function renderEmoji(text: string) {
  // Preserve code and URLs verbatim. Unknown workspace emoji stay readable.
  return text.split(/(```[\s\S]*?```|`[^`\n]*`|https?:\/\/[^\s<>]+)/g).map((part, index) => {
    if (index % 2) return part;
    return part.replace(/:([a-zA-Z0-9_+-]+):/g, (match, name: string) => {
      const tone = name.match(/^skin-tone-([2-6])$/);
      if (tone) return String.fromCodePoint(0x1f3fb + Number(tone[1]) - 2);
      return get(aliases[name] ?? name) ?? match;
    });
  }).join("");
}
