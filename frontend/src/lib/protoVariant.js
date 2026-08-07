// BRANCH-LOCAL PROTOTYPE SWITCH — design-plans/010 Level 2.
// Never merges to main as-is: after the owner's cold pick, the chosen
// variant is reimplemented as plain production code and this module dies.
// 'baseline' = disciplined interpretation of the doc; 'bold' = deliberate
// probe past default comfort. Default (no flag) renders baseline.
export const PROTO = (() => {
  try {
    return localStorage.getItem('cvf_proto_variant') === 'bold' ? 'bold' : 'baseline';
  } catch {
    return 'baseline';
  }
})();

export const isBold = PROTO === 'bold';
