import Gtk from 'gi://Gtk';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Adw from 'gi://Adw';

import { ExtensionPreferences } from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

const SERVICE_NAME = 'vosk-cli-dictation.service';
const PROJECT_DIR = GLib.build_filenamev([GLib.get_home_dir(), 'vosk-cli-dictation-bboisseau']);
const CONFIG_PATH = GLib.build_filenamev([PROJECT_DIR, 'config', 'config.yaml']);
const SERVICE_SCRIPT = GLib.build_filenamev([PROJECT_DIR, 'scripts', 'install-systemd-user-service.sh']);
const APPLY_PREFS_SCRIPT = GLib.build_filenamev([PROJECT_DIR, 'scripts', 'apply_extension_preferences.py']);
const VENV_PYTHON = GLib.build_filenamev([PROJECT_DIR, 'venv', 'bin', 'python3']);

function makeDropdownRow(group, title, subtitle, options, selectedIndex, onChanged) {
    const row = new Adw.ActionRow({ title, subtitle });
    const model = Gtk.StringList.new(options);
    const dropdown = new Gtk.DropDown({ model, selected: selectedIndex >= 0 ? selectedIndex : 0 });
    row.add_suffix(dropdown);
    row.activatable_widget = dropdown;
    group.add(row);

    dropdown.connect('notify::selected', (widget) => {
        onChanged(widget.get_selected());
    });

    return dropdown;
}

