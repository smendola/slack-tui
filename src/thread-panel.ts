import { BoxRenderable, ImageRenderable, ScrollBoxRenderable, TextRenderable, TextareaRenderable,
  type CliRenderer, type KeyEvent } from "@opentui/core";
import { type Chat, type Message } from "./slack";
import { type ImageAttachment } from "./attachment";
import { type LiveEvent, eventChannel } from "./live";
import { applyThreadEvent, summarizeThread } from "./threads";
import { createMentionPicker } from "./mentions";
import { restoreDraft } from "./drafts";
import { button } from "./button";

type Target = { channel: string; ts: string; name: string };
type Draft = { text: string; image?: ImageAttachment };

export class ThreadPanel {
  readonly pane: BoxRenderable;
  readonly scroll: ScrollBoxRenderable;
  readonly composer: TextareaRenderable;
  readonly messages: BoxRenderable;
  private title: TextRenderable;
  private attachment: BoxRenderable;
  private preview: ImageRenderable;
  private imageLabel: TextRenderable;
  private mentions: ReturnType<typeof createMentionPicker>;
  private drafts = new Map<string, Draft>();
  private target?: Target;
  private image?: ImageAttachment;
  private request = 0;
  private journal?: LiveEvent[];
  private timer?: ReturnType<typeof setTimeout>;
  private disposed = false;
  private loaded = false;
  private expanded = false;
  items: Message[] = [];
  sending = false;
  get open() { return !!this.target; }
  get channel() { return this.target?.channel; }
  get rootTs() { return this.target?.ts; }
  get key() { return this.target ? JSON.stringify([this.target.channel, this.target.ts]) : ""; }

