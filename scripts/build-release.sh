#!/bin/sh
# OC:x13-cachy:sal:ses_df1a0a3d0ffezEfNl4eWrA0klm Created
set -eu
cd "$(dirname "$0")/.."
platform=$(bun -e 'console.log(process.platform + "-" + process.arch)')
asset="slack-tui-$platform.tar.gz"
mkdir -p dist
stage=$(mktemp -d)
trap 'rm -rf "$stage"' EXIT
cp package.json bun.lock LICENSE slack-app.yaml "$stage/"
cp -R assets src "$stage/"
find "$stage/src" -name '*.test.ts' -delete
cp "$(command -v bun)" "$stage/bun"
cp scripts/slack-tui "$stage/slack-tui"
chmod 755 "$stage/slack-tui"
(cd "$stage" && ./bun install --production --frozen-lockfile)
# Ensure the archive actually contains working native libraries on this runner.
(cd "$stage" && ./bun -e 'import {NativeImage} from "@opentui/core"; import sharp from "sharp"; const png = await sharp("assets/reaction-picker.png").png().toBuffer(); NativeImage.decode(png).dispose();')
"$stage/slack-tui" setup --help
tar -czf "dist/$asset" -C "$stage" .
(cd dist && if command -v sha256sum >/dev/null 2>&1; then sha256sum "$asset"; else shasum -a 256 "$asset"; fi > "$asset.sha256")
