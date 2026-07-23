#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "${SCRIPT_DIR}")"
EXTENSION_SRC="${PROJECT_DIR}/gnome-extension"
EXTENSION_DEST="${HOME}/.local/share/gnome-shell/extensions/vosk-cli-dictation@bboisseau.local"
EXTENSION_ZIP="/tmp/vosk-cli-dictation@bboisseau.local.shell-extension.zip"

if [[ ! -d "${EXTENSION_SRC}" ]]; then
  echo "Error: GNOME extension source not found at ${EXTENSION_SRC}" >&2
  exit 1
fi

if [[ -d "${EXTENSION_SRC}/schemas" ]]; then
  glib-compile-schemas "${EXTENSION_SRC}/schemas"
fi

mkdir -p "$(dirname "${EXTENSION_DEST}")"
rm -rf "${EXTENSION_DEST}"

# Build and install via GNOME CLI so the shell registers it as a user extension.
gnome-extensions pack --force --out-dir /tmp "${EXTENSION_SRC}" >/dev/null
gnome-extensions install --force "${EXTENSION_ZIP}" >/dev/null

# Keep the source synced in the extension directory for easy local editing/debugging.
mkdir -p "${EXTENSION_DEST}"
cp -r "${EXTENSION_SRC}/"* "${EXTENSION_DEST}/"

echo "Installed GNOME extension to ${EXTENSION_DEST}"
echo ""
echo "Next steps:"
echo "1. Restart GNOME Shell (Ctrl+Alt+F2, type 'r', press Enter)"
echo "   OR on Wayland: log out and back in"
echo "2. Open Settings > Extensions"
echo "3. Enable 'Vosk CLI Dictation'"
echo ""
echo "For more info, see: ${EXTENSION_SRC}/README.md"
