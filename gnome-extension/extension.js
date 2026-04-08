import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';
import { Extension, gettext as _ } from 'resource:///org/gnome/shell/extensions/extension.js';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import St from 'gi://St';

const VOSK_SERVICE = 'vosk-cli-dictation.service';
const PROJECT_HOME = (GLib.get_home_dir() + '/vosk-cli-dictation-bboisseau').replace(/\/+/g, '/');
const CONFIG_FILE = PROJECT_HOME + '/config/config.yaml';

class VoskIndicator extends PanelMenu.Button {
    constructor(extension) {
        super(0.0, 'Vosk CLI Dictation');
        this._extension = extension;
        this._isRunning = false;

        // Create icon/label
        let hbox = new St.BoxLayout({ style_class: 'panel-status-menu-box' });
        let icon = new St.Icon({
            icon_name: 'input-microphone-symbolic',
            style_class: 'system-status-icon'
        });
        hbox.add_child(icon);
        this._label = new St.Label({ text: _('Vosk'), y_align: St.Align.MIDDLE });
        hbox.add_child(this._label);
        this.add_child(hbox);

        // Status indicator
        this._statusIcon = new St.Icon({
            icon_name: 'process-stop-symbolic',
            style_class: 'system-status-icon vosk-status-icon',
        });
        hbox.add_child(this._statusIcon);

        this._buildMenu();
        this._refreshStatus();
        this._statusCheckTimeout = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, 2, () => {
            this._refreshStatus();
            return GLib.SOURCE_CONTINUE;
        });
    }

    _buildMenu() {
        // Start/Stop
        this._toggleItem = this.menu.addAction(_('Start Service'), () => this._toggleService());

        // Language/Model Selection
        this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());
        let langSubMenu = new PopupMenu.PopupSubMenuMenuItem(_('Language / Model'));
        this.menu.addMenuItem(langSubMenu);
        this._populateLanguageMenu(langSubMenu.menu);

        // Download Models
        this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());
        this.menu.addAction(_('Download Models...'), () => this._openDownloadGuide());

        // Restart Service
        this.menu.addAction(_('Restart Service'), () => this._restartService());

        // Open Config
        this.menu.addAction(_('Edit Config'), () => this._openConfig());

        // Quit
        this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());
        this.menu.addAction(_('Quit Service'), () => this._stopService());
    }

    _populateLanguageMenu(menu) {
        menu.removeAll();
        let config = this._loadConfig();
        if (!config) {
            menu.addMenuItem(new PopupMenu.PopupMenuItem(_('(Config not found)')));
            return;
        }

        let currentLang = config.default_model || 'en';
        let models = config.vosk_models || [];

        models.forEach(model => {
            let label = this._getModelLabel(model.name);
            let item = new PopupMenu.PopupMenuItem(label);
            if (model.name === currentLang) {
                item.setOrnament(PopupMenu.Ornament.DOT);
            }
            item.connect('activate', () => this._setLanguage(model.name));
            menu.addMenuItem(item);
        });
    }

    _getModelLabel(code) {
        let labels = { 'en': '🇬🇧 English', 'fr': '🇫🇷 Français' };
        return labels[code] || code;
    }

    _loadConfig() {
        try {
            let file = Gio.File.new_for_path(CONFIG_FILE);
            let [ok, contents] = file.load_contents(null);
            if (!ok) return null;

            let text = new TextDecoder().decode(contents);
            // Simple YAML parser for default_model and vosk_models
            let config = { vosk_models: [] };
            let lines = text.split('\n');
            let inModels = false;

            for (let i = 0; i < lines.length; i++) {
                let line = lines[i];
                if (line.startsWith('default_model:')) {
                    let match = line.match(/:\s*"?(\w+)"?/);
                    if (match) config.default_model = match[1];
                }
                if (line.startsWith('vosk_models:')) {
                    inModels = true;
                    continue;
                }
                if (inModels) {
                    if (line.match(/^\s*-\s+name:/)) {
                        let nameMatch = line.match(/name:\s*"?(\w+)"?/);
                        if (nameMatch) {
                            config.vosk_models.push({ name: nameMatch[1] });
                        }
                    }
                    if (!line.startsWith('  ') && line.trim() && !line.startsWith('vosk_models')) {
                        inModels = false;
                    }
                }
            }
            return config;
        } catch (e) {
            logError(e);
            return null;
        }
    }

    _setLanguage(lang) {
        try {
            let file = Gio.File.new_for_path(CONFIG_FILE);
            let [ok, contents] = file.load_contents(null);
            if (!ok) return;

            let text = new TextDecoder().decode(contents);
            let updated = text.replace(/^default_model:.*$/m, `default_model: "${lang}"`);

            let stream = file.replace(null, false, Gio.FileCreateFlags.NONE, null);
            stream.write_all(updated, null);
            stream.close(null);

            this._restartService();
        } catch (e) {
            logError(e);
        }
    }

    _toggleService() {
        if (this._isRunning) {
            this._stopService();
        } else {
            this._startService();
        }
    }

    _startService() {
        this._execSystemctl(['start', VOSK_SERVICE]);
    }

    _stopService() {
        this._execSystemctl(['stop', VOSK_SERVICE]);
    }

    _restartService() {
        this._execSystemctl(['restart', VOSK_SERVICE]);
    }

    _execSystemctl(args) {
        try {
            let cmd = ['systemctl', '--user', ...args];
            GLib.spawn_async(null, cmd, null, GLib.SpawnFlags.SEARCH_PATH, null);
            GLib.timeout_add(GLib.PRIORITY_DEFAULT, 500, () => {
                this._refreshStatus();
                return GLib.SOURCE_REMOVE;
            });
        } catch (e) {
            logError(e);
        }
    }

    _refreshStatus() {
        try {
            let [ok, output] = GLib.spawn_command_line_sync(
                `systemctl --user is-active ${VOSK_SERVICE}`
            );
            let status = new TextDecoder().decode(output).trim();
            this._isRunning = (status === 'active');

            if (this._isRunning) {
                this._statusIcon.icon_name = 'media-playback-start-symbolic';
                this._statusIcon.add_style_class_name('vosk-running');
                this._statusIcon.remove_style_class_name('vosk-stopped');
                this._toggleItem.label.text = _('Stop Service');
            } else {
                this._statusIcon.icon_name = 'media-playback-stop-symbolic';
                this._statusIcon.add_style_class_name('vosk-stopped');
                this._statusIcon.remove_style_class_name('vosk-running');
                this._toggleItem.label.text = _('Start Service');
            }
        } catch (e) {
            logError(e);
        }
    }

    _openDownloadGuide() {
        // Open a dialog with model download instructions
        let cmd = [
            'zenity', '--info',
            '--title=Vosk Model Download',
            '--text=Models must be downloaded manually.\n\n' +
                'Visit: https://alphacephei.com/vosk/models\n\n' +
                'Download:\n' +
                '• vosk-model-small-en-us-0.15 (English)\n' +
                '• vosk-model-small-fr-0.22 (French)\n\n' +
                'Extract to: ' + PROJECT_HOME + '/vosk-model/',
            '--width=500'
        ];
        try {
            GLib.spawn_async(null, cmd, null, GLib.SpawnFlags.SEARCH_PATH, null);
        } catch (e) {
            logError(e);
        }
    }

    _openConfig() {
        try {
            GLib.spawn_async(null, ['gnome-text-editor', CONFIG_FILE], null, GLib.SpawnFlags.SEARCH_PATH, null);
        } catch (e) {
            logError(e);
        }
    }

    destroy() {
        if (this._statusCheckTimeout) {
            GLib.source_remove(this._statusCheckTimeout);
        }
        super.destroy();
    }
}

export default class VoskExtension extends Extension {
    enable() {
        this._indicator = new VoskIndicator(this);
        Main.panel.addToStatusArea('vosk-indicator', this._indicator);
    }

    disable() {
        this._indicator?.destroy();
        this._indicator = null;
    }
}
