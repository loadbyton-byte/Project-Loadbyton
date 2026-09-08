import React, { useState } from 'react';
import { api } from '../lib/api.js';
import { usePageTitle } from '../lib/seo.jsx';
import { useLocale } from '../lib/i18n.jsx';
import { Button, Card, Input, Label, ErrorState } from '../components/ui.jsx';
import { useToasts } from '../components/Toast.jsx';
import { useAuth } from '../lib/auth.jsx';
import { IconUser, IconDownload, IconAlert, IconShield } from '../components/icons.jsx';

export default function AccountDeletion() {
  usePageTitle('Account Settings');
  const { t } = useLocale();
  const { addToast } = useToasts();
  const { user, logout } = useAuth();

  const [deleting, setDeleting] = useState(false);
  const [confirmText, setConfirmText] = useState('');
  const [exporting, setExporting] = useState(false);
  const [dangerZone, setDangerZone] = useState(false);

  async function handleExport() {
    setExporting(true);
    try {
      const data = await api.exportAccount();
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `loadbyton-export-${Date.now()}.json`;
      a.click();
      URL.revokeObjectURL(url);
      addToast({ type: 'status_change', title: 'Data exported' });
    } catch (e) {
      addToast({ type: 'system_message', title: e.message || 'Export failed' });
    } finally {
      setExporting(false);
    }
  }

  async function handleDelete() {
    if (confirmText !== 'DELETE') {
      addToast({ type: 'system_message', title: 'Type "DELETE" to confirm' });
      return;
    }
    setDeleting(true);
    try {
      await api.deleteAccount();
      addToast({ type: 'status_change', title: 'Account deleted' });
      logout();
    } catch (e) {
      addToast({ type: 'system_message', title: e.message || 'Deletion failed' });
    } finally {
      setDeleting(false);
    }
  }

  return (
    <div className="container-page max-w-2xl">
      <div className="mb-6">
        <h1 className="font-display text-2xl font-bold text-ink flex items-center gap-2">
          <IconUser size={24} /> {t('account.settings', 'Account Settings')}
        </h1>
        <p className="text-ink-muted mt-1">{t('account.desc', 'Manage your account data and privacy')}</p>
      </div>

      <Card className="mb-6 p-6">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="font-semibold text-ink">{t('account.exportData', 'Export Your Data')}</h3>
            <p className="text-sm text-ink-muted mt-1">{t('account.exportDesc', 'Download a copy of all your data (jobs, bids, documents, messages, etc.) in JSON format')}</p>
          </div>
          <Button onClick={handleExport} loading={exporting}>
            <IconDownload size={16} className="mr-2" /> {t('account.exportBtn', 'Export Data')}
          </Button>
        </div>
      </Card>

      <Card className="mb-6 p-6" style={{ borderColor: 'var(--status-warning-bg)' }}>
        <div className="flex items-center gap-3 mb-4">
          <IconAlert size={24} className="text-status-warning" />
          <div>
            <h3 className="font-semibold text-ink">{t('account.dangerZone', 'Danger Zone')}</h3>
            <p className="text-sm text-ink-muted">{t('account.dangerDesc', 'Irreversible actions — proceed with caution')}</p>
          </div>
        </div>

        <div className="border-t pt-4" style={{ borderColor: 'var(--status-warning-bg)' }}>
          <Button variant="ghost" onClick={() => setDangerZone(true)}>
            <IconAlert size={16} className="mr-2" /> {t('account.deleteAccount', 'Delete Account')}
          </Button>
        </div>
      </Card>

      {dangerZone && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60" onClick={() => setDangerZone(false)} role="dialog" aria-modal="true" aria-label="Confirm account deletion">
          <div className="w-full max-w-md rounded-xl border bg-surface shadow-2xl" style={{ borderColor: 'var(--status-danger-bg)', background: 'var(--bg-surface)' }} onClick={(e) => e.stopPropagation()}>
            <div className="p-6">
              <div className="flex items-center gap-3 mb-4">
                <IconAlert size={24} className="text-status-danger" />
                <h3 className="font-display text-lg font-bold text-ink">{t('account.confirmDelete', 'Confirm Account Deletion')}</h3>
              </div>
              <p className="text-ink-secondary mb-6">{t('account.deleteWarning', 'This action is irreversible. All your jobs, bids, documents, messages, and payment history will be permanently deleted. This cannot be undone.')}</p>
              <div className="mb-4">
                <Label htmlFor="confirmDelete">{t('account.typeDelete', 'Type "DELETE" to confirm')}</Label>
                <Input id="confirmDelete" type="text" value={confirmText} onChange={(e) => setConfirmText(e.target.value)} placeholder="DELETE" className="mt-1 font-mono" />
              </div>
              <div className="flex gap-2">
                <Button variant="ghost" className="flex-1" onClick={() => setDangerZone(false)}>{t('common.cancel', 'Cancel')}</Button>
                <Button variant="danger" className="flex-1" onClick={handleDelete} loading={deleting} disabled={confirmText !== 'DELETE'}>
                  <IconUser size={16} className="mr-2" /> {t('account.deleteBtn', 'Delete My Account')}
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}