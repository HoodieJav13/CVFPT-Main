import { useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent } from '@/components/ui/card';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { CircleAlert, CheckCircle2, Loader2 } from 'lucide-react';
import { api, errMsg } from '@/lib/api';
import { BrandBackdrop } from '@/components/BrandBackdrop';
import { AuthEntrance } from '@/components/Choreography';

export default function ResetPassword() {
  const [searchParams] = useSearchParams();
  const token = searchParams.get('token') || '';
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState('');

  const submit = async (e) => {
    e.preventDefault();
    setError('');
    if (password.length < 8) { setError('Password must be at least 8 characters'); return; }
    if (password !== confirm) { setError('Passwords do not match'); return; }
    setSubmitting(true);
    try {
      await api.post('/auth/reset-password', { token, password });
      setDone(true);
    } catch (err) {
      setError(errMsg(err, 'Could not reset the password'));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="signature-surface min-h-dvh app-noise flex items-center justify-center overflow-hidden px-4 relative">
      <BrandBackdrop variant="auth" photoSlot="auth" />
      <AuthEntrance>
        <div className="flex flex-col items-center mb-8">
          <h1 className="font-display text-3xl font-semibold tracking-tight">Choose a new password</h1>
        </div>
        <Card className="border-border/80 shadow-[var(--app-elev)]">
          <CardContent className="p-6">
            {!token ? (
              <div className="text-center" data-testid="reset-password-no-token">
                <CircleAlert className="mx-auto h-10 w-10 text-primary" aria-hidden />
                <p className="mt-3 font-medium">This link is incomplete</p>
                <p className="mt-1 text-sm text-muted-foreground">
                  Open the reset link from your email again, or request a new one.
                </p>
                <Button asChild className="mt-4 h-11 rounded-xl font-semibold">
                  <Link to="/forgot-password">Request a new link</Link>
                </Button>
              </div>
            ) : done ? (
              <div className="text-center" data-testid="reset-password-done">
                <CheckCircle2 className="mx-auto h-10 w-10 text-primary" aria-hidden />
                <p className="mt-3 font-medium">Password updated</p>
                <p className="mt-1 text-sm text-muted-foreground">You can log in with your new password now.</p>
                <Button asChild className="mt-4 h-11 w-full rounded-xl font-semibold" data-testid="reset-password-login-link">
                  <Link to="/login">Go to log in</Link>
                </Button>
              </div>
            ) : (
              <form onSubmit={submit} className="space-y-4">
                <div className="space-y-1.5">
                  <Label htmlFor="password">New password</Label>
                  <Input id="password" type="password" autoComplete="new-password" required minLength={8} value={password} onChange={(e) => setPassword(e.target.value)}
                    placeholder="At least 8 characters" className="h-11 rounded-xl" data-testid="reset-password-input" />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="confirm">Confirm new password</Label>
                  <Input id="confirm" type="password" autoComplete="new-password" required minLength={8} value={confirm} onChange={(e) => setConfirm(e.target.value)}
                    placeholder="Repeat the password" className="h-11 rounded-xl" data-testid="reset-password-confirm-input" />
                </div>
                {error && (
                  <Alert className="border-primary/30 bg-primary/10" aria-live="polite" data-testid="reset-password-error-text">
                    <CircleAlert className="h-4 w-4 text-primary" aria-hidden />
                    <AlertTitle>Unable to reset</AlertTitle>
                    <AlertDescription>
                      {error}{' '}
                      <Link to="/forgot-password" className="font-medium underline">Request a new link</Link>
                    </AlertDescription>
                  </Alert>
                )}
                <Button type="submit" className="w-full h-11 rounded-xl font-semibold" disabled={submitting} data-testid="reset-password-submit-button">
                  {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Set new password'}
                </Button>
              </form>
            )}
          </CardContent>
        </Card>
      </AuthEntrance>
    </div>
  );
}
