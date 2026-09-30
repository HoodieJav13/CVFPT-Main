#!/usr/bin/env bash
# Deploy-boundary guard (CLAUDE.md "Deploy architecture"): frontend/ and
# backend/ deploy as two isolated Vercel projects, so neither tree may
# import, require, or path-reference the other. Local checkouts have the
# whole monorepo on disk, which is why this has to be a check and not a
# build failure. Usage: scripts/check-boundaries.sh [frontend|backend|all]
set -u
cd "$(dirname "$0")/.."
target="${1:-all}"
status=0

check() {
  local dir="$1" other="$2" pkg="$3"
  local hits
  # Relative paths that climb out of the tree and into the other project.
  hits=$(grep -rnE "(\.\./)+${other}/" "$dir" 2>/dev/null || true)
  # Bare package-name imports/requires of the other project.
  hits+=$(grep -rnE "(from\s+|require\(\s*|import\(\s*)['\"]${pkg}(/|['\"])" "$dir" 2>/dev/null | sed 's/^/\n/' || true)
  if [ -n "$hits" ]; then
    echo "::error::${dir} reaches across the deploy boundary into ${other}/:"
    echo "$hits"
    status=1
  else
    echo "${dir}: no references into ${other}/"
  fi
}

case "$target" in
  frontend) check frontend/src backend cvf-pt-backend ;;
  backend)  check backend/src frontend frontend ;;
  all)      check frontend/src backend cvf-pt-backend; check backend/src frontend frontend ;;
  *) echo "usage: $0 [frontend|backend|all]" >&2; exit 2 ;;
esac
exit $status
