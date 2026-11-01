#!/bin/sh
# Gives the browsers an audio output on a Linux host that has no sound card, such as a container or a CI runner: a PulseAudio
# server with a sink that plays to nowhere. Install the package `pulseaudio` first. Run `REQUIRE_AUDIO=1 pnpm test:browser`
# after it, so that a test that needs audio fails, and does not skip, when the output is missing.
set -eu
pulseaudio --start --exit-idle-time=-1 --log-target=stderr
pactl load-module module-null-sink sink_name=assesskit sink_properties=device.description=assesskit >/dev/null
pactl set-default-sink assesskit
