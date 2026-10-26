#!/bin/sh
# Linux native messaging launcher (the counterpart of native-host.exe on
# Windows). Browsers start this script and speak the length-prefixed JSON
# protocol on stdin/stdout; exec replaces the shell so the byte framing
# passes through unchanged, exactly like the C# relay on Windows.
set -eu
folder=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
runtime=$(tr -d '\r\n' < "$folder/runtime-path.txt")
exec env ELECTRON_RUN_AS_NODE=1 "$runtime" "$folder/native-host.cjs"
