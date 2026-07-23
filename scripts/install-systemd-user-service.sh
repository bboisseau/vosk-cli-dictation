#!/usr/bin/env bash
set -euo pipefail

PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SERVICE_DIR="${HOME}/.config/systemd/user"
SERVICE_FILE="${SERVICE_DIR}/vosk-cli-dictation.service"
PYTHON_BIN="${PROJECT_DIR}/venv/bin/python3"
LANGUAGE="${1:-}"

if [[ ! -x "${PYTHON_BIN}" ]]; then
  echo "Error: Python executable not found at ${PYTHON_BIN}" >&2
  echo "Create your virtual environment and install dependencies first." >&2
  exit 1
fi

mkdir -p "${SERVICE_DIR}"

EXEC_START="${PYTHON_BIN} ${PROJECT_DIR}/src/main.py"
if [[ -n "${LANGUAGE}" ]]; then
  EXEC_START="${EXEC_START} -l ${LANGUAGE}"
fi

cat > "${SERVICE_FILE}" <<EOF
[Unit]
Description=Vosk CLI Dictation (user session)
After=graphical-session.target
Wants=graphical-session.target

[Service]
Type=simple
WorkingDirectory=${PROJECT_DIR}
ExecStart=${EXEC_START}
Restart=on-failure
RestartSec=2
Environment=PYTHONUNBUFFERED=1

[Install]
WantedBy=default.target
EOF

systemctl --user daemon-reload
systemctl --user enable --now vosk-cli-dictation.service

echo "Installed and started user service: vosk-cli-dictation.service"
echo "Use 'systemctl --user status vosk-cli-dictation.service' to check status."
