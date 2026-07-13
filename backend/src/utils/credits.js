const { supabaseAdmin } = require('../supabase');

async function getBalance(clientId) {
  const { data } = await supabaseAdmin.from('client_credits').select('*').eq('client_id', clientId).maybeSingle();
  return data ? data.balance : 0;
}

/** Idempotently completes a purchase: marks completed + grants credits exactly once. */
async function completePurchase(purchaseId) {
  const { data, error } = await supabaseAdmin.rpc('complete_purchase', { p_purchase_id: purchaseId });
  if (error) throw error;
  return data;
}

module.exports = { getBalance, completePurchase };