export default class VoskExtensionPreferences extends ExtensionPreferences {
    fillPreferencesWindow(window) {
        window.set_title(this.gettext('Vosk CLI Dictation Settings'));
        window.set_default_size(700, 900);

        const page = new Adw.PreferencesPage({
            title: this.gettext('Vosk CLI Dictation'),
        });
        window.add(page);

        const settings = this.getSettings();
        const applySelectedSettings = () => {
            if (!GLib.file_test(APPLY_PREFS_SCRIPT, GLib.FileTest.EXISTS)) {
                return;
            }

            const language = settings.get_string('selected-language') || 'fr';
            const shortcutKey = settings.get_string('shortcut-key') || 'ctrl_l';
            const tapType = settings.get_string('shortcut-tap-type') || 'double';

            const pythonExec = GLib.file_test(VENV_PYTHON, GLib.FileTest.EXISTS) ? VENV_PYTHON : 'python3';

            try {
                GLib.spawn_async(
                    null,
                    [
                        pythonExec,
                        APPLY_PREFS_SCRIPT,
                        '--language', language,
                        '--shortcut-key', shortcutKey,
                        '--tap-type', tapType,
                    ],
                    null,
                    GLib.SpawnFlags.SEARCH_PATH,
                    null
                );
            } catch (e) {
                logError(e);
            }
        };

        const statusGroup = new Adw.PreferencesGroup({
            title: this.gettext('Service Management'),
            description: this.gettext('Status and control of the Vosk dictation service'),
        });

        const statusLabel = new Gtk.Label({
            label: this.gettext('Checking service status...'),
            xalign: 0,
            css_classes: ['dim-label'],
        });
        statusGroup.set_header_suffix(statusLabel);

        const serviceRow = new Adw.ActionRow({
            title: this.gettext('Service Actions'),
            subtitle: this.gettext('Start, stop, restart, or reinstall the user service'),
        });

        const buttonsBox = new Gtk.Box({
            orientation: Gtk.Orientation.HORIZONTAL,
            spacing: 6,
            valign: Gtk.Align.CENTER,
        });

        const startButton = new Gtk.Button({ label: this.gettext('Start') });
        const stopButton = new Gtk.Button({ label: this.gettext('Stop') });
        const restartButton = new Gtk.Button({ label: this.gettext('Restart') });
        const reinstallButton = new Gtk.Button({
            label: this.gettext('Reinstall Service'),
            css_classes: ['suggested-action'],
        });

        buttonsBox.append(startButton);
        buttonsBox.append(stopButton);
        buttonsBox.append(restartButton);
        buttonsBox.append(reinstallButton);

        serviceRow.add_suffix(buttonsBox);
        statusGroup.add(serviceRow);

        const refreshStatus = () => {
            try {
                const [, out] = GLib.spawn_command_line_sync(`systemctl --user is-active ${SERVICE_NAME}`);
                const state = new TextDecoder().decode(out).trim();
                if (state === 'active') {
                    statusLabel.label = this.gettext('Service: Running');
                } else {
                    statusLabel.label = this.gettext('Service: Stopped');
                }
            } catch (e) {
                statusLabel.label = this.gettext('Service: Unknown');
                logError(e);
            }
        };

        const runSystemctl = (args) => {
            try {
                GLib.spawn_async(null, ['systemctl', '--user', ...args], null, GLib.SpawnFlags.SEARCH_PATH, null);
                GLib.timeout_add(GLib.PRIORITY_DEFAULT, 800, () => {
                    refreshStatus();
                    return GLib.SOURCE_REMOVE;
                });
            } catch (e) {
                logError(e);
            }
        };

        startButton.connect('clicked', () => runSystemctl(['start', SERVICE_NAME]));
        stopButton.connect('clicked', () => runSystemctl(['stop', SERVICE_NAME]));
        restartButton.connect('clicked', () => runSystemctl(['restart', SERVICE_NAME]));
        reinstallButton.connect('clicked', () => {
            if (GLib.file_test(SERVICE_SCRIPT, GLib.FileTest.EXISTS)) {
                try {
                    GLib.spawn_async(null, ['bash', SERVICE_SCRIPT], null, GLib.SpawnFlags.SEARCH_PATH, null);
                    GLib.timeout_add(GLib.PRIORITY_DEFAULT, 1500, () => {
                        refreshStatus();
                        return GLib.SOURCE_REMOVE;
                    });
                } catch (e) {
                    logError(e);
                }
            }
        });

        refreshStatus();
        page.add(statusGroup);

        const modelGroup = new Adw.PreferencesGroup({
            title: this.gettext('Language and Model'),
            description: this.gettext('Select the recognition language and model size'),
        });

        const availableModels = [
            { label: 'English (US) - small (47 MB)', language: 'en', path: 'vosk-model/vosk-model-small-en-us-0.15' },
            { label: 'French - small (61 MB)', language: 'fr', path: 'vosk-model/vosk-model-small-fr-0.22' },
        ];

        const currentLang = settings.get_string('selected-language');
        const currentModelIdx = availableModels.findIndex((m) => m.language === currentLang);

        makeDropdownRow(
            modelGroup,
            this.gettext('Language and Model'),
            this.gettext('Pick one installed model profile'),
            availableModels.map((m) => m.label),
            currentModelIdx,
            (idx) => {
                if (idx >= 0 && idx < availableModels.length) {
                    settings.set_string('selected-language', availableModels[idx].language);
                    settings.set_string('selected-model-path', availableModels[idx].path);
                    applySelectedSettings();
                    runSystemctl(['restart', SERVICE_NAME]);
                }
            }
        );

        page.add(modelGroup);

        const shortcutGroup = new Adw.PreferencesGroup({
            title: this.gettext('Keyboard Shortcut'),
            description: this.gettext('Configure key and tap count for triggering dictation'),
        });

        const tapTypeValues = ['single', 'double', 'triple'];
        const tapTypeLabels = [
            this.gettext('Single press'),
            this.gettext('Double press'),
            this.gettext('Triple press'),
        ];
        const currentTapType = settings.get_string('shortcut-tap-type');
        const currentTapIdx = Math.max(0, tapTypeValues.indexOf(currentTapType));

        makeDropdownRow(
            shortcutGroup,
            this.gettext('Tap Type'),
            this.gettext('How many times to press the key'),
            tapTypeLabels,
            currentTapIdx,
            (idx) => {
                if (idx >= 0 && idx < tapTypeValues.length) {
                    settings.set_string('shortcut-tap-type', tapTypeValues[idx]);
                    applySelectedSettings();
                    runSystemctl(['restart', SERVICE_NAME]);
                }
            }
        );

        const shortcutKeys = ['ctrl_l', 'ctrl_r', 'alt_l', 'alt_r', 'shift_l', 'shift_r', 'caps_lock'];
        const shortcutLabels = [
            this.gettext('Left Ctrl'),
            this.gettext('Right Ctrl'),
            this.gettext('Left Alt'),
            this.gettext('Right Alt'),
            this.gettext('Left Shift'),
            this.gettext('Right Shift'),
            this.gettext('Caps Lock'),
        ];
        const currentKey = settings.get_string('shortcut-key');
        const currentKeyIdx = Math.max(0, shortcutKeys.indexOf(currentKey));

        makeDropdownRow(
            shortcutGroup,
            this.gettext('Shortcut Key'),
            this.gettext('The key used for the trigger'),
            shortcutLabels,
            currentKeyIdx,
            (idx) => {
                if (idx >= 0 && idx < shortcutKeys.length) {
                    settings.set_string('shortcut-key', shortcutKeys[idx]);
                    applySelectedSettings();
                    runSystemctl(['restart', SERVICE_NAME]);
                }
            }
        );

        page.add(shortcutGroup);

        const actionsGroup = new Adw.PreferencesGroup({
            title: this.gettext('Project Actions'),
            description: this.gettext('Quick access to project configuration files'),
        });

        const openConfigRow = new Adw.ActionRow({
            title: this.gettext('Open config.yaml'),
            subtitle: CONFIG_PATH,
        });
        const openConfigButton = new Gtk.Button({ label: this.gettext('Open') });
        openConfigRow.add_suffix(openConfigButton);
        openConfigRow.activatable_widget = openConfigButton;
        actionsGroup.add(openConfigRow);

        openConfigButton.connect('clicked', () => {
            try {
                GLib.spawn_async(null, ['gnome-text-editor', CONFIG_PATH], null, GLib.SpawnFlags.SEARCH_PATH, null);
            } catch (_e) {
                GLib.spawn_async(null, ['xdg-open', CONFIG_PATH], null, GLib.SpawnFlags.SEARCH_PATH, null);
            }
        });

        const openFolderRow = new Adw.ActionRow({
            title: this.gettext('Open Project Folder'),
            subtitle: PROJECT_DIR,
        });
        const openFolderButton = new Gtk.Button({ label: this.gettext('Open') });
        openFolderRow.add_suffix(openFolderButton);
        openFolderRow.activatable_widget = openFolderButton;
        actionsGroup.add(openFolderRow);

        openFolderButton.connect('clicked', () => {
            try {
                const file = Gio.File.new_for_path(PROJECT_DIR);
                GLib.spawn_async(null, ['xdg-open', file.get_uri()], null, GLib.SpawnFlags.SEARCH_PATH, null);
            } catch (e) {
                logError(e);
            }
        });

        page.add(actionsGroup);
    }
}
