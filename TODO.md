# TODO

Keep this list updated as ideas come up and work is completed. Check off finished items.

- [ ] **Persist drafts across restarts.** Save per-workspace, per-conversation text and image drafts to disk with owner-only permissions. Autosave with a short debounce, flush on exit, restore on startup, and remove drafts after successful sends.
- [ ] **Themes.** Add selectable color themes and persist the chosen theme in settings.
- [ ] Help text at bottom sensitive to what pane is active
- [ ] Channel name search

## Completed

- [x] Clear stale editor selections when restoring conversation drafts so typing cannot overwrite the restored text. Preserve composer editing state when refreshing the current conversation.
