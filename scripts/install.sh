#!/bin/sh
set -eu

ADE_PACKAGE="${ADE_PACKAGE:-github:woosal1337/ade}"
MIN_NODE=22

fail() {
  printf 'ade install: %s\n' "$1" >&2
  exit 1
}

install_ade() {
  case "$ADE_PACKAGE" in
  *.tgz | *.tar.gz | *.tar)
    npm install -g "$ADE_PACKAGE"
    return
    ;;
  esac
  source_spec=$ADE_PACKAGE
  if [ -d "$source_spec" ]; then
    source_spec=$(cd "$source_spec" && pwd)
  fi
  work=$(mktemp -d)
  status=0
  (cd "$work" && npm pack "$source_spec" --pack-destination "$work" --loglevel=error >/dev/null) ||
    status=1
  tarball=""
  for file in "$work"/*.tgz; do
    if [ -f "$file" ]; then
      tarball=$file
    fi
  done
  if [ "$status" -eq 0 ] && [ -n "$tarball" ]; then
    npm install -g "$tarball" || status=1
  else
    status=1
  fi
  rm -rf "$work"
  return "$status"
}

command -v node >/dev/null 2>&1 ||
  fail "Node.js ${MIN_NODE} or later is not installed. Install it from https://nodejs.org, then run this script again."
major=$(node -p 'process.versions.node.split(".")[0]')
[ "$major" -ge "$MIN_NODE" ] ||
  fail "Node.js $(node --version) is too old. Install Node.js ${MIN_NODE} or later."
command -v npm >/dev/null 2>&1 || fail "npm is not installed."

if [ "${ADE_SKIP_INSTALL:-0}" != "1" ]; then
  printf 'Installing ade from %s\n' "$ADE_PACKAGE"
  install_ade || fail "npm could not build and install ${ADE_PACKAGE}. Make sure that Git is installed."
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
