# Vosk CLI Dictation GNOME Shell Extension

A top-panel indicator for controlling the Vosk dictation service directly from your GNOME desktop.

## Features

- **Top Panel Status**: Shows recording status with color-coded indicator (green=running, red=stopped)
- **Quick Controls**: Start/stop/restart service from the panel menu
- **Language Selection**: Switch between installed language models without restarting manually
- **Model Download Guide**: Links to Vosk models repository with download instructions
- **Config Editor**: Quick access to edit configuration
- **Service Display**: Monitors service status in real-time (2-second refresh)

## Installation

### 1. Prerequisites

Ensure your Vosk setup is complete:
- ✅ Virtual environment created: `python3 -m venv venv`
- ✅ Dependencies installed: `pip install -r requirements.txt`
- ✅ Language models downloaded to `vosk-model/`
- ✅ Systemd user service installed: `./scripts/install-systemd-user-service.sh`

### 2. Install the Extension

```bash
cd ~/vosk-cli-dictation-bboisseau
mkdir -p ~/.local/share/gnome-shell/extensions/
cp -r gnome-extension ~/.local/share/gnome-shell/extensions/vosk-cli-dictation@bboisseau.local
```

### 3. Enable the Extension

```bash
# Restart GNOME Shell (Ctrl+Alt+F2, type 'r', press Enter)
# OR on Wayland systems, log out and back in
```

Then open **Settings > Extensions** and toggle **Vosk CLI Dictation** ON.

## Usage

After enabling, a **microphone icon** will appear in your top GNOME panel.

### Top Panel Menu Options

| Option | Action |
|--------|--------|
| **Start/Stop Service** | Toggle the dictation service on/off |
| **Language / Model** | Select installed language model and auto-restart |
| **Download Models** | Opens instructions to download Vosk models |
| **Restart Service** | Restarts the service (useful after config changes) |
| **Edit Config** | Opens `config.yaml` in your text editor |
| **Quit Service** | Stops the service cleanly |

### Model Installation

Click **"Download Models..."** in the extension menu for step-by-step instructions.

**Current default location**: `~/vosk-cli-dictation-bboisseau/vosk-model/`

Supported models (as of now):
- **English**: `vosk-model-small-en-us-0.15`
- **French**: `vosk-model-small-fr-0.22`

## Configuration

Edit `~/vosk-cli-dictation-bboisseau/config/config.yaml` to customize:

- **Hotkeys** (Alt+H to toggle, Alt+S to finalize)
- **Double-tap shortcuts** (e.g., press Ctrl twice)
- **Voice commands** (start/stop words)
- **Punctuation and recognition aliases**
- **UI theme colors**

After editing, click **"Restart Service"** in the extension menu for changes to take effect.

## Troubleshooting

### Extension doesn't appear in GNOME Settings

1. Check the extension was copied correctly:
   ```bash
   ls ~/.local/share/gnome-shell/extensions/vosk-cli-dictation@bboisseau.local/
   ```

2. Restart GNOME Shell (Ctrl+Alt+F2, type `r`, press Enter)

3. Check for errors in the system log:
   ```bash
   journalctl /usr/bin/gnome-shell -f --lines=50
   ```

### Service won't start

```bash
# Check systemd user service status
systemctl --user status vosk-cli-dictation.service

# View service logs
journalctl --user -u vosk-cli-dictation.service -n 50 -f
```

Ensure:
- Virtual environment exists: `ls ~/vosk-cli-dictation-bboisseau/venv/`
- Python dependencies installed: `~/vosk-cli-dictation-bboisseau/venv/bin/pip list`
- Models are in place: `ls ~/vosk-cli-dictation-bboisseau/vosk-model/`

### Language change doesn't work

1. Verify the config file is writable:
   ```bash
   ls -l ~/vosk-cli-dictation-bboisseau/config/config.yaml
   ```

2. Check that the desired language model is installed:
   ```bash
   ls ~/vosk-cli-dictation-bboisseau/vosk-model/
   ```

3. Manually restart the service:
   ```bash
   systemctl --user restart vosk-cli-dictation.service
   ```

## Uninstall

```bash
rm -rf ~/.local/share/gnome-shell/extensions/vosk-cli-dictation@bboisseau.local
```

Then restart GNOME Shell.

## Notes

- The extension requires GNOME 45 or later.
- It monitors the systemd user service, so ensure the service installer has been run.
- The extension uses `zenity` for the model download dialog. Install it if missing: `sudo apt install zenity`
- Icons are loaded from your current GNOME icon theme.

## Future Enhancements

Possible extensions:
- Direct model download/install from the extension (without zenity)
- Voice activity detection indicator in the panel
- Quick keyboard shortcut settings in the preferences UI
- Statistics (recordings today, words typed, etc.)
