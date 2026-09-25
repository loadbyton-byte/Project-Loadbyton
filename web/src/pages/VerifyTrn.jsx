import React, { useState } from 'react';
import { api } from '../lib/api.js';
import { usePageTitle } from '../lib/seo.jsx';
import { useLocale } from '../lib/i18n.jsx';
import { Button, Card, Input, Label, Badge, Textarea, ErrorState } from '../components/ui.jsx';
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
  const [bulkInput, setBulkInput] = useState('');
  const [bulkResults, setBulkResults] = useState(null);
  const [bulkChecking, setBulkChecking] = useState(false);

  const UAE_TRN_RE = /^\d{15}$/;

  async function handleCheck() {
    if (!UAE_TRN_RE.test(trn)) {
      addToast({ type: 'system_message', title: 'TRN must be exactly 15 digits' });
      return;
    }
    setChecking(true);
    try {
      const data = await api.verifyTrn(trn);
      setResult(data);
      addToast({ type: data.valid ? 'status_change' : 'system_message', title: data.valid ? 'TRN is valid' : 'TRN not found' });
    } catch (e) {
      addToast({ type: 'system_message', title: e.message || 'Verification failed' });
    } finally {
      setChecking(false);
    }
  }

  // A real bulk check, not the permanent "not yet implemented" stub this
  // button used to be — reuses the same single-TRN endpoint the form above
  // calls, once per line, since there's no separate batch endpoint on the
  // backend (server/routes/verify.routes.js only ever exposed a one-TRN
  // check). Invalid/malformed lines are reported inline rather than
  // silently skipped or sent to the server.
  async function handleBulkCheck() {
    const lines = [...new Set(bulkInput.split(/[\n,]+/).map((s) => s.trim()).filter(Boolean))];
    if (lines.length === 0) {
      addToast({ type: 'system_message', title: 'Enter at least one TRN' });
      return;
    }
    setBulkChecking(true);
    setBulkResults(null);
    try {
      const results = await Promise.all(lines.map(async (line) => {
        if (!UAE_TRN_RE.test(line)) return { trn: line, error: 'Must be exactly 15 digits' };
        try {
          const data = await api.verifyTrn(line);
          return { trn: line, valid: data.valid, company_name: data.company_name };
        } catch (e) {
          return { trn: line, error: e.message || 'Check failed' };
        }
      }));
      setBulkResults(results);
      const validCount = results.filter((r) => r.valid).length;
      addToast({ type: 'status_change', title: `Checked ${results.length} TRN(s)`, body: `${validCount} valid, ${results.length - validCount} invalid or errored.` });
    } finally {
      setBulkChecking(false);
    }
  }

  return (
    <div className="container-page max-w-2xl">
      <div className="mb-6">
        <h1 className="font-display text-2xl font-bold text-ink flex items-center gap-2">
          <IconShield size={24} /> {t('verify.title', 'TRN Verification')}
        </h1>
        <p className="text-ink-muted mt-1">{t('verify.desc', 'Verify UAE Tax Registration Numbers')}</p>
      </div>

      <Card className="p-6 space-y-4">
        <div>
          <Label htmlFor="trn">{t('verify.trnLabel', 'TRN Number')}</Label>
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
              <IconSearch size={16} className="me-2" /> {t('verify.checkBtn', 'Check TRN')}
            </Button>
          </div>
          <p className="mt-1 text-xs text-ink-muted">{t('verify.hint', 'Enter a 15-digit UAE Tax Registration Number')}</p>
        </div>

        {result && (
          <div className="border-t pt-4" style={{ borderColor: 'var(--border-subtle)' }}>
            <div className="flex items-center justify-between mb-3">
              <h3 className="font-semibold text-ink">{t('verify.result', 'Verification Result')}</h3>
<Badge color={result.valid ? 'success' : 'danger'}>
                  {result.valid ? (<span><IconCheckCircle size={12} className="me-1" /> Valid</span>) : (<span><IconAlert size={12} className="me-1" /> Invalid</span>)}
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
          <Label htmlFor="bulk-trn">{t('verify.bulkLabel', 'Bulk check (one TRN per line)')}</Label>
          <Textarea
            id="bulk-trn"
            rows={4}
            placeholder={'100000000000001\n100000000000002\n100000000000003'}
            value={bulkInput}
            onChange={(e) => setBulkInput(e.target.value)}
            className="mt-1 font-mono text-sm"
          />
          <Button variant="secondary" className="mt-2" onClick={handleBulkCheck} loading={bulkChecking}>
            <IconCheckCircle size={16} className="me-2" /> {t('verify.bulkCheck', 'Bulk Check')}
          </Button>

          {bulkResults && (
            <ul className="mt-3 space-y-1.5 text-sm">
              {bulkResults.map((r, i) => (
                <li key={`${r.trn}-${i}`} className="flex items-center justify-between gap-2 rounded-md px-2 py-1" style={{ background: 'var(--surface-container)' }}>
                  <span className="font-mono">{r.trn}</span>
                  {r.error ? (
                    <Badge color="danger"><IconAlert size={12} className="me-1" /> {r.error}</Badge>
                  ) : (
                    <Badge color={r.valid ? 'success' : 'danger'}>
                      {r.valid ? (<span><IconCheckCircle size={12} className="me-1" /> Valid{r.company_name ? ` — ${r.company_name}` : ''}</span>) : (<span><IconAlert size={12} className="me-1" /> Invalid</span>)}
                    </Badge>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      </Card>
    </div>
  );
}