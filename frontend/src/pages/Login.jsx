import { useState } from 'react';
import { Link, Navigate } from 'react-router-dom';
import { useAuth } from '@/context/AuthContext';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent } from '@/components/ui/card';
import { Loader2 } from 'lucide-react';
import { errMsg } from '@/lib/api';

export default function Login() {
  const { user, loading, login } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [logoBroken, setLogoBroken] = useState(false);

  if (!loading && user) return <Navigate to={user.role === 'client' ? '/client' : '/coach'} replace />;

  const submit = async (e) => {
    e.preventDefault();
    setError('');
    setSubmitting(true);
    try {
      await login(email, password);
    } catch (err) {
      setError(errMsg(err, 'Login failed'));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="min-h-dvh app-noise flex items-center justify-center px-4 relative">
      <div
        className="absolute inset-0 opacity-[0.14] bg-cover bg-center"
        style={{ backgroundImage: "url('https://images.unsplash.com/photo-1595886509089-b691b210fc5c?crop=entropy&cs=srgb&fm=jpg&ixlib=rb-4.1.0&q=85&w=1600')" }}
      />
      <div className="absolute inset-0 bg-gradient-to-b from-background/70 via-background/90 to-background" />
      <div aria-hidden className="ridge-fade absolute inset-x-0 bottom-0 h-32 opacity-[0.05]" />
      <div className="relative w-full max-w-sm">
        <div className="flex flex-col items-center mb-8">
          {logoBroken ? (
            <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-primary text-primary-foreground font-display font-bold text-lg shadow-[0_10px_30px_rgba(91,194,212,.35)]">
              CVF
            </div>
          ) : (
            <img
              src="/logo.png"
              alt="CVF PT"
              className="h-14 w-14 rounded-2xl object-contain shadow-[0_10px_30px_rgba(91,194,212,.35)]"
              onError={() => setLogoBroken(true)}
            />
          )}
          <h1 className="mt-4 font-display text-4xl font-semibold tracking-tight">CVF PT</h1>
          <p className="text-sm text-muted-foreground mt-1">Fitness Done Right</p>
        </div>
        <Card className="border-border/80 shadow-[var(--app-elev)]">
          <CardContent className="p-6">
            <form onSubmit={submit} className="space-y-4">
              <div className="space-y-1.5">
                <Label htmlFor="email">Email</Label>
                <Input id="email" type="email" required value={email} onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@example.com" className="h-11 rounded-xl" data-testid="login-email-input" />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="password">Password</Label>
                <Input id="password" type="password" required value={password} onChange={(e) => setPassword(e.target.value)}
                  placeholder="Your password" className="h-11 rounded-xl" data-testid="login-password-input" />
              </div>
              {error && <p className="text-sm text-destructive" data-testid="login-error-text">{error}</p>}
              <Button type="submit" className="w-full h-11 rounded-xl font-semibold" disabled={submitting} data-testid="login-submit-button">
                {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Log in'}
              </Button>
            </form>
            <p className="mt-5 text-center text-sm text-muted-foreground">
              Invited by your coach?{' '}
              <Link to="/signup" className="text-primary font-medium hover:underline" data-testid="go-to-signup-link">
                Claim your account
              </Link>
            </p>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
