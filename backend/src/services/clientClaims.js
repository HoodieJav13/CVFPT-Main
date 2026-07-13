async function linkInvitedClient(supabase, { clientId, authUserId, updatedAt }) {
  return supabase
    .from('clients')
    .update({ auth_user_id: authUserId, updated_at: updatedAt })
    .eq('id', clientId)
    .eq('invited', true)
    .is('auth_user_id', null)
    .eq('archived', false)
    .select('*')
    .maybeSingle();
}

module.exports = { linkInvitedClient };
