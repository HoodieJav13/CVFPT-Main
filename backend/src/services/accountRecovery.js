const { supabaseAdmin } = require('../supabase');
const { renderEmail, sendEmail } = require('./email');

// Recovery links come from GoTrue admin.generateLink — no email is sent by
// Supabase itself, so delivery always goes through the branded Resend path
// and works regardless of Supabase SMTP configuration.
async function sendPasswordResetEmail({ email, name }, env = process.env) {
  const { data, error } = await supabaseAdmin.auth.admin.generateLink({ type: 'recovery', email });
  if (error) throw error;
  const tokenHash = data?.properties?.hashed_token;
  if (!tokenHash) throw new Error('recovery link missing token');
  const resetUrl = `${env.FRONTEND_URL || ''}/reset-password?token=${encodeURIComponent(tokenHash)}`;
  const headline = 'Reset your CVF PT password';
  const rendered = renderEmail({
    headline,
    intro: `Hi ${String(name || '').split(' ')[0] || 'there'} — use the button below to choose a new password.`,
    actionLabel: 'Choose a new password',
    actionUrl: resetUrl,
    footer: 'This link expires after about an hour. If you did not request it, you can ignore this email.',
  });
  return sendEmail({ to: [email], subject: headline, ...rendered }, `password-reset/${tokenHash.slice(0, 24)}`, env);
}

async function sendInviteEmail({ client, coachName }, env = process.env) {
  const signupUrl = `${env.FRONTEND_URL || ''}/signup?email=${encodeURIComponent(client.email)}`;
  const headline = 'Your CVF PT account is ready to claim';
  const rendered = renderEmail({
    headline,
    intro: `${coachName} set up your Core Value Fitness training account. Sign up with this exact email address: ${client.email}.`,
    actionLabel: 'Claim your account',
    actionUrl: signupUrl,
    footer: 'If you were not expecting this, you can ignore this email.',
  });
  return sendEmail({ to: [client.email], subject: headline, ...rendered }, `invite/${client.id}/${client.updated_at}`, env);
}

module.exports = { sendInviteEmail, sendPasswordResetEmail };
