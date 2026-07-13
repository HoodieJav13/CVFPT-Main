import { useEffect, useState, useCallback } from 'react';
import { api, errMsg } from '@/lib/api';
import { PageHeader, LoadingScreen, LoadErrorState, SectionLabel } from '@/components/common';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { ScrollArea } from '@/components/ui/scroll-area';
import { FileSignature, CheckCircle2, Loader2 } from 'lucide-react';
import { fmtDateTime } from '@/lib/format';
import { toast } from 'sonner';

export default function ClientWaiver() {
  const [status, setStatus] = useState(null);
  const [waiver, setWaiver] = useState(null);
  const [loadError, setLoadError] = useState(null);
  const [name, setName] = useState('');
  const [agreed, setAgreed] = useState(false);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    try {
      const { data: st } = await api.get('/waivers/my-status');
      setStatus(st);
      if (st.latest_version) {
        const { data: w } = await api.get('/waivers/latest');
        setWaiver(w);
      } else {
        setWaiver(null);
      }
      setLoadError(null);
    } catch (e) {
      const message = errMsg(e, 'Failed to load waiver');
      setLoadError(message);
      toast.error(message);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const sign = async (e) => {
    e.preventDefault();
    if (!agreed) {
      toast.error('Please confirm you have read and agree to the waiver');
      return;
    }
    setSaving(true);
    try {
      await api.post('/waivers/sign', { signed_name: name });
      toast.success('Waiver signed - thank you!');
      load();
    } catch (err) {
      toast.error(errMsg(err));
    } finally {
      setSaving(false);
    }
  };

  const awaitingInitialData = !status || (status.latest_version && !waiver);
  if (awaitingInitialData && loadError) return <LoadErrorState message={loadError} scope="client-waiver" onRetry={() => { setLoadError(null); load(); }} />;
  if (awaitingInitialData) return <LoadingScreen />;

  if (!status.latest_version) {
    return (
      <div>
        <PageHeader title="Waiver" />
        <p className="text-sm text-muted-foreground" data-testid="waiver-unavailable-state">No waiver is available yet. Check back later.</p>
      </div>
    );
  }

  const currentSig = status.signatures.find((s) => s.waiver_version_id === status.latest_version.id);

  return (
    <div>
      <PageHeader title="Liability waiver" subtitle={`Version ${status.latest_version.version_number}`} />

      {status.signed_latest ? (
        <Card className="border-success/30" data-testid="waiver-signed-card">
          <CardContent className="p-5 flex items-start gap-3">
            <CheckCircle2 className="h-6 w-6 text-success-foreground shrink-0" />
            <div>
              <p className="font-semibold">You're all set</p>
              <p className="text-sm text-muted-foreground mt-1">
                Signed as "{currentSig?.signed_name}" on {fmtDateTime(currentSig?.signed_at)}
                {currentSig?.entered_by === 'coach' ? ' (recorded by your coach from a paper waiver)' : ''}.
              </p>
            </div>
          </CardContent>
        </Card>
      ) : (
        <Card className="border-gold/30">
          <CardContent className="p-4 flex items-center gap-3">
            <FileSignature className="h-5 w-5 text-gold shrink-0" />
            <p className="text-sm">Please read the waiver below and sign before your next session.</p>
          </CardContent>
        </Card>
      )}

      {waiver && (
        <Card className="mt-4">
          <CardContent className="p-4">
            <ScrollArea className="h-72 rounded-lg border border-border bg-background/40 p-4">
              <div className="whitespace-pre-wrap max-w-prose text-[15px] leading-relaxed" data-testid="waiver-full-text">{waiver.full_text}</div>
            </ScrollArea>
          </CardContent>
        </Card>
      )}

      {!status.signed_latest && (
        <form onSubmit={sign} className="mt-4 space-y-4">
          <div className="space-y-1.5">
            <Label>Type your full legal name to sign *</Label>
            <Input required value={name} onChange={(e) => setName(e.target.value)} placeholder="Your full legal name" className="h-11 rounded-xl" data-testid="waiver-signature-input" />
          </div>
          <label className="flex items-start gap-3 text-sm">
            <Checkbox checked={agreed} onCheckedChange={setAgreed} className="mt-0.5" data-testid="waiver-consent-checkbox" />
            <span>I have read, understand, and voluntarily agree to this waiver (version {status.latest_version.version_number}).</span>
          </label>
          <Button type="submit" disabled={saving || !name.trim() || !agreed} className="w-full h-11 rounded-xl font-semibold" data-testid="waiver-submit-button">
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Sign waiver'}
          </Button>
        </form>
      )}

      {status.signatures.length > 0 && (
        <div className="mt-6">
          <SectionLabel className="mb-2">Signature history</SectionLabel>
          {status.signatures.map((s) => (
            <p key={s.id} className="text-xs text-muted-foreground py-1" data-testid="signature-history-row">
              v{s.version?.version_number} - "{s.signed_name}" - {fmtDateTime(s.signed_at)}{s.entered_by === 'coach' ? ' (paper, coach-entered)' : ''}
            </p>
          ))}
        </div>
      )}
    </div>
  );
}
