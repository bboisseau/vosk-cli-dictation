#!/usr/bin/env bash
set -euo pipefail

EXTENSION_DIR="${HOME}/.local/share/gnome-shell/extensions/vosk-cli-dictation@bboisseau.local"

if [[ -d "${EXTENSION_DIR}" ]]; then
  rm -rf "${EXTENSION_DIR}"
  echo "Removed GNOME extension from ${EXTENSION_DIR}"
else
  echo "Extension not found at ${EXTENSION_DIR}"
fi

echo "Extension uninstalled. Restart GNOME Shell for changes to take effect."
