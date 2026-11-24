import { BoxRenderable, TextRenderable, SyntaxStyle, type TextareaRenderable, type RenderContext, type KeyEvent } from "@opentui/core";

export function mentionQuery(text: string, cursor: number) {
  const match = /(?:^|[\s(])@([\p{L}\p{N}_.-]*)$/u.exec(text.slice(0, cursor));
  return match ? { start: cursor - match[1]!.length - 1, end: cursor, query: match[1]! } : undefined;
}

export function mentionMatches(users: Map<string, string>, query: string) {
  const needle = query.toLocaleLowerCase();
  return [...users].filter(([id, name]) => /^[UW][A-Z0-9]+$/.test(id) && name.toLocaleLowerCase().includes(needle))
    .sort((a, b) => Number(!a[1].toLocaleLowerCase().startsWith(needle)) - Number(!b[1].toLocaleLowerCase().startsWith(needle))
      || a[1].localeCompare(b[1]) || a[0].localeCompare(b[0]));
}

export function createMentionPicker(context: RenderContext, parent: BoxRenderable, composer: TextareaRenderable,
  users: Map<string, string>) {
  const box = new BoxRenderable(context, {
    visible: false, width: "100%", flexShrink: 0, backgroundColor: "#272735FF",
  });
  parent.add(box, parent.getChildren().indexOf(composer));
  let active: ReturnType<typeof mentionQuery>;
  let matches: [string, string][] = [];
  let selected = 0;
  let signature = "";
  let dismissed = "";
  let inserting = false;
  const mentionStyle = SyntaxStyle.fromStyles({ mention: { fg: "#9ccfd8" } }, context.nativeScene);
  composer.syntaxStyle = mentionStyle;
  composer.on("destroy", () => mentionStyle.destroy());
  const mentionType = composer.extmarks.registerType("slack-mention");
  function mark(start: number, end: number, id: string) {
    composer.extmarks.create({
      start: composer.editBuffer.stringIndexToCellOffset(start),
      end: composer.editBuffer.stringIndexToCellOffset(end),
      virtual: true, typeId: mentionType, styleId: mentionStyle.getStyleId("mention")!, data: { id },
    });
  }
  const hide = () => { box.visible = false; active = undefined; };
  function accept(index: number) {
    if (!active || !matches[index]) return;
    const range = active;
    const id = matches[index]![0];
    const separator = /^\s/.test(composer.plainText.slice(range.end)) ? "" : " ";
    inserting = true;
    hide();
    composer.setSelection(composer.editBuffer.stringIndexToCellOffset(range.start),
      composer.editBuffer.stringIndexToCellOffset(range.end));
    const label = `@${matches[index]![1]}`;
    composer.insertText(`${label}${separator}`);
    mark(range.start, range.start + label.length, id);
    composer.focus();
    inserting = false;
  }
  function draw() {
    for (const child of [...box.getChildren()]) child.destroyRecursively();
    box.add(new TextRenderable(context, {
      content: "Mention · ↑↓ choose · Enter/Tab insert · Esc close", fg: "#908caa", selectable: false,
    }));
    const first = Math.max(0, selected - 4);
    for (let index = first; index < Math.min(matches.length, first + 5); index++) {
      const [id, name] = matches[index]!;
      box.add(new TextRenderable(context, {
        content: ` ${index === selected ? "›" : " "} @${name} · ${id}`,
        height: 1, selectable: false, fg: "#e0def4",
        bg: index === selected ? "#505064FF" : "#272735FF",
        onMouseDown(event) {
          if (event.button !== 0) return;
          event.stopPropagation();
          accept(index);
        },
      }));
    }
  }
  function refresh() {
    if (inserting) return;
    if (!composer.focused || composer.hasSelection()) { hide(); return; }
    const text = composer.plainText;
    const cursor = composer.editBuffer.cellOffsetToStringIndex(composer.cursorOffset);
    const query = mentionQuery(text, cursor);
    const next = JSON.stringify([text, cursor]);
    if (next !== signature) { selected = 0; dismissed = ""; }
    signature = next;
    if (!query || dismissed === next) { hide(); return; }
    matches = mentionMatches(users, query.query);
    if (!matches.length) { hide(); return; }
    active = query;
    box.visible = true;
    draw();
  }
  const schedule = () => queueMicrotask(refresh);
  composer.editBuffer.on("content-changed", schedule);
  composer.editBuffer.on("cursor-changed", schedule);
  composer.on("blur", hide);
  return {
    serialize() {
      let text = composer.plainText;
      for (const token of composer.extmarks.getAllForTypeId(mentionType).sort((a, b) => b.start - a.start)) {
        const start = composer.editBuffer.cellOffsetToStringIndex(token.start);
        const end = composer.editBuffer.cellOffsetToStringIndex(token.end);
        text = text.slice(0, start) + `<@${token.data.id}>` + text.slice(end);
      }
      return text;
    },
    restoreLabels() {
      inserting = true;
      composer.extmarks.clear();
      const tokens = [...composer.plainText.matchAll(/<@([UW][A-Z0-9]+)>/g)];
      for (const token of tokens.reverse()) {
        const id = token[1]!;
        const name = users.get(id);
        if (!name) continue;
        const start = token.index!;
        composer.setSelection(composer.editBuffer.stringIndexToCellOffset(start),
          composer.editBuffer.stringIndexToCellOffset(start + token[0].length));
        composer.insertText(`@${name}`);
        mark(start, start + name.length + 1, id);
      }
      composer.cursorOffset = composer.editBuffer.stringIndexToCellOffset(composer.plainText.length);
      inserting = false;
      hide();
    },
    key(key: KeyEvent) {
      if (!composer.focused || !box.visible || !active || key.ctrl || key.meta || key.shift) return false;
      if (!["up", "down", "return", "enter", "tab", "escape"].includes(key.name)) return false;
      key.preventDefault();
      if (key.name === "escape") { dismissed = signature; hide(); }
      else if (key.name === "up" || key.name === "down") {
        selected = (selected + (key.name === "up" ? -1 : 1) + matches.length) % matches.length;
        draw();
      } else accept(selected);
      return true;
    },
  };
}
