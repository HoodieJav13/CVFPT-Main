import { useState } from 'react';
import { Link, Navigate } from 'react-router-dom';
import { useAuth } from '@/context/AuthContext';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent } from '@/components/ui/card';
import { Loader2, Dumbbell } from 'lucide-react';
import { errMsg } from '@/lib/api';

export default function Signup() {
  const { user, loading, signup } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

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
    <div className="min-h-dvh app-noise flex items-center justify-center px-4 relative">
      <div className="top-glow absolute inset-x-0 top-0 h-72 pointer-events-none" />
      <div className="relative w-full max-w-sm">
        <div className="flex flex-col items-center mb-8">
          <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-primary text-primary-foreground shadow-[0_10px_30px_rgba(91,194,212,.35)]">
            <Dumbbell className="h-7 w-7" />
          </div>
          <h1 className="mt-4 font-display text-2xl font-semibold tracking-tight">Claim your account</h1>
          <p className="text-sm text-muted-foreground mt-1 text-center max-w-xs">
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
              {error && <p className="text-sm text-destructive" data-testid="invite-invalid-state-text">{error}</p>}
              <Button type="submit" className="w-full h-11 rounded-xl font-semibold" disabled={submitting} data-testid="invite-claim-submit-button">
                {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Create my account'}
              </Button>
            </form>
            <p className="mt-5 text-center text-sm text-muted-foreground">
              Already have an account?{' '}
              <Link to="/login" className="text-primary font-medium hover:underline" data-testid="go-to-login-link">
                Log in
              </Link>
            </p>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
