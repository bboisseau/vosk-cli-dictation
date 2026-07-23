#!/usr/bin/env python3

import argparse
import pathlib
import sys
import yaml

ROOT = pathlib.Path(__file__).resolve().parents[1]
CONFIG_PATH = ROOT / 'config' / 'config.yaml'


def main() -> int:
    parser = argparse.ArgumentParser(description='Apply GNOME extension preferences to config.yaml')
    parser.add_argument('--language', choices=['en', 'fr'], required=True)
    parser.add_argument('--shortcut-key', required=True)
    parser.add_argument('--tap-type', choices=['single', 'double', 'triple'], required=True)
    args = parser.parse_args()

    with CONFIG_PATH.open('r', encoding='utf-8') as f:
        data = yaml.safe_load(f) or {}

    data['default_model'] = args.language

    tap_count_map = {
        'single': 1,
        'double': 2,
        'triple': 3,
    }
    tap_count = tap_count_map[args.tap_type]

    section = data.get('double_tap_toggle')
    if not isinstance(section, dict):
        section = {}
    section['enabled'] = True
    section['key'] = args.shortcut_key
    section['tap_count'] = tap_count
    section.setdefault('max_interval_ms', 350)
    data['double_tap_toggle'] = section

    with CONFIG_PATH.open('w', encoding='utf-8') as f:
        yaml.safe_dump(data, f, sort_keys=False, allow_unicode=True)

    print(f'Applied prefs: language={args.language}, shortcut={args.shortcut_key}, tap_type={args.tap_type}')
    return 0


if __name__ == '__main__':
    sys.exit(main())
