#!/usr/bin/env sh
set -eu

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
TMP_DIR="$SCRIPT_DIR/.tmp-run"
VENV_DIR="$SCRIPT_DIR/.venv"
PYTHON=${PYTHON:-python3}

rm -rf "$TMP_DIR"
mkdir -p "$TMP_DIR"

if ! "$PYTHON" - <<'PY' >/dev/null 2>&1
import docx
PY
then
  if [ ! -x "$VENV_DIR/bin/python" ]; then
    rm -rf "$VENV_DIR"
    "$PYTHON" -m venv "$VENV_DIR"
  fi
  "$VENV_DIR/bin/python" - <<'PY' >/dev/null 2>&1 || "$VENV_DIR/bin/python" -m pip install --quiet python-docx
import docx
PY
  PY="$VENV_DIR/bin/python"
else
  PY="$PYTHON"
fi

"$PY" "$SCRIPT_DIR/prototype.py"
