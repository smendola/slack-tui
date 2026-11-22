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

### Automated app creation and OAuth

Run this on the same machine as your browser:

```sh
bun run setup
```

The wizard:

1. Opens Slack's app settings. Under **Your App Configuration Tokens**, generate
   an **access token** for your workspace and paste it into the hidden prompt.
   This is a configuration token, not the refresh token or a chat user token.
2. Starts a callback listener bound to loopback on a randomly allocated port.
3. Creates your own Slack app using `slack-app.yaml`, enabling PKCE and registering
   `http://localhost:PORT/oauth/callback` as the redirect URL.
4. Opens Slack's authorization page so you can approve the requested user permissions.
5. Exchanges the authorization code, verifies the resulting user token and scopes,
   and saves it in `.env` with owner-only permissions. Other `.env` settings are preserved.
6. Stops the callback server. Run `bun start`.

No Cloudflare, Tailscale, custom domain, HTTPS server or public tunnel is needed.
[Slack's PKCE flow](https://docs.slack.dev/authentication/using-pkce/) allows HTTP
localhost redirects for desktop clients requesting user scopes.
The configuration token and PKCE verifier stay in memory. The app client secret
is neither used nor saved. State validation and PKCE protect the OAuth callback.
The wizard does not serve local files or expose the chat client.

If Slack issues an expiring user token, its refresh token, expiry and client ID
are also saved in `.env`. The client refreshes before expiry during use and
persists replacement credentials. Slack's PKCE refresh tokens expire after
30 days; if refresh is no longer possible, run setup again.

An existing connection is left alone unless you run `bun run setup --replace`.
Each run creates a new app. If authorization is cancelled, times out (15 minutes),
or requires administrator approval, the created app remains in Slack; the wizard
prints its settings URL for manual installation or deletion. Existing credentials
are replaced only after successful authorization and verification.

### Manual installation

1. Open https://api.slack.com/apps and choose **Create New App → From a manifest**.
2. Select your workspace and paste the contents of `slack-app.yaml`.
3. Create the app, then open **OAuth & Permissions → Install to Workspace**.
   Your workspace may require an administrator's approval.
4. Copy the **User OAuth Token** (`xoxp-…`), not a bot token.
5. Copy `.env.example` to `.env` and replace the placeholder with your token.
6. Run `bun start`. Bun loads `.env` automatically.

The token remains local and `.env` is gitignored. Each person using a different
workspace should create their own app registration. Normal chat use needs no
server, Socket Mode, or bot. Only the automated setup temporarily runs an OAuth callback.

## Controls

| Key | Action |
| --- | --- |
| Up / Down, then Enter | Choose and open a conversation |
| Left click a conversation | Open it |
| Ctrl+D | Switch sidebar between channels and 1:1 direct messages |
| Ctrl+L | Toggle active-only / all conversations |
| Mouse wheel over sidebar | Move through conversations |
| Drag either adjoining vertical pane border | Resize sidebar and chat |
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
