#!/bin/sh
# Gives the browsers an audio output on a Linux host that has no sound card, such as a container or a CI runner: a PulseAudio
# server with a sink that plays to nowhere. Chromium and WebKit play without it; Firefox plays only through PulseAudio. Run
# `REQUIRE_AUDIO=1 pnpm test:browser` after it, so that a test that needs audio fails, and does not skip, when the output is
# missing.
#
# Usage: scripts/linux-audio.sh [<folder>]. Where `pulseaudio` is not installed, as in the image of Playwright, it is installed,
# as root, from the packages that the folder keeps; when the folder has none, apt fetches them into it first, each step stopped
# after 240 s and tried three times in all, so that a cache of the folder fetches them once.
set -eu
if ! command -v pulseaudio >/dev/null 2>&1; then
  mkdir -p "${1:?pulseaudio is not installed: install it, or give a folder that keeps its packages.}/partial"
  # apt reads a relative folder against its own cache, so the folder is made absolute.
  packages="$(cd "$1" && pwd)"
  if ! ls "$packages"/*.deb >/dev/null 2>&1; then
    fetched=false
    for attempt in 1 2 3; do
      if timeout 240 apt-get update -q && timeout 240 apt-get install -q -y --no-install-recommends --download-only \
        -o Dir::Cache::archives="$packages" pulseaudio; then
        fetched=true
        break
      fi
      echo "The packages of PulseAudio stalled or failed, try $attempt of 3." >&2
    done
    "$fetched"
  fi
  dpkg -i "$packages"/*.deb >/dev/null
fi
pulseaudio --start --exit-idle-time=-1 --log-target=stderr
pactl load-module module-null-sink sink_name=assesskit sink_properties=device.description=assesskit >/dev/null
pactl set-default-sink assesskit
