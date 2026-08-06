import { useState } from 'react';
import { Link } from 'react-router';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent } from '@/components/ui/card';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { CircleAlert, Loader2, MailCheck } from 'lucide-react';
import { api, errMsg } from '@/lib/api';
import { BrandBackdrop } from '@/components/BrandBackdrop';
import { AuthEntrance } from '@/components/Choreography';

export default function ForgotPassword() {
  const [email, setEmail] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState('');

  const submit = async (e) => {
    e.preventDefault();
    setError('');
    setSubmitting(true);
    try {
      await api.post('/auth/forgot-password', { email });
      setSent(true);
    } catch (err) {
      setError(errMsg(err, 'Could not process the request'));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="signature-surface min-h-dvh app-noise flex items-center justify-center overflow-hidden px-4 relative">
      <BrandBackdrop variant="auth" photoSlot="auth" />
      <AuthEntrance>
        <div className="flex flex-col items-center mb-8">
          <h1 className="font-display text-3xl font-semibold tracking-tight">Reset your password</h1>
          <p className="mt-1 text-sm text-[hsl(var(--signature-foreground)/0.72)]">We&apos;ll email you a reset link</p>
        </div>
        <Card className="border-border/80 shadow-[var(--app-elev)]">
          <CardContent className="p-6">
            {sent ? (
              <div className="text-center" data-testid="forgot-password-sent">
                <MailCheck className="mx-auto h-10 w-10 text-primary" aria-hidden />
                <p className="mt-3 font-medium">Check your email</p>
                <p className="mt-1 text-sm text-muted-foreground">
                  If that email has an account, a reset link is on its way. The link expires after about an hour.
                </p>
              </div>
            ) : (
              <form onSubmit={submit} className="space-y-4">
                <div className="space-y-1.5">
                  <Label htmlFor="email">Email</Label>
                  <Input id="email" type="email" required value={email} onChange={(e) => setEmail(e.target.value)}
                    placeholder="you@example.com" className="h-11 rounded-xl" data-testid="forgot-password-email-input" />
                </div>
                {error && (
                  <Alert className="border-primary/30 bg-primary/10" aria-live="polite" data-testid="forgot-password-error-text">
                    <CircleAlert className="h-4 w-4 text-primary" aria-hidden />
                    <AlertTitle>Something went wrong</AlertTitle>
                    <AlertDescription>{error}</AlertDescription>
                  </Alert>
                )}
                <Button type="submit" className="w-full h-11 rounded-xl font-semibold" disabled={submitting} data-testid="forgot-password-submit-button">
                  {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Email me a reset link'}
                </Button>
              </form>
            )}
            <p className="mt-5 text-center text-sm text-muted-foreground">
              Remembered it?{' '}
              <Link to="/login" className="signature-primary-text font-medium hover:underline" data-testid="back-to-login-link">
                Back to log in
              </Link>
            </p>
          </CardContent>
        </Card>
      </AuthEntrance>
    </div>
  );
}
