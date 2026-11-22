# slack-tui

A Slack chat client for your terminal, written in TypeScript with
[Bun](https://bun.sh) and [OpenTUI](https://github.com/anomalyco/opentui).

Browse channels and DMs, send messages as yourself, and paste images with captions.
The interface includes user avatars, a draggable pane split, and an expandable
multiline composer.

## Getting started

Install Bun, then:

```sh
git clone https://github.com/smendola/slack-tui.git
cd slack-tui
bun install
```

Try the offline demo:

```sh
bun run demo
```

The demo uses in-memory conversations and never calls Slack.

## Connect to Slack

Each workspace uses its own Slack app registration. The setup wizard creates
that app for you; your workspace may require administrator approval.

Run setup on the same machine as your browser:

```sh
bun run setup
```

1. The wizard opens [Slack's app settings](https://api.slack.com/apps).
2. Below the app list, find **Your App Configuration Tokens**, click
   **Generate Token**, and select your workspace.
3. Copy the configuration **access token**—not the refresh token—and paste it
   into the terminal's hidden prompt.
4. The wizard creates the app and opens Slack's authorization page. Approve
   the requested permissions.
5. Your user token is verified and saved to `.env`. Start chatting:

   ```sh
   bun start
   ```

Setup uses OAuth with PKCE and a temporary localhost callback. The configuration
token is not saved. `.env` is gitignored and written with owner-only permissions.
If Slack issues expiring credentials, the client saves and refreshes them automatically.
If authorization expires and refresh is no longer possible, run setup again.

To replace an existing connection, use `bun run setup --replace`. Each setup run
creates a new app. If setup is interrupted after app creation, it prints the
app's settings URL so you can finish installation manually or delete it before
retrying. Existing credentials are replaced only after successful authorization.

### Manual setup

1. Open [Slack's app settings](https://api.slack.com/apps) and choose
   **Create New App → From a manifest**.
2. Select your workspace and paste the contents of `slack-app.yaml`.
3. Create the app, then select **OAuth & Permissions → Install to Workspace**.
4. Copy the **User OAuth Token** (`xoxp-…`), not a bot token.
5. Copy `.env.example` to `.env` and replace the placeholder with your token.
6. Run `bun start`.

## Controls

| Key / gesture | Action |
| --- | --- |
| Up / Down, then Enter | Choose and open a conversation |
| Click a conversation | Open it |
| Ctrl+D | Switch between channels/group DMs and 1:1 DMs |
| Ctrl+L | Toggle active-only / all conversations |
| Mouse wheel over sidebar | Move through conversations |
| Drag either adjoining vertical pane border | Resize sidebar and chat |
| Tab | Switch between sidebar and composer |
| Enter in composer | Send message and attached image |
| Ctrl+V in composer | Paste a clipboard image or text |
| Ctrl+G / click Remove image | Remove the attached image |
| Shift+Enter in composer | Expand the composer and insert a newline |
| Double-click composer | Expand the composer |
| Escape | Collapse the composer, keeping the draft |
| Page Up / Page Down or mouse wheel | Scroll messages |
| Ctrl+R | Refresh the current conversation |
| Ctrl+C | Quit |

Shift+Enter requires a terminal that reports modified Enter keys. Double-click
can also expand the composer. Sending collapses it unless you've edited the
draft while the send was in progress.

## Images and avatars

Focus the composer and press **Ctrl+V** to attach a clipboard image. Add an
optional caption, then press **Enter** to send both. One PNG, JPEG, WebP or GIF
up to 20 MiB can be attached at a time; pasting another image replaces it.
Text and image drafts are kept when switching conversations or when a send fails.

Clipboard access is local to the machine running slack-tui. It does not read
your laptop's clipboard when running over SSH. Terminal paste shortcuts such as
Ctrl+Shift+V generally deliver text rather than images.

Avatars appear beside message headers, with initials as a fallback. Image quality
depends on terminal graphics support; other terminals use a block-image fallback.
Incoming image attachments are currently listed by filename.

## Current limitations

- **Refresh is manual:** press Ctrl+R to fetch incoming messages.
- **Recent history only:** loads up to 50 messages per conversation.
- **Basic formatting:** resolves mentions, links and bot attachment details,
  but does not yet render styled Markdown.
- **Approximate active-only sidebar:** hides conversations Slack marks dormant
  and explicitly closed DMs. Ctrl+L reveals all loaded conversations. Activity
  metadata is loaded at startup; custom sections and muted preferences aren't synced.
- No thread navigation, reactions, search, read-state updates or persistent
  message cache yet.

If a send reports an uncertain delivery, check Slack before retrying to avoid
posting a duplicate.

## Development

```sh
bun run check
bun test
```