  constructor(private renderer: CliRenderer, private chat: Chat, private callbacks: {
    render(messages: Message[], container: BoxRenderable): void;
    report(message: string): void;
    layout(): void;
    closed(): void;
    canRender(): boolean;
    summary(channel: string, parent: Message): void;
  }) {
    this.pane = new BoxRenderable(renderer, {
      visible: false, flexDirection: "column", flexShrink: 0, minWidth: 0, minHeight: 0,
      border: true, borderColor: "#524f67",
    });
    const header = new BoxRenderable(renderer, {
      height: 1, flexShrink: 0, flexDirection: "row", backgroundColor: "#272735FF",
    });
    this.title = new TextRenderable(renderer, { content: "Thread", flexGrow: 1, minWidth: 0, fg: "#9ccfd8" });
    header.add(this.title);
    header.add(button(renderer, "×", () => this.close(), { background: "#272735FF", foreground: "#e0def4" }));
    this.pane.add(header);
    this.scroll = new ScrollBoxRenderable(renderer, {
      flexGrow: 1, minHeight: 0, scrollX: false, stickyScroll: true, stickyStart: "bottom",
    });
    this.messages = new BoxRenderable(renderer, { width: "100%", flexShrink: 0 });
    this.scroll.add(this.messages);
    this.pane.add(this.scroll);
    const compose = new BoxRenderable(renderer, {
      flexShrink: 0, width: "100%", border: ["top"], borderColor: "#524f67",
    });
    this.pane.add(compose);
    this.attachment = new BoxRenderable(renderer, { visible: false, height: 5, flexDirection: "row", flexShrink: 0 });
    this.preview = new ImageRenderable(renderer, { width: 10, height: 4, fit: "fit" });
    this.attachment.add(this.preview);
    const detail = new BoxRenderable(renderer, { flexGrow: 1, minWidth: 0 });
    this.imageLabel = new TextRenderable(renderer, { fg: "#908caa", wrapMode: "word", flexShrink: 0 });
    detail.add(this.imageLabel);
    detail.add(button(renderer, "Remove image", () => this.attach(undefined)));
    this.attachment.add(detail);
    compose.add(this.attachment);
    this.composer = new TextareaRenderable(renderer, {
      width: "100%", height: 1, flexShrink: 0, placeholder: "Reply to thread…",
      backgroundColor: "#191724", focusedBackgroundColor: "#191724",
      keyBindings: [{ name: "return", action: "submit" }],
      onSubmit: () => { void this.send(); },
    });
    compose.add(this.composer);
    this.mentions = createMentionPicker(renderer, compose, this.composer, chat.users);
  }
  setNarrow(narrow: boolean) {
    this.title.content = `${narrow ? "← Back · " : ""}Thread · ${this.target?.name ?? ""}`;
    this.title.onMouseDown = event => {
      if (narrow && event.button === 0) { event.stopPropagation(); this.close(); }
    };
  }
  private saveDraft() {
    if (this.target) this.drafts.set(this.key, { text: this.mentions.serialize(), image: this.image });
  }
  async show(channel: string, message: Message, name: string) {
    const ts = message.thread_ts ?? message.ts;
    if (this.target?.channel === channel && this.target.ts === ts) { this.composer.focus(); return; }
    this.saveDraft();
    this.target = { channel, ts, name };
    this.loaded = false;
    const draft = this.drafts.get(this.key);
    restoreDraft(this.composer, draft?.text ?? "");
    this.mentions.restoreLabels();
    this.attach(draft?.image);
    this.setExpanded(!!draft?.text.includes("\n"));
    this.items = message.ts === ts ? [message] : [];
    this.pane.visible = true;
    this.draw(true);
    this.callbacks.layout();
    queueMicrotask(() => { if (this.open) this.composer.focus(); });
    await this.refresh(true);
  }
  close() {
    if (!this.open) return;
    this.saveDraft();
    this.target = undefined;
    this.request++;
    this.journal = undefined;
    this.pane.visible = false;
    this.callbacks.layout();
    this.callbacks.closed();
  }
  async refresh(bottom = false) {
    if (!this.target) return;
    const target = this.target;
    const request = ++this.request;
    const journal: LiveEvent[] = [];
    this.journal = journal;
    this.callbacks.report("Loading thread…");
    try {
      let items = await this.chat.replies(target.channel, target.ts);
      if (this.disposed || request !== this.request) return;
      for (const event of journal) items = applyThreadEvent(items, target.ts, event);
      this.items = items;
      this.loaded = true;
      this.summary();
      if (this.callbacks.canRender()) this.draw(bottom);
      else this.scheduleDraw();
      this.callbacks.report(`${Math.max(0, items.length - 1)} thread replies`);
    } catch (error) {
      if (request === this.request && !this.disposed) this.callbacks.report(`Thread: ${String(error)} · Ctrl+R retries`);
    } finally { if (request === this.request) this.journal = undefined; }
  }
  private summary() {
    if (!this.loaded) return;
    const parent = this.items.find(message => message.ts === this.target?.ts);
    if (parent && this.target) this.callbacks.summary(this.target.channel, summarizeThread(parent, this.items));
  }
  receive(event: LiveEvent) {
    if (!this.target || eventChannel(event) !== this.target.channel) return;
    this.journal?.push(event);
    const next = applyThreadEvent(this.items, this.target.ts, event);
    if (next === this.items) return;
    this.items = next;
    if ((event.thread_ts === this.target.ts && event.ts !== this.target.ts)
      || event.subtype === "message_deleted") this.summary();
    this.scheduleDraw();
  }
  private scheduleDraw() {
    if (this.timer || !this.open || this.disposed) return;
    this.timer = setTimeout(() => {
      this.timer = undefined;
      if (!this.open || this.disposed) return;
      if (!this.callbacks.canRender()) { this.scheduleDraw(); return; }
      this.draw();
    }, 100);
  }
  draw(bottom = false) {
    const top = this.scroll.scrollTop;
    const atBottom = top + this.scroll.viewport.height >= this.scroll.scrollHeight - 1;
    for (const child of [...this.messages.getChildren()]) child.destroyRecursively();
    this.callbacks.render(this.items, this.messages);
    this.scroll.scrollTo(bottom || atBottom ? Infinity : top);
  }
  update(message: Message) {
    this.journal?.push({ type: "message", subtype: "message_changed", message });
    this.items = this.items.map(item => item.ts === message.ts ? { ...item, ...message } : item);
    this.draw();
  }
  attach(image?: ImageAttachment) {
    this.image = image;
    this.attachment.visible = !!image;
    this.preview.source = image?.bytes;
    this.imageLabel.content = image?.filename ?? "";
  }
  insertText(text: string) {
    if (text.includes("\n")) this.setExpanded(true);
    this.composer.insertText(text);
  }
  private setExpanded(expanded: boolean) {
    this.expanded = expanded;
    this.composer.height = expanded ? Math.max(2, Math.min(5, Math.floor(this.renderer.height / 4))) : 1;
  }
  handleKey(key: KeyEvent) {
    if (!this.open) return false;
    if (this.mentions.key(key)) return true;
    if (this.composer.focused && key.shift && ["return", "enter"].includes(key.name)) {
      key.preventDefault(); this.setExpanded(true); this.composer.newLine(); return true;
    }
    if (key.name === "escape") {
      key.preventDefault();
      if (this.composer.focused && this.expanded) this.setExpanded(false);
      else this.close();
      return true;
    }
    return false;
  }
  async send() {
    if (!this.target || this.sending) return;
    const target = this.target, key = this.key;
    const original = this.mentions.serialize();
    const image = this.image;
    if (!original.trim() && !image) return;
    this.sending = true;
    this.callbacks.report(image ? "Uploading thread attachment…" : "Sending reply…");
    try {
      const sent = await this.chat.send(target.channel, original.trim(), image, target.ts);
      if (this.disposed) return;
      if (this.key === key) {
        if (this.mentions.serialize() === original) { restoreDraft(this.composer, ""); this.setExpanded(false); }
        if (this.image === image) this.attach(undefined);
        this.saveDraft();
        const event: LiveEvent = { ...sent, type: "message", thread_ts: target.ts };
        this.journal?.push(event);
        this.items = applyThreadEvent(this.items, target.ts, event);
        this.summary();
        this.draw(true);
        if (image) void this.refresh(true);
      } else {
        const draft = this.drafts.get(key);
        if (draft?.text === original && draft.image === image) this.drafts.delete(key);
      }
      this.callbacks.report("Reply sent");
    } catch (error) { if (!this.disposed) this.callbacks.report(`Reply not sent: ${String(error)} · Draft kept`); }
    finally { this.sending = false; }
  }
  dispose() {
    this.disposed = true;
    this.request++;
    if (this.timer) clearTimeout(this.timer);
    this.drafts.clear();
  }
}
