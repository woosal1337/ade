#!/bin/sh
set -eu

ADE_PACKAGE="${ADE_PACKAGE:-github:woosal1337/ade}"
MIN_NODE=22

fail() {
  printf 'ade install: %s\n' "$1" >&2
  exit 1
}

command -v node >/dev/null 2>&1 ||
  fail "Node.js ${MIN_NODE} or later is not installed. Install it from https://nodejs.org, then run this script again."
major=$(node -p 'process.versions.node.split(".")[0]')
[ "$major" -ge "$MIN_NODE" ] ||
  fail "Node.js $(node --version) is too old. Install Node.js ${MIN_NODE} or later."
command -v npm >/dev/null 2>&1 || fail "npm is not installed."

if [ "${ADE_SKIP_INSTALL:-0}" != "1" ]; then
  printf 'Installing ade from %s\n' "$ADE_PACKAGE"
  npm install -g "$ADE_PACKAGE" || fail "npm could not install ${ADE_PACKAGE}."
fi

ade_bin=$(command -v ade 2>/dev/null || true)
if [ -z "$ade_bin" ]; then
  ade_bin="$(npm prefix -g)/bin/ade"
fi
[ -x "$ade_bin" ] ||
  fail "The ade command is not on the PATH. Add $(npm prefix -g)/bin to the PATH."
printf 'ade %s\n' "$("$ade_bin" --version)"

if [ "$#" -eq 0 ]; then
  printf 'ade is installed. Next: run ade plan <source>\n'
  exit 0
fi

"$ade_bin" plan "$@" || fail "The plan failed."
if (exec </dev/tty) 2>/dev/null; then
  "$ade_bin" apply "$@" </dev/tty
else
  printf 'No terminal is available for the prompts. Next: run ade apply %s\n' "$*"
fi
