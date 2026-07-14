import { useEffect, useState, useCallback, useRef } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api, errMsg } from '@/lib/api';
import { PageHeader, LoadingScreen, LoadErrorState, SectionLabel } from '@/components/common';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { CreditCard, Loader2, AlertCircle, Repeat, Settings2, Gift, Dumbbell } from 'lucide-react';
import { fmtMoney, fmtDateTime } from '@/lib/format';
import { toast } from 'sonner';

const ACTIVE_SUBSCRIPTIONS = new Set(['trialing', 'active', 'past_due', 'paused', 'unpaid', 'incomplete']);

function activityDescription(item) {
  if (item.type === 'stripe_payment') return item.purchase_type === 'subscription_cycle' ? 'Stripe renewal' : 'Stripe payment';
  if (item.type === 'cash_payment') return item.receipt_number ? `Cash · ${item.receipt_number}` : 'Cash payment';
  if (item.type === 'courtesy_grant') return 'Courtesy credits';
  if (item.type === 'session_use') return 'Session completed';
  if (item.type === 'refund') return 'Payment reversal';
  return 'Credit adjustment';
}

export default function ClientPackages() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [config, setConfig] = useState(null);
  const [packages, setPackages] = useState(null);
  const [loadError, setLoadError] = useState(null);
  const [credits, setCredits] = useState(0);
  const [activity, setActivity] = useState([]);
  const [subscriptions, setSubscriptions] = useState([]);
  const [buying, setBuying] = useState(null);
  const [openingPortal, setOpeningPortal] = useState(false);
  const handledCheckoutRef = useRef(false);

  const load = useCallback(async () => {
    try {
      const [cfg, pkgs, cr, events, subs] = await Promise.all([
        api.get('/payments/config'),
        api.get('/packages'),
        api.get('/payments/credits'),
        api.get('/payments/activity'),
        api.get('/payments/subscriptions'),
      ]);
      setConfig(cfg.data);
      setPackages(pkgs.data);
      setCredits(cr.data.balance);
      setActivity(events.data);
      setSubscriptions(subs.data);
      setLoadError(null);
    } catch (error) {
      const message = errMsg(error, 'Failed to load payments');
      setLoadError(message);
      toast.error(message);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    if (handledCheckoutRef.current) return;
    const checkout = searchParams.get('checkout');
    const sessionId = searchParams.get('session_id');
    if (checkout === 'success' && sessionId) {
      handledCheckoutRef.current = true;
      api.get(`/payments/verify?session_id=${sessionId}`)
        .then(({ data }) => {
          if (data.status === 'completed' || data.status === 'active' || data.status === 'trialing') {
            toast.success('Payment confirmed. Your session balance is up to date.');
          } else {
            toast.info('Stripe is processing the payment. Credits will appear after confirmation.');
          }
          load();
        })
        .catch(() => toast.error('Could not confirm the checkout yet. Contact your coach if credits are missing.'))
        .finally(() => setSearchParams({}, { replace: true }));
    } else if (checkout === 'cancelled') {
      handledCheckoutRef.current = true;
      toast.info('Checkout cancelled');
      setSearchParams({}, { replace: true });
    }
  }, [load, searchParams, setSearchParams]);

  const buy = async (pkg) => {
    setBuying(pkg.id);
    try {
      const { data } = await api.post('/payments/checkout', { package_id: pkg.id });
      window.location.href = data.url;
    } catch (error) {
      toast.error(errMsg(error, 'Could not start checkout'));
      setBuying(null);
    }
  };

  const manageBilling = async () => {
    setOpeningPortal(true);
    try {
      const { data } = await api.post('/payments/portal');
      window.location.href = data.url;
    } catch (error) {
      toast.error(errMsg(error, 'Could not open billing management'));
      setOpeningPortal(false);
    }
  };

  const awaitingInitialData = !packages || !config;
  if (awaitingInitialData && loadError) return <LoadErrorState message={loadError} scope="client-packages" onRetry={() => { setLoadError(null); load(); }} />;
  if (awaitingInitialData) return <LoadingScreen />;

  const activeSubscription = subscriptions.find((subscription) => ACTIVE_SUBSCRIPTIONS.has(subscription.status));

  return (
    <div>
      <PageHeader title="Payments & sessions" subtitle="Manage your membership, session packs, and available sessions" />

      <div className="grid gap-3 sm:grid-cols-2">
        <Card className="border-gold/35">
          <CardContent className="p-5 flex items-center justify-between">
            <div>
              <SectionLabel>Available sessions</SectionLabel>
              <p className="font-display text-3xl font-semibold mt-1 tabular-nums" data-testid="credits-balance-text">
                {credits} <span className="text-base text-muted-foreground font-normal">credits</span>
              </p>
            </div>
            <CreditCard className="h-8 w-8 text-gold" />
          </CardContent>
        </Card>

        {activeSubscription && (
          <Card className="border-primary/30">
            <CardContent className="p-5">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <SectionLabel>Membership</SectionLabel>
                  <p className="font-display text-lg font-semibold mt-1">{activeSubscription.package?.name || 'Active membership'}</p>
                  <p className="text-xs text-muted-foreground capitalize">{activeSubscription.status.replace('_', ' ')}</p>
                </div>
                <Badge variant="outline" className="bg-primary/10 text-primary border-primary/25"><Repeat className="h-3 w-3 mr-1" /> Active</Badge>
              </div>
              <Button variant="secondary" className="mt-4 w-full rounded-xl" onClick={manageBilling} disabled={openingPortal} data-testid="manage-billing-button">
                {openingPortal ? <Loader2 className="h-4 w-4 animate-spin" /> : <><Settings2 className="h-4 w-4 mr-2" /> Manage billing</>}
              </Button>
            </CardContent>
          </Card>
        )}
      </div>

      {!config.configured && (
        <div className="mt-4 flex items-start gap-3 rounded-2xl border border-dashed border-border bg-card/40 p-4" data-testid="payments-not-configured-card">
          <AlertCircle className="h-5 w-5 text-muted-foreground shrink-0 mt-0.5" />
          <div>
            <p className="text-sm font-medium">Online payments not yet configured</p>
            <p className="text-xs text-muted-foreground mt-1">{config.message}</p>
          </div>
        </div>
      )}

      <SectionLabel className="mb-2 mt-6">Memberships & session packs</SectionLabel>
      <div className="grid gap-3 sm:grid-cols-2">
        {packages.map((pkg) => {
          const unavailable = !config.configured || !pkg.stripe_price_id || (pkg.is_recurring && activeSubscription);
          return (
            <Card key={pkg.id} className="relative overflow-hidden" data-testid="package-card">
              <div className="absolute left-0 top-3 bottom-3 w-[3px] rounded-full bg-primary/70" aria-hidden />
              <CardContent className="p-5 pl-6">
                <div className="flex items-center justify-between gap-3">
                  <p className="font-display font-semibold">{pkg.name}</p>
                  {pkg.is_recurring && (
                    <Badge variant="outline" className="bg-primary/10 text-primary border-primary/25">
                      <Repeat className="h-3 w-3 mr-1" /> Recurring
                    </Badge>
                  )}
                </div>
                {pkg.description && <p className="text-xs text-muted-foreground mt-1">{pkg.description}</p>}
                <p className="font-display text-2xl font-semibold mt-3 tabular-nums">
                  {fmtMoney(pkg.price)}{pkg.is_recurring && <span className="text-sm text-muted-foreground font-normal">/{pkg.billing_interval || 'month'}</span>}
                </p>
                <p className="text-xs text-gold font-medium mt-0.5">{pkg.session_credits} rolling session credits</p>
                <Button
                  className={`w-full mt-4 rounded-xl font-semibold ${unavailable ? 'bg-muted text-muted-foreground hover:bg-muted disabled:opacity-100 disabled:pointer-events-auto cursor-not-allowed' : ''}`}
                  disabled={unavailable || buying === pkg.id}
                  onClick={() => buy(pkg)}
                  data-testid="stripe-checkout-button"
                >
                  {buying === pkg.id ? <Loader2 className="h-4 w-4 animate-spin" />
                    : pkg.is_recurring ? (activeSubscription ? 'Manage current membership' : 'Subscribe') : 'Buy session pack'}
                </Button>
                {config.configured && !pkg.stripe_price_id && <p className="mt-2 text-xs text-muted-foreground">Ask your coach to link this package for online checkout.</p>}
              </CardContent>
            </Card>
          );
        })}
      </div>

      <SectionLabel className="mb-2 mt-6">Account activity</SectionLabel>
      {activity.length === 0 ? (
        <p className="text-sm text-muted-foreground">No payment or credit activity yet.</p>
      ) : (
        <div className="space-y-2">
          {activity.map((item) => (
            <div key={item.id} className="flex items-center justify-between gap-3 rounded-xl border border-border bg-card/60 px-4 py-3" data-testid="client-payment-row">
              <div className="flex min-w-0 items-center gap-3">
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                  {item.type === 'courtesy_grant' ? <Gift className="h-4 w-4" /> : item.type === 'session_use' ? <Dumbbell className="h-4 w-4" /> : <CreditCard className="h-4 w-4" />}
                </div>
                <div className="min-w-0">
                  <p className="font-medium text-sm truncate">{item.title}</p>
                  <p className="text-xs text-muted-foreground">{fmtDateTime(item.created_at)} · {activityDescription(item)}</p>
                </div>
              </div>
              <div className="text-right shrink-0">
                {Number.isFinite(item.amount) ? <p className="font-semibold tabular-nums">{fmtMoney(item.amount)}</p> : null}
                {Number.isFinite(item.credits) && <p className={`text-xs tabular-nums ${item.credits > 0 ? 'text-gold' : 'text-muted-foreground'}`}>{item.credits > 0 ? '+' : ''}{item.credits} credits</p>}
                <p className="text-[11px] text-muted-foreground capitalize">{String(item.status || '').replace('_', ' ')}</p>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
