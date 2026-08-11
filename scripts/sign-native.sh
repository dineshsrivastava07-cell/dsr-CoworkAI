#!/bin/bash
# sign-native.sh — Ad-hoc sign all Mach-O native addons and Electron bundle
# Required on macOS 26 (Tahoe): strict codesign enforcement on dlopen'd .node files
set -e

REPO_DIR="$(cd "$(dirname "$0")/.." && pwd)"
ENT="$REPO_DIR/scripts/electron-entitlements.plist"
ELECTRON_DIST="$REPO_DIR/node_modules/electron/dist/Electron.app"

echo "[sign-native] Removing quarantine flags..."
xattr -cr "$ELECTRON_DIST" 2>/dev/null || true

echo "[sign-native] Signing native .node addons..."
find "$REPO_DIR/node_modules" -name "*.node" | while read f; do
  if file "$f" 2>/dev/null | grep -q "Mach-O"; then
    /usr/bin/codesign --force --sign - --entitlements "$ENT" "$f" 2>/dev/null \
      && echo "  ✓ $(basename $f)"
  fi
done

echo "[sign-native] Signing Electron.app bundle..."
find "$ELECTRON_DIST" \( -name "*.dylib" -o -name "*.so" \) | while read f; do
  /usr/bin/codesign --force --sign - --entitlements "$ENT" "$f" 2>/dev/null
done
find "$ELECTRON_DIST" -name "*.framework" | sort -r | while read f; do
  /usr/bin/codesign --force --sign - --entitlements "$ENT" "$f" 2>/dev/null
done
find "$ELECTRON_DIST" -name "*.app" | grep -v "^$ELECTRON_DIST$" | while read f; do
  /usr/bin/codesign --force --deep --sign - --entitlements "$ENT" "$f" 2>/dev/null
done
/usr/bin/codesign --force --deep --sign - --entitlements "$ENT" "$ELECTRON_DIST" 2>&1

echo "[sign-native] Done ✓"
