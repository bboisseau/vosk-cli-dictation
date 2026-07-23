# src/keyboard_listener.py

import queue
import time
from pynput.keyboard import GlobalHotKeys, Listener
from config.config import config
from src.i18n import get_translation


def keyboard_listener_thread(control_queue: queue.Queue, stop_event):
    """
    Thread function that listens for pre-defined global hotkeys.
    """
    _ = get_translation()

    def on_toggle():
        """Callback for the toggle recording hotkey."""
        control_queue.put('TOGGLE_RECORDING')

    def on_finalize():
        """Callback for the finalize session hotkey."""
        control_queue.put('FINALIZE_SESSION')

    actions = {
        'toggle_recording': on_toggle,
        'finalize_session': on_finalize,
    }

    def format_hotkey_string(keys: list) -> str:
        formatted_keys = [f'<{k}>' if len(k) > 1 else k for k in keys]
        return '+'.join(formatted_keys)

    hotkeys_to_listen = {}
    for action, hotkey_config in config.hotkeys.items():
        if action in actions:
            try:
                pynput_keys = hotkey_config.get('pynput_keys', [])
                if pynput_keys:
                    hotkey_string = format_hotkey_string(pynput_keys)
                    hotkeys_to_listen[hotkey_string] = actions[action]
            except (TypeError, KeyError, AttributeError) as e:
                print(f"{config.color_error}Could not create hotkey for action '{action}': {e}{config.RESET}")

    hotkey_listener = None
    if hotkeys_to_listen:
        hotkey_listener = GlobalHotKeys(hotkeys_to_listen)
        hotkey_listener.start()

    tap_listener = None
    tap_cfg = config.double_tap_toggle
    if tap_cfg.get('enabled', False):
        target_key = str(tap_cfg.get('key', 'ctrl_l')).lower()
        interval_ms = int(tap_cfg.get('max_interval_ms', 350))
        tap_count = int(tap_cfg.get('tap_count', 2))
        tap_count = max(1, min(3, tap_count))
        max_interval_s = max(0.05, interval_ms / 1000.0)

        state = {
            'last_release_at': 0.0,
            'count': 0,
        }

        def key_name(key) -> str | None:
            name = getattr(key, 'name', None)
            if name:
                return str(name).lower()
            return None

        def on_release(key):
            name = key_name(key)
            if name != target_key:
                return

            now = time.monotonic()
            if state['count'] == 0 or now - state['last_release_at'] > max_interval_s:
                state['count'] = 1
            else:
                state['count'] += 1

            state['last_release_at'] = now

            if state['count'] >= tap_count:
                control_queue.put('TOGGLE_RECORDING')
                state['count'] = 0
                state['last_release_at'] = 0.0

        tap_listener = Listener(on_release=on_release)
        tap_listener.start()

    if not hotkeys_to_listen and not tap_cfg.get('enabled', False):
        print(f"{config.color_warning}No valid hotkeys found in configuration. Keyboard listener will not run.{config.RESET}")
        return

    stop_event.wait()

    if hotkey_listener:
        hotkey_listener.stop()
    if tap_listener:
        tap_listener.stop()
