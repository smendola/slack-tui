#!/bin/sh
# OC:x13-cachy:sal:ses_df1a0a3d0ffezEfNl4eWrA0klm Created
set -eu

install_slack_tui() {
  case $(uname -s) in Linux) os=linux ;; Darwin) os=darwin ;; *) echo "Unsupported OS" >&2; return 1 ;; esac
  if [ "$os" = linux ] && ! getconf GNU_LIBC_VERSION >/dev/null 2>&1; then
    echo "Linux releases require glibc. See the README to run from source." >&2
    return 1
  fi
  case $(uname -m) in x86_64) arch=x64 ;; arm64|aarch64) arch=arm64 ;; *) echo "Unsupported CPU" >&2; return 1 ;; esac
  asset="slack-tui-$os-$arch.tar.gz"
  base=https://github.com/smendola/slack-tui/releases/latest/download
  lib="$HOME/.local/lib/slack-tui"
  bin="$HOME/.local/bin"
  mkdir -p "$lib" "$bin"
  tmp=$(mktemp -d "$lib/.install.XXXXXXXX")
  trap 'rm -rf "$tmp"' EXIT
  trap 'exit 1' HUP INT TERM
  cd "$tmp"
  for file in "$asset" "$asset.sha256"; do
    curl -fsSL --proto '=https' --proto-redir '=https' "$base/$file" -o "$file"
  done
  expected=$(awk -v name="$asset" 'NF == 2 && $2 == name {print $1}' "$asset.sha256")
  if command -v sha256sum >/dev/null 2>&1; then hash=$(sha256sum "$asset")
  else hash=$(shasum -a 256 "$asset"); fi
  digest=${hash%% *}
  if [ "$expected" != "$digest" ]; then echo "Checksum mismatch: $asset" >&2; return 1; fi
  dest="$lib/$digest"
  if [ ! -d "$dest" ]; then
    mkdir package
    tar -xzf "$asset" -C package
    test -x package/slack-tui && test -x package/bun || { echo "Incomplete archive" >&2; return 1; }
    mv package "$dest"
  fi
  ln -s "$dest/slack-tui" launcher
  mv -f launcher "$bin/slack-tui"
  case ":$PATH:" in
    *":$bin:"*) echo "Installed. Run: slack-tui" ;;
    *) echo "Installed. Run: \"$bin/slack-tui\" ($bin is not on PATH)" ;;
  esac
}
install_slack_tui
