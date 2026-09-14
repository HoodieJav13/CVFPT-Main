#!/usr/bin/env bash
# "Never two unapplied migrations in flight at once" (docs/roadmap.md
# standing rules). Reads `gh pr list --json number,labels,files` JSON on
# stdin and fails when more than one OPEN PR touches supabase/migrations/
# without the `migration-applied` label. One such PR is the normal case
# (it is the migration currently in flight); two means the owner would
# have to apply out of order or apply two at once.
set -u
node -e '
  const prs = JSON.parse(require("fs").readFileSync(0, "utf8"));
  const inflight = prs.filter((pr) =>
    (pr.files || []).some((f) => String(f.path || "").startsWith("supabase/migrations/"))
    && !(pr.labels || []).some((l) => l.name === "migration-applied"));
  for (const pr of inflight) {
    const files = pr.files.filter((f) => String(f.path).startsWith("supabase/migrations/")).map((f) => f.path);
    console.log(`#${pr.number}: unapplied migration PR (${files.join(", ")})`);
  }
  if (inflight.length > 1) {
    console.log(`::error::${inflight.length} open PRs carry migrations without the migration-applied label; only one migration may be in flight at a time. Apply and label one before the other proceeds.`);
    process.exit(1);
  }
  console.log(`${inflight.length} unapplied migration PR(s) in flight — within policy.`);
'
