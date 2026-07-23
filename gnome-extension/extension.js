/**
 * Vosk CLI Dictation — GNOME Shell Extension
 * iOS-style floating overlay: waveform bars, live text, compositor injection.
 *
 * Press the keyboard shortcut (default Super+F8, configurable in Settings)
 * or click the panel mic icon to start / stop dictation.
 * A native pill overlay appears at the bottom of the screen showing
 * waveform animation, live partial text, and stop / cancel controls.
 */

import GObject from 'gi://GObject';
import GLib from 'gi://GLib';
import Gio from 'gi://Gio';
import Clutter from 'gi://Clutter';
import St from 'gi://St';
import Meta from 'gi://Meta';
import Shell from 'gi://Shell';

import { Extension } from 'resource:///org/gnome/shell/extensions/extension.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';

// ── D-Bus interface ──────────────────────────────────────────────────────────
const BUS_NAME    = 'org.gnome.Shell.Extensions.VoskDictation';
const OBJECT_PATH = '/org/gnome/Shell/Extensions/VoskDictation';
const DBUS_IFACE_XML = `
<node>
  <interface name="org.gnome.Shell.Extensions.VoskDictation">
    <method name="StartRecording">
      <arg type="s" name="language" direction="in"/>
    </method>
    <method name="StopRecording"/>
    <method name="CancelRecording"/>
    <signal name="StatusChanged">
      <arg type="s" name="status"/>
    </signal>
    <signal name="PartialResult">
      <arg type="s" name="text"/>
    </signal>
    <signal name="TextUpdated">
      <arg type="s" name="text"/>
    </signal>
    <signal name="SessionFinalized">
      <arg type="s" name="text"/>
    </signal>
  </interface>
</node>`;

