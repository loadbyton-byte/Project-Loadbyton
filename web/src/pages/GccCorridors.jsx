import React, { useEffect, useState } from 'react';
import { api } from '../lib/api.js';
import { usePageTitle } from '../lib/seo.jsx';
import { useLocale } from '../lib/i18n.jsx';
import { Card, Badge, EmptyState } from '../components/ui.jsx';
import { useToasts } from '../components/Toast.jsx';
import { IconMapPin, IconFlag, IconTruck, IconClock } from '../components/icons.jsx';

export default function GccCorridors() {
  usePageTitle('GCC Corridors');
  const { t } = useLocale();
  const { addToast } = useToasts();

  const [countries, setCountries] = useState([]);
  const [corridors, setCorridors] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchData();
  }, []);

  async function fetchData() {
    try {
      const [countriesData, corridorsData] = await Promise.all([
        api.getGccCountries(),
        api.getGccCorridors(),
      ]);
      setCountries(countriesData.countries || []);
      setCorridors(corridorsData.corridors || []);
    } catch (e) {
      addToast(e.message || 'Failed to load GCC data', 'error');
    } finally {
      setLoading(false);
    }
  }

  if (loading) return <div className="flex justify-center py-12"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-brand-primary" /></div>;

  return (
    <div className="container-page max-w-5xl">
      <div className="mb-6">
        <h1 className="font-display text-2xl font-bold text-ink">{t('gcc.title') || 'GCC Corridors'}</h1>
        <p className="text-ink-muted mt-1">{t('gcc.desc') || 'Pre-configured corridors and country rules for cross-border freight'}</p>
      </div>

      <div className="grid gap-6 md:grid-cols-2">
        <Card>
          <Card.Header><Card.Title className="flex items-center gap-2"><IconFlag size={20} /> {t('gcc.countries') || 'GCC Countries'}</Card.Title></Card.Header>
          <Card.Content>
            {countries.length === 0 ? (
              <EmptyState icon={<IconFlag size={28} />} title="No countries" description="No GCC countries configured" />
            ) : (
              <div className="space-y-3">
                {countries.map((c) => (
                  <div key={c.code} className="flex items-center justify-between p-3 rounded-lg border" style={{ borderColor: 'var(--border-subtle)' }}>
                    <div className="flex items-center gap-3">
                      <span className="text-2xl">{c.flag || '🏳️'}</span>
                      <div>
                        <p className="font-medium text-ink">{c.name}</p>
                        <p className="text-xs text-ink-muted">{c.code}</p>
                      </div>
                    </div>
                    <Badge color={c.active ? 'success' : 'neutral'}>{c.active ? 'Active' : 'Inactive'}</Badge>
                  </div>
                ))}
              </div>
            )}
          </Card.Content>
        </Card>

        <Card>
          <Card.Header><Card.Title className="flex items-center gap-2"><IconMapPin size={20} /> {t('gcc.corridors') || 'Corridors'}</Card.Title></Card.Header>
          <Card.Content>
            {corridors.length === 0 ? (
              <EmptyState icon={<IconMapPin size={28} />} title="No corridors" description="No GCC corridors configured" />
            ) : (
              <div className="space-y-3">
                {corridors.map((c) => (
                  <div key={c.id} className="flex items-center justify-between p-3 rounded-lg border" style={{ borderColor: 'var(--border-subtle)' }}>
                    <div className="flex-1 min-w-0">
                      <p className="font-medium text-ink">{c.origin_name} → {c.destination_name}</p>
                      <p className="text-xs text-ink-muted flex items-center gap-1">
                        <IconTruck size={12} /> {c.distance_km} km · <IconClock size={12} /> {c.estimated_hours}h
                      </p>
                    </div>
                    <Badge color={c.active ? 'success' : 'neutral'}>{c.active ? 'Active' : 'Inactive'}</Badge>
                  </div>
                ))}
              </div>
            )}
          </Card.Content>
        </Card>
      </div>
    </div>
  );
}