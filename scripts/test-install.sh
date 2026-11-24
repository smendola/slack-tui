#!/bin/sh
# OC:x13-cachy:sal:ses_df1a0a3d0ffezEfNl4eWrA0klm Created
# Exercise the real archive and installer with a local stand-in for GitHub Releases.
set -eu
repo=$(CDPATH= cd "$(dirname "$0")/.." && pwd)
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT
export HOME="$tmp/user home" XDG_CONFIG_HOME="$tmp/config" RELEASE_DIST="$repo/dist"
mkdir "$tmp/tools" "$HOME"
cat > "$tmp/tools/curl" <<'SH'
#!/bin/sh
set -eu
while [ "$1" != -o ]; do url=$1; shift; done
cp "$RELEASE_DIST/${url##*/}" "$2"
if [ "${CORRUPT:-}" = 1 ] && [ "${url##*.}" = sha256 ]; then echo invalid > "$2"; fi
SH
chmod +x "$tmp/tools/curl"
export PATH="$tmp/tools:$PATH"
cd "$tmp"
sh "$repo/install.sh"
app="$HOME/.local/bin/slack-tui"
"$app" setup --help | grep -F 'slack-tui setup --socket'
if "$app" </dev/null > first-launch.log 2>&1; then exit 1; fi
grep -F 'Run slack-tui setup in an interactive terminal' first-launch.log
if CORRUPT=1 sh "$repo/install.sh"; then exit 1; fi
"$app" --help
