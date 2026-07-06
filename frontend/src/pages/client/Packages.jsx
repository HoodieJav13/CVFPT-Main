import { useEffect, useState, useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api, errMsg } from '@/lib/api';
import { PageHeader, LoadingScreen, EmptyState } from '@/components/common';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { CreditCard, Loader2, AlertCircle, Repeat } from 'lucide-react';
import { fmtMoney, fmtDateTime } from '@/lib/format';
import { toast } from 'sonner';

export default function ClientPackages() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [config, setConfig] = useState(null);
  const [packages, setPackages] = useState(null);
  const [credits, setCredits] = useState(0);
  const [history, setHistory] = useState([]);
  const [buying, setBuying] = useState(null);

  const load = useCallback(async () => {
    try {
      const [cfg, pkgs, cr, hist] = await Promise.all([
        api.get('/payments/config'),
        api.get('/packages'),
        api.get('/payments/credits'),
        api.get('/payments/history'),
      ]);
      setConfig(cfg.data);
      setPackages(pkgs.data);
      setCredits(cr.data.balance);
      setHistory(hist.data);
    } catch (e) {
      toast.error(errMsg(e, 'Failed to load packages'));
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  // Handle Stripe checkout return
  useEffect(() => {
    const checkout = searchParams.get('checkout');
    const sessionId = searchParams.get('session_id');
    if (checkout === 'success' && sessionId) {
      api.get(`/payments/verify?session_id=${sessionId}`)
        .then(({ data }) => {
          if (data.status === 'completed') {
            toast.success(`Payment successful! You now have ${data.credits} credits.`);
          } else {
            toast.info('Payment is processing - credits will appear shortly.');
          }
          load();
        })
        .catch(() => toast.error('Could not verify payment - contact your coach if credits are missing.'))
        .finally(() => setSearchParams({}, { replace: true }));
    } else if (checkout === 'cancelled') {
      toast.info('Checkout cancelled');
      setSearchParams({}, { replace: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const buy = async (pkg) => {
    setBuying(pkg.id);
    try {
      const { data } = await api.post('/payments/checkout', { package_id: pkg.id });
      window.location.href = data.url;
    } catch (e) {
      toast.error(errMsg(e, 'Could not start checkout'));
      setBuying(null);
    }
  };

  if (!packages || !config) return <LoadingScreen />;

  return (
    <div>
      <PageHeader title="Packages & credits" subtitle="Buy session credits and view payment history" />

      <Card className="border-gold/35">
        <CardContent className="p-5 flex items-center justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Your balance</p>
            <p className="font-display text-3xl font-semibold mt-1 tabular-nums" data-testid="credits-balance-text">
              {credits} <span className="text-base text-muted-foreground font-normal">credits</span>
            </p>
          </div>
          <CreditCard className="h-8 w-8 text-gold" />
        </CardContent>
      </Card>

      {!config.configured && (
        <div className="mt-4 flex items-start gap-3 rounded-2xl border border-dashed border-border bg-card/40 p-4" data-testid="payments-not-configured-card">
          <AlertCircle className="h-5 w-5 text-muted-foreground shrink-0 mt-0.5" />
          <div>
            <p className="text-sm font-medium">Online payments not yet configured</p>
            <p className="text-xs text-muted-foreground mt-1">{config.message}</p>
          </div>
        </div>
      )}

      <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2 mt-6">Available packages</p>
      <div className="grid gap-3 sm:grid-cols-2">
        {packages.map((pkg) => (
          <Card key={pkg.id} className="relative overflow-hidden" data-testid="package-card">
            <div className="absolute inset-x-0 top-0 h-[2px] bg-primary/70" />
            <CardContent className="p-5">
              <div className="flex items-center justify-between">
                <p className="font-display font-semibold">{pkg.name}</p>
                {pkg.is_recurring && (
                  <Badge variant="outline" className="bg-primary/10 text-primary border-primary/25">
                    <Repeat className="h-3 w-3 mr-1" /> Recurring
                  </Badge>
                )}
              </div>
              {pkg.description && <p className="text-xs text-muted-foreground mt-1">{pkg.description}</p>}
              <p className="font-display text-2xl font-semibold mt-3 tabular-nums">{fmtMoney(pkg.price)}</p>
              <p className="text-xs text-gold font-medium mt-0.5">{pkg.session_credits} session credits</p>
              <Button
                className="w-full mt-4 rounded-xl font-semibold"
                disabled={!config.configured || buying === pkg.id}
                onClick={() => buy(pkg)}
                data-testid="stripe-checkout-button"
              >
                {buying === pkg.id ? <Loader2 className="h-4 w-4 animate-spin" /> : config.configured ? 'Buy now' : 'Payments unavailable'}
              </Button>
            </CardContent>
          </Card>
        ))}
      </div>

      <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2 mt-6">Payment history</p>
      {history.length === 0 ? (
        <p className="text-sm text-muted-foreground">No payments yet.</p>
      ) : (
        <div className="space-y-2">
          {history.map((p) => (
            <div key={p.id} className="flex items-center justify-between gap-3 rounded-xl border border-border bg-card/60 px-4 py-3" data-testid="client-payment-row">
              <div>
                <p className="font-medium text-sm">{p.package?.name || 'Package'}</p>
                <p className="text-xs text-muted-foreground">{fmtDateTime(p.created_at)} - {p.method === 'manual' ? 'Paid to coach' : 'Card'}</p>
              </div>
              <div className="text-right">
                <p className="font-semibold tabular-nums">{fmtMoney(p.amount)}</p>
                <p className="text-xs text-muted-foreground capitalize">{p.status}</p>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