// ── Overlay widget ───────────────────────────────────────────────────────────
const DictationOverlay = GObject.registerClass(
class DictationOverlay extends St.BoxLayout {

    _init(lang) {
        super._init({
            style_class: 'dictation-overlay',
            vertical: true,
            reactive: true,
        });

        this._waveTimer = null;
        this._wavePhase = 0;

        this.connect('destroy', () => this._cleanupTimer());

        // ── Top row ────────────────────────────────────────────────────
        const topRow = new St.BoxLayout({
            style_class: 'dictation-top-row',
            y_align: Clutter.ActorAlign.CENTER,
        });
        this.add_child(topRow);

        // Waveform bars
        this._waveBox = new St.BoxLayout({ style_class: 'dictation-wave-box' });
        this._waveBars = [];
        for (let i = 0; i < 5; i++) {
            const bar = new St.Widget({ style_class: 'dictation-wave-bar' });
            this._waveBox.add_child(bar);
            this._waveBars.push(bar);
        }
        topRow.add_child(this._waveBox);

        // Status label
        this._statusLabel = new St.Label({
            text: 'Listening\u2026',
            style_class: 'dictation-status',
            y_align: Clutter.ActorAlign.CENTER,
        });
        topRow.add_child(this._statusLabel);

        // Flexible spacer
        topRow.add_child(new St.Widget({ x_expand: true }));

        // Language toggle buttons
        this._primaryLang = 'en';
        this._secondaryLang = 'fr';
        this._activeLang = (lang || 'fr').toLowerCase();

        this._langBtnEn = new St.Button({
            label: 'EN',
            style_class: this._activeLang === 'en'
                ? 'dictation-lang-btn dictation-lang-active'
                : 'dictation-lang-btn',
            y_align: Clutter.ActorAlign.CENTER,
        });
        this._langBtnFr = new St.Button({
            label: 'FR',
            style_class: this._activeLang === 'fr'
                ? 'dictation-lang-btn dictation-lang-active'
                : 'dictation-lang-btn',
            y_align: Clutter.ActorAlign.CENTER,
        });
        topRow.add_child(this._langBtnEn);
        topRow.add_child(this._langBtnFr);

        // Stop button (■)
        this._stopBtn = new St.Button({
            style_class: 'dictation-stop-btn',
            child: new St.Icon({ icon_name: 'media-playback-stop-symbolic', icon_size: 14 }),
        });
        topRow.add_child(this._stopBtn);

        // Cancel button (✕)
        this._cancelBtn = new St.Button({
            style_class: 'dictation-cancel-btn',
            child: new St.Icon({ icon_name: 'window-close-symbolic', icon_size: 12 }),
        });
        topRow.add_child(this._cancelBtn);

        // ── Live text area ─────────────────────────────────────────────
        this._textBox = new St.BoxLayout({
            style_class: 'dictation-text-box',
            vertical: false,
            visible: false,
        });
        this.add_child(this._textBox);

        // Confirmed (stable) text
        this._confirmedLabel = new St.Label({
            text: '',
            style_class: 'dictation-confirmed',
            x_expand: true,
        });
        this._confirmedLabel.clutter_text.line_wrap = true;
        this._textBox.add_child(this._confirmedLabel);

        // Partial (unstable) text shown in lighter italic
        this._partialLabel = new St.Label({
            text: '',
            style_class: 'dictation-partial',
        });
        this._partialLabel.clutter_text.line_wrap = true;
        this._textBox.add_child(this._partialLabel);

        this._startWave();
    }

    get stopButton()    { return this._stopBtn; }
    get cancelButton()  { return this._cancelBtn; }
    get langBtnEn()     { return this._langBtnEn; }
    get langBtnFr()     { return this._langBtnFr; }
    get activeLang()    { return this._activeLang; }

    selectLang(lang) {
        this._activeLang = lang;
        this._langBtnEn.style_class = lang === 'en'
            ? 'dictation-lang-btn dictation-lang-active'
            : 'dictation-lang-btn';
        this._langBtnFr.style_class = lang === 'fr'
            ? 'dictation-lang-btn dictation-lang-active'
            : 'dictation-lang-btn';
    }

    // ── Waveform animation ────────────────────────────────────────────
    _startWave() {
        if (this._waveTimer !== null) return;
        const phases = [0, 0.7, 1.4, 2.1, 2.8];
        this._waveTimer = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 80, () => {
            this._wavePhase += 0.25;
            this._waveBars.forEach((bar, i) => {
                const h = Math.round(4 + 16 * (0.5 + 0.5 * Math.sin(this._wavePhase + phases[i])));
                bar.set_height(h);
            });
            return GLib.SOURCE_CONTINUE;
        });
    }

    _stopWave() {
        if (this._waveTimer !== null) {
            GLib.source_remove(this._waveTimer);
            this._waveTimer = null;
        }
        if (this._waveBars) this._waveBars.forEach(bar => bar.set_height(4));
    }

    // ── Text update ────────────────────────────────────────────────────
    updateText(confirmed, partial) {
        const hasConfirmed = (confirmed || '').trim() !== '';
        const hasPartial   = (partial   || '').trim() !== '';

        this._confirmedLabel.text = confirmed || '';
        this._partialLabel.text   = partial ? ` ${partial}\u2026` : '';

        const hadText = this._textBox.visible;
        const hasText = hasConfirmed || hasPartial;
        this._textBox.visible = hasText;

        // Switch between pill and card border-radius
        if (hasText && !hadText)
            this.add_style_class_name('dictation-overlay-card');
        else if (!hasText && hadText)
            this.remove_style_class_name('dictation-overlay-card');
    }

    // ── Status ─────────────────────────────────────────────────────────
    setStatus(status) {
        switch (status) {
        case 'recording':
        case 'Status: recording':
            this._statusLabel.text = 'Listening\u2026';
            this._startWave();
            break;
        case 'processing':
            this._statusLabel.text = 'Processing\u2026';
            this._stopWave();
            break;
        case 'paused':
        case 'Status: paused':
            this._statusLabel.text = 'Paused';
            this._stopWave();
            break;
        case 'idle':
        case 'Status: idle':
            this._statusLabel.text = 'Ready';
            this._stopWave();
            break;
        }
    }

    _cleanupTimer() {
        if (this._waveTimer !== null) {
            GLib.source_remove(this._waveTimer);
            this._waveTimer = null;
        }
        this._waveBars = null;
    }
});

// ── Extension ────────────────────────────────────────────────────────────────
export default class VoskExtension extends Extension {

    enable() {
        this._settings      = this.getSettings();
        this._recording     = false;
        this._proxy         = null;
        this._proxySignals  = [];
        this._busWatchId    = 0;
        this._overlay       = null;
        this._confirmedText = '';
        this._partialText   = '';
        this._injectedLen   = 0;
        this._indicator     = null;
        this._indicatorIcon = null;

        this._addIndicator();
        this._registerShortcut();
        this._watchService();
    }

