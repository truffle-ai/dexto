#!/bin/sh
# End-to-end check of scripts/install.sh against the real npm registry, for clean machines and
# containers in CI. It pipes the installer into sh as `curl -fsSL https://dexto.ai/install | sh`
# does, as the current (non-root) user, then checks the result, a no-op re-run and the installed CLI.
#
#   scripts/test-install-e2e.sh <path to install.sh> <version or dist-tag>
#   scripts/test-install-e2e.sh <path to install.sh> --expect-node-missing

set -eu

installer="$1"
mode="$2"

last_line() {
    tail -n 1 "$1"
}

if [ "${mode}" = "--expect-node-missing" ]; then
    status=0
    sh -s -- --yes <"${installer}" >/tmp/install.out 2>/tmp/install.err || status=$?
    cat /tmp/install.err >&2
    line="$(last_line /tmp/install.out)"
    echo "last line: ${line}"
    [ "${status}" -eq 1 ] || { echo "expected exit 1, got ${status}" >&2; exit 1; }
    case "${line}" in
        '{"error":{"code":"node_missing",'*) ;;
        *) echo "expected a node_missing error line" >&2; exit 1 ;;
    esac
    echo "ok: node_missing reported"
    exit 0
fi

sh -s -- --yes --version "${mode}" <"${installer}" >/tmp/install.out
line="$(last_line /tmp/install.out)"
echo "first run: ${line}"
case "${line}" in
    '{"installed":{"action":"installed",'*) ;;
    *) echo "expected action installed" >&2; exit 1 ;;
esac

version="$(printf '%s' "${line}" | sed -n 's/.*"version":"\([^"]*\)".*/\1/p')"
reported="$("${HOME}/.local/bin/dexto" --version </dev/null)"
echo "dexto --version: ${reported}"
case "${reported}" in
    *"${version}"*) ;;
    *) echo "expected dexto --version to report ${version}" >&2; exit 1 ;;
esac

grep -q '"method": "native"' "${HOME}/.dexto/install.json" ||
    { echo "install.json is missing method native" >&2; exit 1; }

DEXTO_VERSION="${mode}" sh -s -- --yes <"${installer}" >/tmp/install.out
line="$(last_line /tmp/install.out)"
echo "second run: ${line}"
case "${line}" in
    '{"installed":{"action":"unchanged",'*) ;;
    *) echo "expected a no-op second run" >&2; exit 1 ;;
esac

PATH="${HOME}/.local/bin:${PATH}" dexto --help </dev/null >/dev/null
echo "ok: installed ${version}, re-run was a no-op, dexto --help runs"
