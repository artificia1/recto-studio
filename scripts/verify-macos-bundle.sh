#!/usr/bin/env bash
set -euo pipefail

arch="${1:?Pass the expected executable architecture}"
version=$(node -p "require('./package.json').version")
shopt -s nullglob
bundles=(src-tauri/target/release/bundle/dmg/*_"$version"_*.dmg)
if [[ "${#bundles[@]}" -ne 1 ]]; then
  echo "Expected exactly one disk image for $version." >&2
  exit 1
fi

image="${bundles[0]}"
mount=$(mktemp -d)
app="$mount/Recto Studio.app"
pid=
cleanup() {
  if [[ -n "$pid" ]]; then
    kill "$pid" 2>/dev/null || true
    wait "$pid" 2>/dev/null || true
  fi
  hdiutil detach "$mount" -quiet || true
  rmdir "$mount" || true
}
trap cleanup EXIT
hdiutil verify "$image" -quiet
hdiutil attach "$image" -readonly -nobrowse -mountpoint "$mount" -quiet

plist="$app/Contents/Info.plist"
executable="$app/Contents/MacOS/$(/usr/libexec/PlistBuddy -c 'Print :CFBundleExecutable' "$plist")"
[[ "$(/usr/libexec/PlistBuddy -c 'Print :CFBundleShortVersionString' "$plist")" == "$version" ]]
[[ -L "$mount/Applications" ]]
codesign --verify --deep --strict "$app"
# Compare the architecture of the actual Mach-O payload and launch it on the same architecture.
lipo "$executable" -verify_arch "$arch"
test "$(uname -m)" = "$arch"
"$executable" &
pid=$!
sleep 8
kill -0 "$pid"

mkdir -p release-artifacts
cp "$image" "release-artifacts/Recto-Studio-$version-macOS-$arch.dmg"