    disable() {
        Main.wm.removeKeybinding('dictation-trigger');

        this._indicator?.destroy();
        this._indicator     = null;
        this._indicatorIcon = null;

        if (this._busWatchId) {
            Gio.bus_unwatch_name(this._busWatchId);
            this._busWatchId = 0;
        }
        for (const id of this._proxySignals)
            this._proxy?.disconnectSignal(id);
        this._proxySignals = [];
        this._proxy = null;

        this._hideOverlay(false);
    }

    // ── Panel indicator ───────────────────────────────────────────────
    _addIndicator() {
        this._indicator = new PanelMenu.Button(0.0, 'Vosk Dictation', false);
        this._indicatorIcon = new St.Icon({
            icon_name: 'audio-input-microphone-symbolic',
            style_class: 'system-status-icon dictation-indicator',
        });
        this._indicator.add_child(this._indicatorIcon);
        // Primary click: toggle dictation (suppress the popup menu)
        this._indicator.connect('button-press-event', (_actor, event) => {
            if (event.get_button() === 1) {
                this._indicator.menu.close();
                this._toggleDictation();
                return Clutter.EVENT_STOP;
            }
            return Clutter.EVENT_PROPAGATE;
        });
        Main.panel.addToStatusArea(this.uuid, this._indicator);
    }

    // ── Keyboard shortcut ─────────────────────────────────────────────
    _registerShortcut() {
        Main.wm.addKeybinding(
            'dictation-trigger',
            this.getSettings(),
            Meta.KeyBindingFlags.NONE,
            Shell.ActionMode.ALL,
            () => this._toggleDictation()
        );
    }

    // ── D-Bus service watch ───────────────────────────────────────────
    _watchService() {
        this._busWatchId = Gio.bus_watch_name(
            Gio.BusType.SESSION,
            BUS_NAME,
            Gio.BusNameWatcherFlags.NONE,
            () => this._initProxy(),
            () => {
                for (const id of this._proxySignals)
                    this._proxy?.disconnectSignal(id);
                this._proxySignals = [];
                this._proxy = null;
            }
        );
    }

    _initProxy() {
        const VoskProxy = Gio.DBusProxy.makeProxyWrapper(DBUS_IFACE_XML);
        this._proxy = new VoskProxy(
            Gio.DBus.session, BUS_NAME, OBJECT_PATH,
            (proxy, err) => {
                if (err) {
                    console.error(`[Vosk] D-Bus proxy error: ${err.message}`);
                    return;
                }
                this._proxySignals = [
                    proxy.connectSignal('StatusChanged',    (_p, _s, [s]) => this._onStatus(s)),
                    proxy.connectSignal('PartialResult',    (_p, _s, [t]) => this._onPartial(t)),
                    proxy.connectSignal('TextUpdated',      (_p, _s, [t]) => this._onTextUpdated(t)),
                    proxy.connectSignal('SessionFinalized', (_p, _s, [t]) => this._onFinalized(t)),
                ];
            }
        );
    }

    // ── Dictation control ─────────────────────────────────────────────
    _toggleDictation() {
        if (!this._proxy) {
            Main.notifyError('Vosk Dictation', 'Service not ready — is vosk-cli-dictation.service running?');
            return;
        }
        if (this._recording)
            this._stopDictation();
        else
            this._startDictation();
    }

    _startDictation() {
        const lang = this._settings.get_string('selected-language') || 'fr';
        this._recording     = true;
        this._confirmedText = '';
        this._partialText   = '';
        this._injectedLen   = 0;
        this._showOverlay(lang);
        if (this._indicatorIcon)
            this._indicatorIcon.add_style_class_name('dictation-indicator-active');
        this._proxy.StartRecordingAsync(lang).catch(e =>
            console.error(`[Vosk] StartRecording: ${e.message}`));
    }

    _stopDictation() {
        if (this._overlay) this._overlay.setStatus('processing');
        this._proxy?.StopRecordingAsync().catch(() => {});
    }

    _cancelDictation() {
        this._recording = false;
        this._proxy?.CancelRecordingAsync().catch(() => {});
        this._hideOverlay(true);
        if (this._indicatorIcon)
            this._indicatorIcon.remove_style_class_name('dictation-indicator-active');
    }

    // ── D-Bus signal handlers ─────────────────────────────────────────
    _onStatus(status) {
        if (this._overlay) this._overlay.setStatus(status);
    }

    _onPartial(text) {
        this._partialText = text;
        this._updateOverlayText();
    }

