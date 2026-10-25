#!/usr/bin/env bash
set -euo pipefail
repo_dir=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)
: "${DOCK_INPUT_TEST_SCREEN:?Set DOCK_INPUT_TEST_SCREEN to a disposable compositor output}"
shell_dir=${OMARCHY_SHELL_DIR:-/usr/share/omarchy/shell}
test_dir=$(mktemp -d /tmp/dock-input-test.XXXXXX)
trap 'rm -rf -- "$test_dir"' EXIT
cp -- "$repo_dir/WindowPreview.qml" "$repo_dir/WindowPreviewPanel.qml" "$test_dir/"
cp -- "$repo_dir/tests/preview-input.qml" "$test_dir/shell.qml"
ln -s -- "$shell_dir/Commons" "$test_dir/Commons"
ln -s -- "$shell_dir/Ui" "$test_dir/Ui"
ln -s -- "$repo_dir/i18n" "$test_dir/i18n"
timeout 12 qs -p "$test_dir" --no-color > "$test_dir/output.log" 2>&1 || true
cat -- "$test_dir/output.log"
rg -q 'DOCK_INPUT_TEST_PASS' "$test_dir/output.log"
if rg -q 'DOCK_INPUT_TEST_FAIL' "$test_dir/output.log"; then exit 1; fi
