#!/usr/bin/env bash
# Shared rules for every security runner. Source it, do not execute it.
#
#   - Output goes to $SECURITY_DIR (default .security), one <job>.sarif each.
#   - A disabled job writes a skipped SARIF and exits 0.
#   - A missing tool is a skip locally and a failure under CI, so "skipped"
#     can never pass for "clean" in the pipeline.
#   - A finding never fails the runner. Only verdict.mjs fails on findings.

sec_out_dir() {
  local dir="${SECURITY_DIR:-.security}"
  mkdir -p "$dir"
  printf '%s' "$dir"
}

# Writes the skipped SARIF for a job and leaves the caller to exit 0.
sec_skip() {
  local job="$1" reason="$2" dir
  dir="$(sec_out_dir)"
  node scripts/security/sarif.mjs skip "$job" "$reason" > "$dir/$job.sarif"
  echo "::notice::$job skipped: $reason"
}

# Exits the runner early when the job is switched off. An invalid setting
# (a malformed security-policy.json, or a SECURITY_* value config.mjs cannot
# parse) must fail the run, never read as "disabled" - the command
# substitution below would otherwise swallow config.mjs's own nonzero exit
# and `[ "" = "true" ]` would silently take the skip branch.
sec_enabled() {
  local job="$1" value
  if ! value="$(node scripts/security/config.mjs get "jobs.$job")"; then
    echo "config.mjs failed resolving jobs.$job - security-policy.json or a SECURITY_* value is invalid (see the error above); that fails the run, it does not disable it" >&2
    exit 1
  fi
  [ "$value" = "true" ] && return 0
  sec_skip "$job" "disabled in security-policy.json or the environment"
  exit 0
}

# A tool the runner cannot work without.
sec_require() {
  local tool="$1" job="$2"
  command -v "$tool" >/dev/null 2>&1 && return 0
  if [ -n "${CI:-}" ]; then
    echo "$tool is not installed, and under CI that is a failure, not a skip" >&2
    exit 1
  fi
  sec_skip "$job" "$tool is not installed (mise install)"
  exit 0
}
