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
   into the terminal's masked prompt.
4. The wizard creates the app and opens Slack's authorization page. Approve
   the requested permissions.
5. Your user token is verified and saved to
   `~/.config/slack-tui/credentials.env`. Start chatting:

   ```sh
   bun start
   ```

Setup uses OAuth with PKCE and a temporary localhost callback. The configuration
token is not saved. Credentials are written with owner-only permissions outside
the project directory. `XDG_CONFIG_HOME` overrides the default `~/.config` directory.
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
5. Create `~/.config/slack-tui/credentials.env` (or
   `$XDG_CONFIG_HOME/slack-tui/credentials.env`) using `.env.example` as a template,
   replace the placeholder with your token, and restrict permissions with `chmod 600`.
6. Run `bun start`.

Existing project-local `.env` credentials migrate automatically on startup.
Only Slack credential entries are removed from the old file; unrelated settings
are preserved. The demo does not load or migrate credentials.

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
| Ctrl+R | Refresh the current conversation, unread status and DM presence |
| Ctrl+C | Quit |
| F2 | Open / close settings |

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
Images shared in messages appear beneath the text, including image previews
from bot attachments. Slack-hosted images require the `files:read` permission
included in the app manifest. Images that cannot be loaded remain labeled.

Standard emoji shortcodes such as `:smile:` and `:+1:` render as Unicode emoji,
including skin-tone modifiers. Reaction counts appear below messages.
Workspace-specific custom emoji retain their shortcode names. Emoji appearance
depends on your terminal's font.

## Settings

Press **F2** to open settings. Click **Show profile photos**, or press Space /
Enter, to switch between Yes and No. Changes apply and save immediately.
**Escape**, **F2**, or **Back to chat** returns to your conversation.

Photos default to Yes. Turning them off removes the avatar column, giving the
message text more room. Image attachments are unaffected.

Settings are stored as a small JSON file at
`~/.config/slack-tui/settings.json`, or
`$XDG_CONFIG_HOME/slack-tui/settings.json` when that variable is set.
They apply across workspaces and persist between runs.

## DM presence

The DM sidebar shows **●** in green for active users, **○** for away, and **·**
when presence is unknown. These reflect Slack's active/away status, including
manually setting yourself away.

Presence is checked at startup, when switching to DMs, and with **Ctrl+R**.
Checks run gradually in the background; they are snapshots, not live updates.
The existing `users:read` permission covers presence—no extra scopes are needed.

## Unread status

Unread conversations appear in **bold**. Status is checked in the background at
startup and with **Ctrl+R**, prioritizing the visible sidebar. Slack requires
per-conversation lookups, so a large workspace can take several minutes to check.
If Slack rate-limits the check, the status line reports it; use Ctrl+R to retry.

Opening or refreshing a conversation marks it read in Slack through the newest
loaded message. If that update fails, messages remain visible and the status line
explains the failure; Ctrl+R retries.

Read updates require `channels:write`, `groups:write`, `im:write`, and `mpim:write`
under **OAuth & Permissions → User Token Scopes**. The app manifest includes these.
For an existing installation, add the scopes and reinstall/reauthorize the app,
then update your saved credentials if Slack issues a new token. Until authorized,
unread styling clears locally for this session only.

## Current limitations

- **Refresh is manual:** press Ctrl+R to fetch incoming messages.
- **Recent history only:** loads up to 50 messages per conversation.
- **Basic formatting:** resolves mentions, links and bot attachment details,
  but does not yet render styled Markdown.
- **Approximate active-only sidebar:** hides conversations Slack marks dormant
  and explicitly closed DMs. Ctrl+L reveals all loaded conversations. Activity
  metadata is loaded at startup; custom sections and muted preferences aren't synced.
- No thread navigation, adding/removing reactions, search or persistent
  message cache yet.

If a send reports an uncertain delivery, check Slack before retrying to avoid
posting a duplicate.

## Development

```sh
bun run check
bun test
```
