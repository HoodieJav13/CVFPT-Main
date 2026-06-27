const { supabaseAdmin } = require('../supabase');

async function getBalance(clientId) {
  const { data } = await supabaseAdmin.from('client_credits').select('*').eq('client_id', clientId).maybeSingle();
  return data ? data.balance : 0;
}

async function setBalance(clientId, balance) {
  const { data: existing } = await supabaseAdmin.from('client_credits').select('id').eq('client_id', clientId).maybeSingle();
  if (existing) {
    await supabaseAdmin.from('client_credits').update({ balance, updated_at: new Date().toISOString() }).eq('client_id', clientId);
  } else {
    await supabaseAdmin.from('client_credits').insert({ client_id: clientId, balance });
  }
  return balance;
}

async function addCredits(clientId, amount) {
  const current = await getBalance(clientId);
  return setBalance(clientId, current + amount);
}

/** Deducts one credit if available. Returns the new balance, or null if no credits to deduct. */
async function deductCredit(clientId) {
  const current = await getBalance(clientId);
  if (current <= 0) return null;
  return setBalance(clientId, current - 1);
}

/** Idempotently completes a purchase: marks completed + grants credits exactly once. */
async function completePurchase(purchaseId) {
  const { data: purchase } = await supabaseAdmin.from('purchases').select('*').eq('id', purchaseId).maybeSingle();
  if (!purchase || purchase.status === 'completed') return purchase;
  const { data: updated } = await supabaseAdmin
    .from('purchases')
    .update({ status: 'completed' })
    .eq('id', purchaseId)
    .eq('status', 'pending')
    .select()
    .maybeSingle();
  if (updated) {
    await addCredits(updated.client_id, updated.credits_granted);
  }
  return updated || purchase;
}

module.exports = { getBalance, addCredits, deductCredit, completePurchase, setBalance };
