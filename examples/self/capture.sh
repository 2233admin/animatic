#!/usr/bin/env bash
# Real footage for the self-demo: the sample film animatic renders from its own scaffold.
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
cli="node $here/../../skills/animatic/scripts/animatic.mjs"
work="$(mktemp -d)"
$cli new "$work/sample" >/dev/null 2>&1
(cd "$work/sample" && $cli render storyboard.json -o "$here/captures/sample.mp4" >/dev/null 2>&1)
echo "captures written to $here/captures"
