#!/usr/bin/env python3
"""Remove the retired remote-node configuration and reserve the local GPIO UART.

Run as root with --user and --backup. All affected files are retained in the
private backup directory; ordinary SSH, Ethernet and saved Wi-Fi profiles remain.
"""
import argparse
import os
from pathlib import Path
import pwd
import re
import shutil
import subprocess

ap = argparse.ArgumentParser()
ap.add_argument('--user', required=True)
ap.add_argument('--backup', required=True)
ap.add_argument('--uart-only', action='store_true')
args = ap.parse_args()
if os.geteuid() != 0:
    raise SystemExit('Run as root')
account = pwd.getpwnam(args.user)
home = Path(account.pw_dir)
backup = Path(args.backup)
backup.mkdir(mode=0o700, parents=True, exist_ok=True)
backup.chmod(0o700)

def save(path):
    path = Path(path)
    if path.exists() or path.is_symlink():
        dest = backup / path.relative_to('/')
        dest.parent.mkdir(parents=True, exist_ok=True)
        if not dest.exists():
            shutil.copy2(path, dest, follow_symlinks=False)

def retire(path):
    path = Path(path)
    if path.exists() or path.is_symlink():
        save(path)
        path.unlink()

def command(*cmd, check=True):
    return subprocess.run(cmd, text=True, capture_output=True, check=check)

# Preserve UART hardware; remove only login/boot-console ownership of this port.
cmdline = Path('/boot/firmware/cmdline.txt')
save(cmdline)
words = cmdline.read_text().split()
cmdline.write_text(' '.join(w for w in words if not re.fullmatch(r'console=(serial0|ttyS0|ttyAMA0),\S+', w)) + '\n')
port = Path('/dev/serial0').resolve().name
if port in ('ttyS0', 'ttyAMA0'):
    unit = f'serial-getty@{port}.service'
    save('/etc/systemd/system/' + unit)
    command('systemctl', 'mask', '--now', unit)
print('UART login console removed:', port)
if args.uart_only:
    raise SystemExit(0)

command('systemctl', 'disable', '--now', 'colony-direct-ap.service', check=False)
for path in ['/etc/systemd/system/colony-direct-ap.service',
             '/etc/NetworkManager/conf.d/90-colony-direct.conf',
             '/etc/hostapd/colony-direct.conf']:
    retire(path)
command('systemctl', 'daemon-reload')
profiles = command('nmcli', '-t', '-f', 'UUID,NAME', 'connection', 'show').stdout
for line in profiles.splitlines():
    uuid, _, name = line.partition(':')
    if name == 'colony-direct-ap':
        command('nmcli', 'connection', 'delete', 'uuid', uuid)
# Only the retired AP interface is cleared; the active management Ethernet is untouched.
command('ip', '-4', 'address', 'flush', 'dev', 'wlan0')
command('nmcli', 'general', 'reload')
command('nmcli', 'device', 'set', 'wlan0', 'managed', 'yes')

config = home / '.ssh/config'
if config.exists():
    save(config)
    blocks = re.split(r'(?im)(?=^Host\s+)', config.read_text())
    kept = []
    for block in blocks:
        match = re.match(r'(?i)Host\s+([^\n]+)', block)
        if match and any(alias in ('colony-zero', 'colony-pi') for alias in match[1].split()):
            # Retain any unrelated aliases sharing this block.
            aliases = [a for a in match[1].split() if a not in ('colony-zero', 'colony-pi')]
            if aliases:
                kept.append('Host ' + ' '.join(aliases) + block[match.end():])
        else:
            kept.append(block)
    config.write_text(''.join(kept))
    os.chown(config, account.pw_uid, account.pw_gid)
    remaining = config.read_text()
    for name in ['id_ed25519_colony_zero', 'id_ed25519_colony_zero.pub', 'known_hosts_colony_zero']:
        if name.replace('.pub', '') not in remaining:
            retire(home / '.ssh' / name)
for name in ['colony-direct-ap.service', 'colony-hostapd.conf', '90-colony-direct.conf']:
    retire(home / name)
for name in ['colony-zero', 'colony-pi', 'verify-colony-link.py', 'pi-agent.py', 'capture-and-transfer.py']:
    retire(home / 'device-setup' / name)
print('Retired Zero AP and SSH settings; backup:', backup)
