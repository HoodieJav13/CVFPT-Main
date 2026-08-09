// BRANCH-LOCAL PROTOTYPE SWITCH — design-plans/011 A Home reorganization.
// Never merges to main as-is: after the owner's cold pick, the chosen
// variant becomes plain production code and this module dies (same drill
// as the 010 Level 2 pick).
export const PROTO = (() => {
  try {
    return localStorage.getItem('cvf_proto_variant') === 'bold' ? 'bold' : 'baseline';
  } catch {
    return 'baseline';
  }
})();

export const isBold = PROTO === 'bold';
