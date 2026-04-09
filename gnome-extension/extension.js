import GObject from 'gi://GObject';
import St from 'gi://St';
import GLib from 'gi://GLib';
import * as ByteArray from 'resource:///org/gnome/gjs/modules/byteArray.js';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';
import { Extension } from 'resource:///org/gnome/shell/extensions/extension.js';

const SERVICE_NAME = 'vosk-cli-dictation.service';

const VoskIndicator = GObject.registerClass(
class VoskIndicator extends PanelMenu.Button {
    constructor(extension) {
        super(0.0, 'Vosk CLI Dictation');
        this._ = extension.gettext.bind(extension);

        this._icon = new St.Icon({
            icon_name: 'input-microphone-symbolic',
            style_class: 'system-status-icon',
        });
        this.add_child(this._icon);

        this._statusItem = new PopupMenu.PopupMenuItem(this._('Checking service status...'));
        this._statusItem.reactive = false;
        this.menu.addMenuItem(this._statusItem);

        this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());

        const restartItem = new PopupMenu.PopupMenuItem(this._('Restart Service'));
        restartItem.connect('activate', () => this._runSystemctl(['restart', SERVICE_NAME]));
        this.menu.addMenuItem(restartItem);

        const stopItem = new PopupMenu.PopupMenuItem(this._('Stop Service'));
        stopItem.connect('activate', () => this._runSystemctl(['stop', SERVICE_NAME]));
        this.menu.addMenuItem(stopItem);

        const startItem = new PopupMenu.PopupMenuItem(this._('Start Service'));
        startItem.connect('activate', () => this._runSystemctl(['start', SERVICE_NAME]));
        this.menu.addMenuItem(startItem);

        this._statusRefreshId = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, 2, () => {
            this._refreshStatus();
            return GLib.SOURCE_CONTINUE;
        });

        this._refreshStatus();
    }

    _runSystemctl(args) {
        try {
            const cmd = ['systemctl', '--user', ...args];
            GLib.spawn_async(null, cmd, null, GLib.SpawnFlags.SEARCH_PATH, null);
            GLib.timeout_add(GLib.PRIORITY_DEFAULT, 350, () => {
                this._refreshStatus();
                return GLib.SOURCE_REMOVE;
            });
        } catch (e) {
            logError(e, 'Vosk extension: failed to run systemctl command');
        }
    }

    _refreshStatus() {
        try {
            const [, out] = GLib.spawn_command_line_sync(`systemctl --user is-active ${SERVICE_NAME}`);
            const state = ByteArray.toString(out).trim();
            if (state === 'active') {
                this._statusItem.label.text = this._('Service: running');
                this._icon.set_style('color: #22c55e;');
            } else {
                this._statusItem.label.text = this._('Service: stopped');
                this._icon.set_style('color: #ef4444;');
            }
        } catch (e) {
            this._statusItem.label.text = this._('Service: unknown');
            this._icon.set_style('color: #ef4444;');
            logError(e, 'Vosk extension: failed to refresh service status');
        }
    }

    destroy() {
        if (this._statusRefreshId) {
            GLib.source_remove(this._statusRefreshId);
            this._statusRefreshId = 0;
        }
        super.destroy();
    }
});

export default class VoskExtension extends Extension {
    enable() {
        this._indicator = new VoskIndicator(this);
        Main.panel.addToStatusArea(this.uuid, this._indicator);
    }

    disable() {
        if (this._indicator) {
            this._indicator.destroy();
            this._indicator = null;
        }
    }
}
