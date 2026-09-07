import React, { useState } from 'react';
import { api } from '../lib/api.js';
import { usePageTitle } from '../lib/seo.jsx';
import { useLocale } from '../lib/i18n.jsx';
import { Button, Card, Input, Label, Badge, ErrorState } from '../components/ui.jsx';
import { useToasts } from '../components/Toast.jsx';
import { IconShield, IconCheckCircle, IconAlert, IconSearch } from '../components/icons.jsx';

export default function VerifyTrn() {
  usePageTitle('TRN Verification');
  const { t } = useLocale();
  const { addToast } = useToasts();

  const [trn, setTrn] = useState('');
  const [result, setResult] = useState(null);
  const [loading, setLoading] = useState(false);
  const [checking, setChecking] = useState(false);

  const UAE_TRN_RE = /^\d{15}$/;

  async function handleCheck() {
    if (!UAE_TRN_RE.test(trn)) {
      addToast('TRN must be exactly 15 digits', 'error');
      return;
    }
    setChecking(true);
    try {
      const data = await api.verifyTrn(trn);
      setResult(data);
      addToast(data.valid ? 'TRN is valid' : 'TRN not found', data.valid ? 'success' : 'warning');
    } catch (e) {
      addToast(e.message || 'Verification failed', 'error');
    } finally {
      setChecking(false);
    }
  }

  async function handleBulkCheck() {
    // For future bulk check
    addToast('Bulk check not yet implemented', 'warning');
  }

  return (
    <div className="container-page max-w-2xl">
      <div className="mb-6">
        <h1 className="font-display text-2xl font-bold text-ink flex items-center gap-2">
          <IconShield size={24} /> {t('verify.title') || 'TRN Verification'}
        </h1>
        <p className="text-ink-muted mt-1">{t('verify.desc') || 'Verify UAE Tax Registration Numbers'}</p>
      </div>

      <Card className="p-6 space-y-4">
        <div>
          <Label htmlFor="trn">{t('verify.trnLabel') || 'TRN Number'}</Label>
          <div className="flex gap-2 mt-1">
            <Input
              id="trn"
              type="text"
              inputMode="numeric"
              maxLength={15}
              placeholder="100000000000000"
              value={trn}
              onChange={(e) => setTrn(e.target.value.replace(/\D/g, '').slice(0, 15))}
              className="flex-1"
            />
            <Button onClick={handleCheck} loading={checking} disabled={!UAE_TRN_RE.test(trn)}>
              <IconSearch size={16} className="mr-2" /> {t('verify.checkBtn') || 'Check TRN'}
            </Button>
          </div>
          <p className="mt-1 text-xs text-ink-muted">{t('verify.hint') || 'Enter a 15-digit UAE Tax Registration Number'}</p>
        </div>

        {result && (
          <div className="border-t pt-4" style={{ borderColor: 'var(--border-subtle)' }}>
            <div className="flex items-center justify-between mb-3">
              <h3 className="font-semibold text-ink">{t('verify.result') || 'Verification Result'}</h3>
<Badge color={result.valid ? 'success' : 'danger'}>
                  {result.valid ? (<span><IconCheckCircle size={12} className="mr-1" /> Valid</span>) : (<span><IconAlert size={12} className="mr-1" /> Invalid</span>)}
                </Badge>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-sm">
              <div><dt className="text-ink-muted">TRN</dt><dd className="mt-0.5 font-mono text-ink">{result.trn}</dd></div>
              <div><dt className="text-ink-muted">Company</dt><dd className="mt-0.5 font-medium text-ink">{result.company_name || '—'}</dd></div>
              <div><dt className="text-ink-muted">Status</dt><dd className="mt-0.5 font-medium text-ink">{result.status || '—'}</dd></div>
              <div><dt className="text-ink-muted">Checked At</dt><dd className="mt-0.5 font-medium text-ink">{result.checked_at ? new Date(result.checked_at).toLocaleString() : '—'}</dd></div>
            </div>
          </div>
        )}

        <div className="border-t pt-4" style={{ borderColor: 'var(--border-subtle)' }}>
          <Button variant="secondary" onClick={handleBulkCheck}>
            <IconCheckCircle size={16} className="mr-2" /> {t('verify.bulkCheck') || 'Bulk Check'}
          </Button>
        </div>
      </Card>
    </div>
  );
}