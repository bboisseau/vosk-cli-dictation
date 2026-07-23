# src/system_control.py

import os
import shutil
import subprocess
import time

import pyperclip

from config.config import config
from src.i18n import get_translation


def check_command_exists(command: str) -> bool:
    """Checks if an external command is available in the system's PATH."""
    return shutil.which(command) is not None


def is_wayland_session() -> bool:
    return os.environ.get('XDG_SESSION_TYPE', '').lower() == 'wayland'


def get_active_window_id():
    """Retrieves the ID of the currently active window using xdotool."""
    try:
        result = subprocess.run(
            ['xdotool', 'getactivewindow'],
            check=True,
            capture_output=True,
            text=True,
        )
        return result.stdout.strip()
    except (subprocess.CalledProcessError, FileNotFoundError):
        return None


def _type_text_with_xdotool(text: str) -> bool:
    _ = get_translation()
    window_id = get_active_window_id()
    if not window_id:
        print(f"\n{config.color_error}{_('Error: Could not find an active window to type into.')}{config.RESET}")
        return False

    try:
        original_clipboard = pyperclip.paste()
        pyperclip.copy(text)
        time.sleep(0.08)
        subprocess.run(['xdotool', 'key', '--window', window_id, 'ctrl+v'], check=True)
        time.sleep(0.08)
        pyperclip.copy(original_clipboard)
        return True
    except (subprocess.CalledProcessError, FileNotFoundError) as e:
        print(f"\n{config.color_error}{_('An error occurred with xdotool paste method:')} {e}{config.RESET}")
        return False


def _type_text_with_wtype(text: str) -> bool:
    _ = get_translation()
    try:
        subprocess.run(['wtype', text], check=True, stderr=subprocess.DEVNULL, stdout=subprocess.DEVNULL)
        return True
    except (subprocess.CalledProcessError, FileNotFoundError) as e:
        print(f"\n{config.color_error}{_('An error occurred with wtype:')} {e}{config.RESET}")
        return False


def type_text(text: str) -> bool:
    """Simulates typing text. Tries wtype on Wayland, then falls back to xdotool."""
    _ = get_translation()
    if not text:
        return False

    if is_wayland_session() and check_command_exists('wtype'):
        if _type_text_with_wtype(text):
            return True

    ok = _type_text_with_xdotool(text)
    if ok:
        return True

    if is_wayland_session():
        print(
            f"\n{config.color_warning}"
            + _('Typing injection failed on Wayland. On GNOME Wayland this may be restricted. Try an X11 session for full auto-typing.')
            + f"{config.RESET}"
        )

    return False


def press_key(key_name: str, count: int = 1) -> bool:
    """Simulates pressing a key using wtype on Wayland with xdotool fallback."""
    _ = get_translation()

    if is_wayland_session() and check_command_exists('wtype'):
        try:
            for _i in range(max(1, count)):
                subprocess.run(['wtype', '-k', key_name], check=True, stderr=subprocess.DEVNULL, stdout=subprocess.DEVNULL)
            return True
        except (subprocess.CalledProcessError, FileNotFoundError) as e:
            print(f"\n{config.color_error}{_('An error occurred with wtype key press:')} {e}{config.RESET}")

    window_id = get_active_window_id()
    if not window_id:
        print(f"\n{config.color_error}{_('Error: Could not find an active window to press a key.')}{config.RESET}")
        return False

    try:
        command = ['xdotool', 'key', '--window', window_id]
        if count > 1:
            command.extend(['--repeat', str(count), '--delay', '0'])
        command.append(key_name)
        subprocess.run(command, check=True, stderr=subprocess.DEVNULL)
        return True
    except (subprocess.CalledProcessError, FileNotFoundError) as e:
        print(f"\n{config.color_error}{_('An error occurred with xdotool key press:')} {e}{config.RESET}")
        if is_wayland_session() and not check_command_exists('wtype'):
            print(
                f"\n{config.color_warning}"
                + _('Wayland detected. Install wtype for reliable key simulation: sudo apt install wtype wl-clipboard')
                + f"{config.RESET}"
            )
        return False


def play_sound():
    """Plays a system notification sound using paplay if available."""
    if not check_command_exists('paplay') or not config.sound_file:
        return

    try:
        subprocess.run(
            ['paplay', config.sound_file],
            check=True,
            stderr=subprocess.DEVNULL,
            stdout=subprocess.DEVNULL,
        )
    except (subprocess.CalledProcessError, FileNotFoundError):
        pass
