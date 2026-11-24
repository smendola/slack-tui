# slack-tui

A Slack chat client for your terminal, written in TypeScript with
[Bun](https://bun.sh) and [OpenTUI](https://github.com/anomalyco/opentui).

Browse channels and DMs, receive live updates, send messages as yourself, and paste images with captions.
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
One wizard authorizes your Slack user and connects live events using an
app-level token.

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
   `~/.config/slack-tui/credentials.env`.
6. The wizard opens the new app's settings and asks for an app-level token.
   Under **Basic Information → App-Level Tokens**, generate a token with the
   **`connections:write`** scope.
7. Paste that `xapp-…` token into the wizard's masked prompt. Socket Mode and
   event subscriptions are already enabled; the wizard verifies the WebSocket
   connection and saves the token.
8. Start chatting:

   ```sh
   bun start
   ```

   The title shows **LIVE** once connected. New messages arrive automatically.

Setup uses OAuth with PKCE and a temporary localhost callback. The configuration
token is not saved. Credentials are written with owner-only permissions outside
the project directory. `XDG_CONFIG_HOME` overrides the default `~/.config` directory.
If Slack issues expiring credentials, the client saves and refreshes them automatically.
If authorization expires and refresh is no longer possible, reconnect with
`bun run setup --replace`.

### Setup options and recovery

- **`bun run setup`** — complete setup, including live events. If user
  authorization is already saved but the app-level token is missing, it resumes
  the live-events step without creating another app.
- **`bun run setup --no-socket`** — skip Socket Mode setup. It can also be
  combined with `--replace`. It does not remove an already-configured app-level token.
- **`bun run setup --socket`** — add or repair live events for the existing
  connection without creating an app.
- **`bun run setup --replace`** — create and authorize a new app, including
  Socket Mode setup by default.

User credentials are saved after successful authorization. If the live-events
step is interrupted, rerun `bun run setup` to finish it. If setup stops before
user authorization is saved, it prints the new app's settings URL so you can
finish installation manually or delete it before retrying.

### Manual setup

1. Open [Slack's app settings](https://api.slack.com/apps) and choose
   **Create New App → From a manifest**.
2. Select your workspace and paste the contents of `slack-app.yaml`.
3. Create the app, then select **OAuth & Permissions → Install to Workspace**.
4. Copy the **User OAuth Token** (`xoxp-…`), not a bot token.
5. Create `~/.config/slack-tui/credentials.env` (or
   `$XDG_CONFIG_HOME/slack-tui/credentials.env`) using `.env.example` as a template,
   replace the placeholder with your token, and restrict permissions with `chmod 600`.
6. Generate an app-level token with `connections:write` under **Basic Information
   → App-Level Tokens**, then run `bun run setup --socket` and paste it into the
   masked prompt. The manifest already enables Socket Mode and its event subscriptions.
7. Run `bun start` and check for **LIVE** in the title.

Existing project-local `.env` credentials migrate automatically on startup.
Only Slack credential entries are removed from the old file; unrelated settings
are preserved. The demo does not load or migrate credentials.

## Controls

Keyboard and mouse navigation are supported. Press **F1** for the in-app guide
to keybindings, mouse controls, and other features.

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

## Live messages (Socket Mode)

Slack pushes messages over a WebSocket—no polling, public server or tunnel.
Socket Mode is part of the standard setup above.

The title shows **LIVE** when connected. Messages, edits, deletions and reactions
update automatically; other conversations become bold on incoming messages.
Updates preserve drafts and scroll position, and wait to redraw while you select
text, edit a message, or use another screen. Visible messages at the bottom are
marked read. Socket Mode reconnects automatically and catches up the open
conversation's recent history. **Ctrl+R** is available for troubleshooting and
resyncing. Presence still uses explicit checks rather than a live subscription.

### Checking an existing app's configuration

If you are connecting an app that was not created from the current manifest,
check these settings:

1. Open [your Slack app settings](https://api.slack.com/apps) and select the
   **same app that issued your saved user token**.
2. Enable **Socket Mode**.
3. Under **Event Subscriptions**, enable events and add these under
   **Subscribe to events on behalf of users**:
   `message.channels`, `message.groups`, `message.im`, `message.mpim`,
   `reaction_added`, `reaction_removed`.
4. Add `reactions:read` under **OAuth & Permissions → User Token Scopes** if
   missing. Save and reinstall/reauthorize when Slack requests it; update your
   saved user token if it changes.
5. Under **Basic Information → App-Level Tokens**, generate a token with
   `connections:write`.
6. Run **`bun run setup --socket`** and paste the `xapp-…` token into its masked
   prompt. This adds `SLACK_APP_TOKEN` to the owner-only credentials file without
   creating another Slack app. Restart slack-tui.

## Unread status

Unread conversations appear in **bold**. Live messages update their indicators
immediately. Status is also checked in the background at startup, after connecting,
and with **Ctrl+R**, prioritizing the visible sidebar. Slack requires
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

Click the **smiley-plus icon** below a message to choose from its emoji palette, or click an existing reaction to toggle yours.
A check mark means you’ve reacted. Existing Slack installations need the `reactions:write`
user token scope and reauthorization to add or remove reactions.

## Current limitations

- **Recent history only:** loads up to 50 messages per conversation.
- **Basic formatting:** resolves mentions, links and bot attachment details,
  but does not yet render styled Markdown.
- **Approximate active-only sidebar:** hides conversations Slack marks dormant
  and explicitly closed DMs. Ctrl+L reveals all loaded conversations. Activity
  metadata is loaded at startup; custom sections and muted preferences aren't synced.
- No thread navigation, message search or persistent
  message cache yet.

If a send reports an uncertain delivery, check Slack before retrying to avoid
posting a duplicate.

## Development

```sh
bun run check
bun test
```
