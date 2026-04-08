# src/keyboard_listener.py

import queue
import time
from pynput.keyboard import GlobalHotKeys, Listener
from config.config import config
from src.i18n import get_translation

def keyboard_listener_thread(control_queue: queue.Queue, stop_event):
    """
    Thread function that listens for pre-defined global hotkeys.
    FINAL CORRECTION: This version uses pynput.keyboard.GlobalHotKeys,
    which is the correct class for listening to a dictionary of hotkeys.
    """
    _ = get_translation()

    def on_toggle():
        """Callback for the toggle recording hotkey."""
        control_queue.put('TOGGLE_RECORDING')

    def on_finalize():
        """Callback for the finalize session hotkey."""
        control_queue.put('FINALIZE_SESSION')

    # Map action names from the config file to their callback functions.
    actions = {
        'toggle_recording': on_toggle,
        'finalize_session': on_finalize,
    }

    def format_hotkey_string(keys: list) -> str:
        """
        Formats a list of key names into a string that pynput can parse.
        Example: ['alt_l', 'h'] -> '<alt_l>+h'
        """
        # A key name is considered a "special" key if its name is longer than one character.
        # These need to be wrapped in angle brackets.
        formatted_keys = [f'<{k}>' if len(k) > 1 else k for k in keys]
        return "+".join(formatted_keys)

    # Dynamically build the hotkeys dictionary for the listener.
    # The format required by GlobalHotKeys is {'<key_combo>': callback_function}
    hotkeys_to_listen = {}
    for action, hotkey_config in config.hotkeys.items():
        if action in actions:
            try:
                # pynput_keys is a list from config, e.g., ['alt_l', 'h']
                pynput_keys = hotkey_config.get('pynput_keys', [])
                if pynput_keys:
                    hotkey_string = format_hotkey_string(pynput_keys)
                    hotkeys_to_listen[hotkey_string] = actions[action]
            except (TypeError, KeyError, AttributeError) as e:
                # This handles cases where config might be malformed.
                print(f"{config.RED}Could not create hotkey for action '{action}': {e}{config.RESET}")

    hotkey_listener = None
    if hotkeys_to_listen:
        # Create and run the listener with the defined hotkeys.
        # GlobalHotKeys runs in its own thread.
        hotkey_listener = GlobalHotKeys(hotkeys_to_listen)
        hotkey_listener.start()

    double_tap_listener = None
    double_tap_cfg = config.double_tap_toggle
    if double_tap_cfg.get('enabled', False):
        target_key = str(double_tap_cfg.get('key', 'ctrl_l')).lower()
        interval_ms = int(double_tap_cfg.get('max_interval_ms', 350))
        max_interval_s = max(0.05, interval_ms / 1000.0)
        state = {
            'last_release_at': 0.0,
        }

        def key_name(key) -> str | None:
            # pynput Key instances expose a name attribute for non-character keys.
            name = getattr(key, 'name', None)
            if name:
                return str(name).lower()
            return None

        def on_release(key):
            name = key_name(key)
            if name != target_key:
                return
            now = time.monotonic()
            if 0 < now - state['last_release_at'] <= max_interval_s:
                control_queue.put('TOGGLE_RECORDING')
                state['last_release_at'] = 0.0
                return
            state['last_release_at'] = now

        double_tap_listener = Listener(on_release=on_release)
        double_tap_listener.start()

    if not hotkeys_to_listen and not double_tap_cfg.get('enabled', False):
        print(f"{config.YELLOW}No valid hotkeys found in configuration. Keyboard listener will not run.{config.RESET}")
        return

    # The main part of this thread will now block here until the main program
    # sets the stop_event, indicating it's time to shut down.
    stop_event.wait()

    # Stop the listener thread when the program is exiting.
    if hotkey_listener:
        hotkey_listener.stop()
    if double_tap_listener:
        double_tap_listener.stop()
