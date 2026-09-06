#!/usr/bin/env bash
# Exports the iOS bundle and greps it for names of non-public env keys and
# common secret shapes. Fails on any hit.
set -euo pipefail
cd "$(dirname "$0")/.."
out="$(mktemp -d)"; trap 'rm -rf "$out"' EXIT
pnpm exec expo export --platform ios --output-dir "$out" >/dev/null
# Prefer the Hermes bytecode bundle over a plain JS bundle, sorted for a
# deterministic pick when more than one candidate exists.
bundle="$(find "$out" -name '*.hbc' | sort | head -1)"
if [ -z "$bundle" ]; then
  bundle="$(find "$out" -name '*.js' | sort | head -1)"
fi
[ -n "$bundle" ] || { echo "no bundle found under $out" >&2; exit 1; }
# Non-public key names: any UPPER_SNAKE token in .env.example (commented or
# not) that isn't EXPO_PUBLIC_*-prefixed. This catches uncommented `KEY=`
# lines as well as commented build-time keys like `# APP_VARIANT=... OTA_ENABLED=...`
# and prose mentions such as `# APP_VERSION / APP_BUILD_NUMBER are set by CI.`
keys="$(grep -oE '\b[A-Z][A-Z0-9]*(_[A-Z0-9]+)+\b' .env.example | sort -u | grep -vE '^EXPO_PUBLIC_' || true)"
status=0
for k in $keys; do
  if strings "$bundle" | grep -q "$k"; then echo "non-public key name '$k' found in bundle" >&2; status=1; fi
done
if strings "$bundle" | grep -qE 'sk_live_|-----BEGIN (RSA |EC )?PRIVATE KEY|AIza[0-9A-Za-z_-]{30,}'; then
  echo "secret-shaped string found in bundle" >&2; status=1
fi
[ $status -eq 0 ] && echo "bundle secrets check ok"
exit $status
