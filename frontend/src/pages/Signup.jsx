import { useState } from 'react';
import { Link, Navigate } from 'react-router-dom';
import { useAuth } from '@/context/AuthContext';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent } from '@/components/ui/card';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { CircleAlert, Loader2 } from 'lucide-react';
import { errMsg } from '@/lib/api';
import { BrandBackdrop } from '@/components/BrandBackdrop';
import { AuthEntrance } from '@/components/Choreography';

export default function Signup() {
  const { user, loading, signup } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [logoBroken, setLogoBroken] = useState(false);

  if (!loading && user) return <Navigate to={user.role === 'client' ? '/client' : '/coach'} replace />;

  const submit = async (e) => {
    e.preventDefault();
    setError('');
    if (password !== confirm) {
      setError('Passwords do not match');
      return;
    }
    setSubmitting(true);
    try {
      await signup(email, password);
    } catch (err) {
      setError(errMsg(err, 'Signup failed'));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="signature-surface min-h-dvh app-noise flex items-center justify-center overflow-hidden px-4 relative">
      <BrandBackdrop variant="auth" photoSlot="auth" />
      <AuthEntrance>
        <div className="flex flex-col items-center mb-8">
          {logoBroken ? (
            <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-primary text-primary-foreground font-display font-bold text-lg shadow-lg shadow-primary/30">
              CVF
            </div>
          ) : (
            <img
              src="/logo.png"
              alt="CVF PT"
              className="h-14 w-14 rounded-2xl object-contain shadow-lg shadow-primary/30"
              onError={() => setLogoBroken(true)}
            />
          )}
          <h1 className="mt-4 font-display text-2xl font-semibold tracking-tight">Claim your account</h1>
          <p className="mt-1 max-w-xs text-center text-sm text-[hsl(var(--signature-foreground)/0.72)]">
            Use the same email your coach has on file. You must be invited by your coach to sign up.
          </p>
        </div>
        <Card className="border-border/80 shadow-[var(--app-elev)]">
          <CardContent className="p-6">
            <form onSubmit={submit} className="space-y-4">
              <div className="space-y-1.5">
                <Label htmlFor="email">Email (as given to your coach)</Label>
                <Input id="email" type="email" required value={email} onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@example.com" className="h-11 rounded-xl" data-testid="signup-email-input" />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="password">Create password</Label>
                <Input id="password" type="password" required minLength={8} value={password} onChange={(e) => setPassword(e.target.value)}
                  placeholder="At least 8 characters" className="h-11 rounded-xl" data-testid="signup-password-input" />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="confirm">Confirm password</Label>
                <Input id="confirm" type="password" required value={confirm} onChange={(e) => setConfirm(e.target.value)}
                  placeholder="Repeat your password" className="h-11 rounded-xl" data-testid="signup-confirm-input" />
              </div>
              {error && (
                <Alert className="border-primary/30 bg-primary/10" aria-live="polite" data-testid="invite-invalid-state-text">
                  <CircleAlert className="h-4 w-4 text-primary" aria-hidden />
                  <AlertTitle>Unable to create account</AlertTitle>
                  <AlertDescription>{error}</AlertDescription>
                </Alert>
              )}
              <Button type="submit" className="w-full h-11 rounded-xl font-semibold" disabled={submitting} data-testid="invite-claim-submit-button">
                {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Create my account'}
              </Button>
            </form>
            <p className="mt-5 text-center text-sm text-muted-foreground">
              Already have an account?{' '}
              <Link to="/login" className="signature-primary-text font-medium hover:underline" data-testid="go-to-login-link">
                Log in
              </Link>
            </p>
          </CardContent>
        </Card>
      </AuthEntrance>
    </div>
  );
}
