# slack-tui

A tiny Bun + OpenTUI Slack client: conversations on the left, recent messages
and an expandable composer on the right. Uses your own Slack **user** OAuth token.

## Try it without Slack

```sh
bun install
bun run demo
```

The offline demo uses in-memory data and never calls Slack.

## Connect your workspace

1. Open https://api.slack.com/apps and choose **Create New App → From a manifest**.
2. Select your workspace and paste the contents of `slack-app.yaml`.
3. Create the app, then open **OAuth & Permissions → Install to Workspace**.
   Your workspace may require an administrator's approval.
4. Copy the **User OAuth Token** (`xoxp-…`), not a bot token.
5. Copy `.env.example` to `.env` and replace the placeholder with your token.
6. Run `bun start`. Bun loads `.env` automatically.

The token remains local and `.env` is gitignored. Each person using a different
workspace should create their own app registration. This POC doesn't need a
server, Socket Mode, a bot, or a public OAuth callback.

## Controls

| Key | Action |
| --- | --- |
| Up / Down, then Enter | Choose and open a conversation |
| Left click a conversation | Open it |
| Ctrl+D | Switch sidebar between channels and 1:1 direct messages |
| Ctrl+L | Toggle active-only / all conversations |
| Mouse wheel over sidebar | Move through conversations |
| Drag the divider between panes | Resize sidebar and chat |
| Tab | Switch between sidebar and composer |
| Enter in composer | Send as yourself |
| Shift+Enter in composer | Expand to the chat pane and insert a newline |
| Double-click composer | Expand to the chat pane |
| Escape | Collapse composer, keeping the draft |
| Page Up / Page Down or mouse wheel | Scroll messages |
| Ctrl+R | Refresh the current conversation |
| Ctrl+C | Quit |

## Deliberately small scope

- Lists joined channels, private channels and existing DMs/group DMs.
- Loads the latest 50 messages (Slack may return fewer).
- Sends plain text, including Slack formatting syntax.
- Resolves user mentions and common Slack link syntax for display.
- Labels group DMs with their custom Slack name, or participant display names.
- Displays legacy bot attachment text, fields and links (including Codemagic builds).
- Preserves drafts when switching conversations and when a send fails.
- Shows API errors and respects Slack's `Retry-After` response.

Incoming messages require **Ctrl+R**; there is no background polling.
Shift+Enter requires a terminal that reports modified Enter keys. Double-click
expands the editor independently of that keyboard support. Sending collapses
the editor when the sent draft has not been edited while sending.
The sidebar defaults to an approximate active-only view: Slack's dormant flag
and explicitly closed DMs are hidden. Missing metadata stays visible, as does
the currently open conversation. Ctrl+L reveals all loaded conversations.
This does not synchronize Slack GUI filters, muted channels or custom sections;
activity metadata is loaded at startup.
Message formatting is currently readable text, not styled Markdown.
No images, thread navigation, older-history pagination, reactions, search,
read-state updates or persistent cache yet. Attachments are shown by filename.

## Development

```sh
bun run check
bun test
```
