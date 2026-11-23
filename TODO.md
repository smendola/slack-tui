# TODO

Keep this list updated as ideas come up and work is completed. Check off finished items.

- [ ] Replicate channel layout from official app
- [ ] **Themes.** Add selectable color themes and persist the chosen theme in settings.
- [ ] Investigate `conversations.history: invalid_ts_oldest` during unread checks; one rejected cursor stops the sweep for remaining conversations.
- [ ] Persist drafts across restarts. Save per-workspace, per-conversation text and image drafts to disk with owner-only permissions. Autosave with a short debounce, flush on exit, restore on startup, and remove drafts after successful sends. LOW PRIORITY

## Completed

- [x] Show the DM participant’s name without `@` and their presence in the chat header. Show avatars in the DM list and header when profile photos are enabled.
- [x] Add and remove emoji reactions from the inline message palette.
- [x] Edit your sent messages without disturbing the composer draft.
- [x] Search conversation names in the sidebar and clear the filter when opening a match.
- [x] Reopen the last conversation on restart, including DMs.
- [x] Show footer shortcuts for the active pane.
- [x] Show a local-date separator before each day's messages.
- [x] Hyperlinks
- [x] Clear stale editor selections when restoring conversation drafts so typing cannot overwrite the restored text. Preserve composer editing state when refreshing the current conversation.
