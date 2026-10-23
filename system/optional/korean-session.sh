#!/bin/sh
command -v ibus-daemon >/dev/null 2>&1 || exit 0
gsettings set org.freedesktop.ibus.general preload-engines "['hangul', 'xkb:kr::kor']"
gsettings set org.freedesktop.ibus.general.hotkey triggers "['<Shift>space', 'Hangul']"
exec ibus-daemon --daemonize --xim
