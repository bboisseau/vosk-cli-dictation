# src/dictation_dbus.py
"""
D-Bus bridge for vosk-cli-dictation.

Runs a GLib main loop in a daemon thread, exposing a D-Bus service at:
  Name:   org.gnome.Shell.Extensions.VoskDictation
  Path:   /org/gnome/Shell/Extensions/VoskDictation

The GNOME Shell extension connects to this to:
  - Call  StartRecording(lang) / StopRecording() / CancelRecording()
  - Watch StatusChanged / PartialResult / TextUpdated / SessionFinalized signals

event_queue message types (published by ui_thread / recognition_thread):
  {'type': 'status',    'value': str}   — 'recording' | 'paused' | 'idle'
  {'type': 'partial',   'value': str}   — current Vosk partial (unstable)
  {'type': 'text',      'value': str}   — accumulated confirmed text so far
  {'type': 'finalized', 'value': str}   — full session text on finalize
"""

import queue
import threading

import gi
gi.require_version('GLib', '2.0')
gi.require_version('Gio', '2.0')
from gi.repository import GLib, Gio

BUS_NAME    = 'org.gnome.Shell.Extensions.VoskDictation'
IFACE_NAME  = BUS_NAME
OBJECT_PATH = '/org/gnome/Shell/Extensions/VoskDictation'

DBUS_XML = f"""
<node>
  <interface name="{IFACE_NAME}">
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
</node>
"""


class DictationDBusBridge:
    """
    Bridges the service's internal queues to the D-Bus session bus.
    Call start() once to spawn the background thread.
    """

    def __init__(self, control_queue: queue.Queue, event_queue: queue.Queue):
        self._control_queue = control_queue
        self._event_queue   = event_queue
        self._conn          = None
        self._reg_id        = 0

    def start(self):
        t = threading.Thread(target=self._run, daemon=True, name='dbus-bridge')
        t.start()

    def _run(self):
        loop = GLib.MainLoop()
        owner_id = Gio.bus_own_name(
            Gio.BusType.SESSION,
            BUS_NAME,
            Gio.BusNameOwnerFlags.NONE,
            lambda conn, name: self._on_bus_acquired(conn),
            lambda *_: None,
            lambda *_: None,
        )
        # Poll event_queue every 100 ms and forward as D-Bus signals
        GLib.timeout_add(100, self._pump)
        loop.run()
        Gio.bus_unown_name(owner_id)

    def _on_bus_acquired(self, connection):
        self._conn = connection
        node_info = Gio.DBusNodeInfo.new_for_xml(DBUS_XML)
        self._reg_id = connection.register_object(
            OBJECT_PATH,
            node_info.interfaces[0],
            self._on_method_call,
            None,
            None,
        )

    def _on_method_call(self, conn, sender, path, iface, method, params, invocation):
        if method == 'StartRecording':
            self._control_queue.put('TOGGLE_RECORDING')
            invocation.return_value(None)
        elif method == 'StopRecording':
            self._control_queue.put('FINALIZE_SESSION')
            invocation.return_value(None)
        elif method == 'CancelRecording':
            self._control_queue.put('/cancel')
            invocation.return_value(None)
        else:
            invocation.return_dbus_error(
                'org.freedesktop.DBus.Error.UnknownMethod',
                f'Unknown method: {method}',
            )

    def _pump(self) -> bool:
        if not self._conn or not self._reg_id:
            return GLib.SOURCE_CONTINUE
        try:
            while True:
                event = self._event_queue.get_nowait()
                kind  = event.get('type', '')
                value = event.get('value', '')
                if kind == 'status':
                    self._emit('StatusChanged', value)
                elif kind == 'partial':
                    self._emit('PartialResult', value)
                elif kind == 'text':
                    self._emit('TextUpdated', value)
                elif kind == 'finalized':
                    self._emit('SessionFinalized', value)
        except queue.Empty:
            pass
        return GLib.SOURCE_CONTINUE

    def _emit(self, signal: str, value: str):
        try:
            self._conn.emit_signal(
                None, OBJECT_PATH, IFACE_NAME,
                signal, GLib.Variant('(s)', (value,)),
            )
        except Exception:
            pass
