import fcntl
import os
import queue
import subprocess
import threading
import time
import tkinter as tk
from tkinter import ttk

import pyperclip


_HUD_INSTANCE_LOCK = threading.Lock()
_HUD_STARTED = False


def _read_clipboard_text() -> str:
    """Best-effort clipboard read that works on Wayland setups."""
    try:
        return pyperclip.paste() or ''
    except Exception:
        pass

    try:
        result = subprocess.run(
            ['wl-paste', '--no-newline'],
            check=True,
            capture_output=True,
            text=True,
        )
        return result.stdout or ''
    except Exception:
        return ''


def _close_existing_hud_windows() -> None:
    """Best-effort cleanup of stale HUD windows from previous runs."""
    try:
        result = subprocess.run(
            ['xdotool', 'search', '--name', 'Vosk Dictation HUD'],
            check=False,
            capture_output=True,
            text=True,
        )
        window_ids = [line.strip() for line in result.stdout.splitlines() if line.strip()]
        for wid in window_ids:
            subprocess.run(['xdotool', 'windowclose', wid], check=False, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    except Exception:
        pass


def run_hud_overlay(event_queue: queue.Queue, stop_event: threading.Event):
    """Floating dictation HUD with live text and language switch.

    The HUD is intentionally lightweight: a top-most small window with
    a status line, live transcript preview, and language picker.
    """

    global _HUD_STARTED
    with _HUD_INSTANCE_LOCK:
        if _HUD_STARTED:
            return
        _HUD_STARTED = True

    _close_existing_hud_windows()

    lock_path = '/tmp/vosk_dictation_hud.lock'
    try:
        lock_file = open(lock_path, 'w')
        fcntl.flock(lock_file.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
        lock_file.write(str(os.getpid()))
        lock_file.flush()
    except Exception:
        # Another HUD instance is already running.
        with _HUD_INSTANCE_LOCK:
            _HUD_STARTED = False
        return

    root = tk.Tk()
    root.title('Vosk Dictation HUD')
    root.attributes('-topmost', True)
    root.geometry('420x180+30+30')
    root.minsize(360, 140)

    status_var = tk.StringVar(value='Status: idle')
    lang_var = tk.StringVar(value='fr')

    frame = ttk.Frame(root, padding=10)
    frame.pack(fill='both', expand=True)

    top_row = ttk.Frame(frame)
    top_row.pack(fill='x')

    ttk.Label(top_row, textvariable=status_var).pack(side='left')

    lang_box = ttk.Combobox(
        top_row,
        textvariable=lang_var,
        values=['fr', 'en'],
        width=6,
        state='readonly',
    )
    lang_box.pack(side='right', padx=(8, 0))

    ttk.Label(top_row, text='Language').pack(side='right')

    transcript_var = tk.StringVar(value='')
    text_panel = tk.Frame(frame, bg='#101418', height=95)
    text_panel.pack(fill='both', expand=True, pady=(8, 0))
    text_panel.pack_propagate(False)

    transcript_label = tk.Label(
        text_panel,
        textvariable=transcript_var,
        anchor='nw',
        justify='left',
        padx=8,
        pady=8,
        wraplength=390,
        fg='#f3f4f6',
        bg='#101418',
    )
    transcript_label.pack(fill='both', expand=True)

    info_var = tk.StringVar(value='Tip: Alt+H starts/stops, Alt+S finalizes.')
    last_text_value = ''
    last_text_update_ts = time.monotonic()
    ttk.Label(frame, textvariable=info_var).pack(fill='x', pady=(8, 0))

    def set_text(text: str):
        transcript_var.set((text or '')[-700:])

    def apply_language(_event=None):
        selected = lang_var.get().strip() or 'fr'
        try:
            cmd = [
                '/home/bboisseau/vosk-cli-dictation-bboisseau/venv/bin/python3',
                '/home/bboisseau/vosk-cli-dictation-bboisseau/scripts/apply_extension_preferences.py',
                '--language', selected,
                '--shortcut-key', 'alt_l',
                '--tap-type', 'double',
            ]
            subprocess.run(cmd, check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
            subprocess.run(['systemctl', '--user', 'restart', 'vosk-cli-dictation.service'], check=False)
            info_var.set(f'Language switched to {selected}. Service restarting...')
        except Exception:
            info_var.set('Could not switch language from HUD.')

    lang_box.bind('<<ComboboxSelected>>', apply_language)

    def pump_events():
        nonlocal last_text_value, last_text_update_ts
        if stop_event.is_set():
            try:
                root.destroy()
            except Exception:
                pass
            try:
                fcntl.flock(lock_file.fileno(), fcntl.LOCK_UN)
                lock_file.close()
            except Exception:
                pass
            with _HUD_INSTANCE_LOCK:
                _HUD_STARTED = False
            return

        try:
            while True:
                payload = event_queue.get_nowait()
                if not isinstance(payload, dict):
                    continue
                kind = payload.get('type', '')
                if kind == 'status':
                    status_var.set(payload.get('value', 'Status: idle'))
                elif kind == 'text':
                    text_value = payload.get('value', '')
                    last_text_value = text_value
                    last_text_update_ts = time.monotonic()
                    set_text(text_value)
                elif kind == 'language':
                    lang_var.set(payload.get('value', 'fr'))
                elif kind == 'info':
                    info_var.set(payload.get('value', ''))
        except queue.Empty:
            pass
        except Exception:
            # Keep HUD alive even if a malformed event slips through.
            pass

        # Fallback: if events stall, mirror clipboard so dictation remains visible.
        if time.monotonic() - last_text_update_ts > 0.8:
            try:
                clip = _read_clipboard_text()
                if clip and clip != last_text_value:
                    last_text_value = clip
                    set_text(clip[-700:])
            except Exception:
                pass

        root.after(120, pump_events)

    root.after(120, pump_events)

    try:
        root.mainloop()
    except Exception:
        # HUD should never crash dictation service
        pass
    finally:
        try:
            fcntl.flock(lock_file.fileno(), fcntl.LOCK_UN)
            lock_file.close()
        except Exception:
            pass
        with _HUD_INSTANCE_LOCK:
            _HUD_STARTED = False
