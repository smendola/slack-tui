<!-- OC:x13-cachy:sal:ses_df1a0a3d0ffezEfNl4eWrA0klm Created -->
# slack-tui installer and release guide

**Handoff:** The installer is on the `installer` branch. The Linux x64 package was built and tried locally, including the offline demo and the first-run setup prompt. Type checking and all 70 application tests passed during implementation. No release tag was created in that session. To turn on the public install command, **merge the installer into `main`, then tag the reviewed commit and let the release workflow finish**. A successful Linux build alone does not verify the macOS or ARM packages.

## What users install

Users get one command, `slack-tui`. Underneath it is a platform-specific **archive**, not a single compiled binary: the launcher, Bun runtime, TypeScript source, production dependencies (including native OpenTUI and sharp libraries), image assets, and Slack app manifest travel together. Users need neither a Git checkout nor a separate Bun installation.

There is no application server operated by the maintainer. GitHub serves the installer and release files. Running the installer does **not** contact Slack or ask for a token. First-run Slack setup is a separate, interactive step: the existing wizard creates an app for the user's workspace and connects directly to Slack. Publishing a GitHub Release does not change the Slack app's distribution setting or the workspace's approval policy.

## Install and try it

Once `main` has the installer and the first release is available:

```sh
curl -fsSL https://raw.githubusercontent.com/smendola/slack-tui/main/install.sh | sh
```

To inspect the installer first, run the **same copy** you reviewed:

```sh
curl -fsSL https://raw.githubusercontent.com/smendola/slack-tui/main/install.sh -o install.sh
less install.sh
sh install.sh
```

The script selects Linux (glibc) or macOS and x64 or ARM64 using `uname`. It needs standard shell utilities, `curl`, `tar`, and either `sha256sum` or `shasum`. For other targets, see [running from source](README.md#running-from-source).

| Command | Result |
| --- | --- |
| `slack-tui --demo` | Try the UI offline, without Slack credentials. |
| `slack-tui` | With no credentials, start setup in an interactive terminal, then open chat. With credentials, open chat directly. |
| `slack-tui setup --help` | List setup and recovery options. Use `slack-tui setup` to resume an interrupted live-events step. |

Run setup on the machine with your browser. The [Slack connection guide](README.md#connect-to-slack) explains the browser flow and the two token prompts. If the shell says `slack-tui: command not found`, run `"$HOME/.local/bin/slack-tui"` directly. The installer neither uses `sudo` nor edits shell profiles.

## What the installer changes

1. [install.sh](install.sh) downloads `slack-tui-<os>-<arch>.tar.gz` and its matching `.sha256` file from the **latest GitHub Release** over HTTPS. The quick-install URL fetches the *script from `main`*; the script fetches the *app from Releases*. Keep those two compatible if you change asset names or layout.
2. It computes the archive's SHA-256 and compares it with the entry for that filename **before extracting**. A mismatch aborts the installation and leaves the current launcher in place. The checksum detects corruption or a mismatched download; it is not an independent signature because both files come from the same release.
3. It extracts the package to `~/.local/lib/slack-tui/<archive-sha256>/` and sets `~/.local/bin/slack-tui` to a symlink to the launcher there. The launcher uses the adjacent Bun executable. Rerunning the installer updates the link; there is no automatic background updater. Older installed packages remain on disk.
4. Slack credentials and settings are separate, under `${XDG_CONFIG_HOME:-$HOME/.config}/slack-tui/`. Updating or removing the package does not remove these files or uninstall the Slack app from the workspace.

**Rollback:** Before updating, `readlink "$HOME/.local/bin/slack-tui"` shows the current launcher target. If needed, point the link back to that saved path with `ln -sfn "$previous_launcher" "$HOME/.local/bin/slack-tui"` (set `previous_launcher` to the saved path). Keep that package directory until you no longer need the rollback.

**Uninstall:** Remove the launcher and installed packages. This leaves your Slack configuration intact:

```sh
rm -f "$HOME/.local/bin/slack-tui"
rm -rf "$HOME/.local/lib/slack-tui"
```

## Review and test before publishing

Run these from the repository root on a supported OS/CPU, with Bun installed (the workflow uses **1.4.5**):

```sh
bun install --frozen-lockfile
bun run check
bun test
sh scripts/build-release.sh
sh scripts/test-install.sh
```

- [build-release.sh](scripts/build-release.sh) builds for the **current** machine. It stages the runtime and locked production dependencies, decodes a bundled image through sharp and OpenTUI to check their native libraries, and runs setup help. The archive and checksum appear in `dist/`.
- [test-install.sh](scripts/test-install.sh) runs the actual installer against those local assets, using a temporary home and a stand-in for GitHub downloads. It checks installed setup help, the noninteractive first-run error, and rejection of a bad checksum. It does not test GitHub networking or authorize a Slack account.
- To try the exact packaged UI yourself, extract the archive to an empty directory and run `./slack-tui --demo` from there. The [launcher](scripts/slack-tui) selects chat or [setup](src/setup.ts); [src/index.ts](src/index.ts) handles automatic first-run setup.

## Publish a release

1. Review and merge `installer` into `main`. Ensure GitHub Actions is enabled and the repository permits the publish job to create releases.
2. Update your local `main`. Pick an **unused** version and verify the commit before tagging. Example for a first `v0.1.0` release:

   ```sh
   git switch main
   git pull --ff-only
   git log -1 --oneline
   git tag -a v0.1.0 -m "Release v0.1.0"
   git push origin v0.1.0
   ```

3. Open **GitHub → Actions → Release**. A *workflow* is a file of instructions GitHub runs on temporary machines. [release.yml](.github/workflows/release.yml) triggers on a **pushed tag matching `v*`**, not a normal branch push or a tag that only exists locally. Four build jobs run the checks above on Linux x64, Linux ARM64, macOS Intel, and macOS Apple Silicon. Each uploads its files as intermediate Actions artifacts.
4. Only after all four builds pass does the publish job collect those files and create a GitHub Release for the tag. Check [Releases/latest](https://github.com/smendola/slack-tui/releases/latest): expect four `.tar.gz` packages and four `.sha256` files in addition to GitHub's automatic source downloads. The installer uses the named packages, not the source downloads or Actions artifacts.
5. Verify the public path: install into a fresh user account, run `slack-tui --demo`, and check `slack-tui setup --help`. This tests the published URLs and asset names as well as the launcher.

**If publication fails:** Open the failed job in Actions and read the first failing step. A failed build prevents publication; a failed publish step can leave successful builds visible only as Actions artifacts. Rerun a transient failure against the same commit. If the fix changes source, merge it and tag a new version rather than moving a published tag.

**If installation returns 404:** A 404 for `raw.githubusercontent.com/.../main/install.sh` means the script is not available at that branch/path. A 404 for `releases/latest/download/...` means the latest release or the matching asset is missing. Check which URL failed before rebuilding.
