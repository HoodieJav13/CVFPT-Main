#!/usr/bin/env bash
set -euo pipefail

target="${1:-.}"
target="$(cd "$target" && pwd)"

read_protocol_version() {
  sed -n 's/^# Loop Protocol — v\([0-9][0-9.]*\)$/\1/p' "$1" | head -n 1
}

read_contract_version() {
  sed -n 's/^\*\*Protocol version:\*\* v\([0-9][0-9.]*\)$/\1/p' "$1" | head -n 1
}

require_file() {
  if [[ ! -f "$1" ]]; then
    echo "missing required file: $1" >&2
    exit 1
  fi
}

if [[ -f "$target/SKILL.md" ]]; then
  protocol="$target/references/protocol.md"
  executor="$target/assets/repo-contract/EXECUTOR.md"
  policy="$target/assets/repo-contract/PROJECT_POLICY.template.md"

  require_file "$target/agents/openai.yaml"
  require_file "$target/references/prompt-contract.md"
  require_file "$target/references/risk-playbooks.md"
  require_file "$target/references/visual-quality-gate.md"
  require_file "$protocol"
  require_file "$executor"
  require_file "$policy"
  require_file "$target/scripts/install-repo-contract.sh"
elif [[ -d "$target/.agentic" ]]; then
  protocol="$target/.agentic/protocol.md"
  executor="$target/.agentic/EXECUTOR.md"
  policy="$target/.agentic/PROJECT_POLICY.md"

  require_file "$protocol"
  require_file "$executor"
  require_file "$policy"
  require_file "$target/.agentic/validate-contract-version.sh"
else
  echo "target is neither a skill package nor a wired repository: $target" >&2
  exit 2
fi

protocol_version="$(read_protocol_version "$protocol")"
executor_version="$(read_contract_version "$executor")"
policy_version="$(read_contract_version "$policy")"

if [[ -z "$protocol_version" || -z "$executor_version" || -z "$policy_version" ]]; then
  echo "one or more protocol version markers are missing" >&2
  exit 1
fi

if [[ "$protocol_version" != "$executor_version" || "$protocol_version" != "$policy_version" ]]; then
  echo "contract version mismatch: protocol=$protocol_version executor=$executor_version policy=$policy_version" >&2
  exit 1
fi

echo "contract versions match: v$protocol_version"
