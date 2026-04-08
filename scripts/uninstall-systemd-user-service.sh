#!/usr/bin/env bash
set -euo pipefail

SERVICE_FILE="${HOME}/.config/systemd/user/vosk-cli-dictation.service"

systemctl --user disable --now vosk-cli-dictation.service >/dev/null 2>&1 || true
rm -f "${SERVICE_FILE}"
systemctl --user daemon-reload

echo "Removed user service: vosk-cli-dictation.service"
