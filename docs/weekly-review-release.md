# Weekly review — local release preparation

Normal coach/admin entry: Client → Whole week → Review this week. The URL carries
the actual client and Denver calendar week. Existing server-side ownership and
role checks on GET /whole-week/clients/:id remain authoritative. Before reading
saved facts and before every local operation, the page verifies current access;
focus checks mask private content, and newest-request/session/scope fences keep
older results from restoring it after a denial. Clients cannot reach the route.

The reviewed snapshot contains client ID (displayed generically), week, PT
completion count or explicit unavailability, collection status, and the first
visible outside-activity page. Paging remains explicitly partial. Names, notes,
effort, health and check-ins are excluded. This is context for coach judgment,
not an automated training score. Empty activity lists do not mean rest.

A coach writes an adjustment/rationale, reviews frozen text and facts, then
checks the acknowledgement and confirms. The receipt explicitly says programs
are unchanged and nothing was sent. Browser-only storage is scoped by profile,
client and week in a new namespace. Repeated confirmation keeps one receipt;
interrupted saves remain unconfirmed, failed/read-back-denied writes offer
recovery, earlier receipts survive new drafts, malformed saved content remains
untouched, and Reset this review affects only the current scope. Sign-out hides
all route content through normal authentication; stored receipts remain for the
same profile after sign-in. Raw same-browser storage is not a synchronization or
shared-device protection service.

The store is adapted from the accepted synthetic receipt engine. 39meaningful
engine cases now exercise the live store; 3fixture-catalog cases are superseded
by live DTO validation. 13additional cases cover minimal snapshots, live scope,
strict pagination/duration, current access and privacy. No fixture module is
imported by the production review route. Existing ordinary Studio Save remains
the program writer; this feature has no program/message network writer.

Later release prerequisites: explicit owner release/merge decision, existing
WholeWeek migration 20261030002155_whole_week_outside_activity.sql applied and
verified before backend then frontend release, normal locked CI install and
authorized hosted/auth acceptance as separately scoped. No hosted acceptance,
migration or deployment occurred during this preparation. Existing native SQL
proof is reused only after exact migration/backend byte equality.

Rollback: preserve pre-release frontend/backend artifacts and redeploy those
under a separately authorized release operation. Do not reverse/drop the applied
WholeWeek ledger migration; database history is forward-only. Local review keys
are separate from programs/logs and old demo keys. Receipt synchronization,
retention policy and any automatic application/delivery remain future product
choices requiring explicit scope.