    _onTextUpdated(text) {
        this._confirmedText = text;
        this._partialText   = '';
        this._updateOverlayText();
        // Stream confirmed delta directly into the focused window
        const delta = text.slice(this._injectedLen);
        if (delta) {
            this._streamText(delta);
            this._injectedLen = text.length;
        }
    }

    _onFinalized(text) {
        this._recording = false;
        // Inject any remaining text not yet streamed
        const delta = (text || '').slice(this._injectedLen);
        this._injectedLen = 0;
        this._hideOverlay(true);
        if (this._indicatorIcon)
            this._indicatorIcon.remove_style_class_name('dictation-indicator-active');
        if (delta)
            this._streamText(delta);
        else if (!text || !text.trim())
            Main.notify('Vosk Dictation', 'No speech detected.');
    }

    _updateOverlayText() {
        if (!this._overlay) return;
        this._overlay.updateText(this._confirmedText, this._partialText);
        this._positionOverlay();  // reposition after height change
    }

    // ── Text injection (wl-copy → clipboard, then Ctrl+V via virtual keyboard) ────
    _streamText(text) {
        if (!text) return;
        try {
            // 1. Write delta to clipboard
            const proc = Gio.Subprocess.new(
                ['wl-copy', '--', text],
                Gio.SubprocessFlags.NONE
            );
            // 2. After clipboard is set, simulate Ctrl+V into the focused window
            proc.wait_async(null, (p, res) => {
                try {
                    p.wait_finish(res);
                } catch (_) {}
                try {
                    const seat = Clutter.get_default_backend().get_default_seat();
                    const vkbd = seat.create_virtual_device(
                        Clutter.InputDeviceType.KEYBOARD_DEVICE);
                    const t = global.get_current_time();
                    vkbd.notify_keyval(t, Clutter.KEY_Control_L, Clutter.KeyState.PRESSED);
                    vkbd.notify_keyval(t, Clutter.KEY_v,         Clutter.KeyState.PRESSED);
                    vkbd.notify_keyval(t, Clutter.KEY_v,         Clutter.KeyState.RELEASED);
                    vkbd.notify_keyval(t, Clutter.KEY_Control_L, Clutter.KeyState.RELEASED);
                } catch (e) {
                    console.error(`[Vosk] virtual keyboard failed: ${e.message}`);
                }
            });
        } catch (e) {
            console.error(`[Vosk] wl-copy failed: ${e.message}`);
        }
    }

    // ── Overlay management ────────────────────────────────────────────
    _switchLang(lang) {
        this._settings.set_string('selected-language', lang);
        if (this._overlay) this._overlay.selectLang(lang);
        this._proxy?.SwitchLanguageAsync(lang).catch(() => {});
    }

    _showOverlay(lang) {
        this._hideOverlay(false);
        this._overlay = new DictationOverlay(lang);
        this._overlay.stopButton.connect('clicked',   () => this._stopDictation());
        this._overlay.cancelButton.connect('clicked', () => this._cancelDictation());
        this._overlay.langBtnEn.connect('clicked', () => this._switchLang('en'));
        this._overlay.langBtnFr.connect('clicked', () => this._switchLang('fr'));
        Main.uiGroup.add_child(this._overlay);
        this._positionOverlay();
        this._overlay.opacity = 0;
        this._overlay.ease({
            opacity: 255,
            duration: 180,
            mode: Clutter.AnimationMode.EASE_OUT_QUAD,
        });
    }

    _positionOverlay() {
        if (!this._overlay) return;
        const monitor = Main.layoutManager.primaryMonitor;
        if (!monitor) return;
        this._overlay.ensure_style();
        const [, natW] = this._overlay.get_preferred_width(-1);
        const [, natH] = this._overlay.get_preferred_height(-1);
        const w = natW || 400;
        const h = natH || 56;
        this._overlay.set_position(
            monitor.x + Math.round((monitor.width - w) / 2),
            monitor.y + monitor.height - h - 80
        );
    }

    _hideOverlay(animate) {
        if (!this._overlay) return;
        const overlay = this._overlay;
        this._overlay = null;
        if (!animate) { overlay.destroy(); return; }
        overlay.ease({
            opacity: 0,
            duration: 180,
            mode: Clutter.AnimationMode.EASE_IN_QUAD,
            onComplete: () => overlay.destroy(),
        });
    }
}


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
