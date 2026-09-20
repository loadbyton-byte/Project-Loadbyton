import React from 'react';
import { useAuth, homePath } from '../lib/auth.jsx';
import { Navigate } from 'react-router-dom';
import { Spinner } from '../components/ui.jsx';

/**
 * The approved homepage is a self-contained cinematic document with embedded
 * high-resolution imagery and its own interaction runtime. Keeping it in an
 * isolated frame preserves the supplied design exactly and prevents legacy
 * application styles from changing its typography, spacing or motion.
 */
export default function CinematicLanding() {
  const { user, actingAs, loading } = useAuth();
  if (loading) {
    return <div className="flex min-h-dvh items-center justify-center" style={{ background: 'var(--lb-ink-950)' }}><Spinner size={28} className="text-white" /></div>;
  }
  if (user) return <Navigate to={homePath(user, actingAs)} replace />;

  return (
    <iframe
      title="Loadbyton — One Load. One Context."
      src="/loadbyton-cinematic-home.html"
      className="block min-h-dvh w-full border-0"
      style={{ height: '100dvh', background: 'var(--lb-ink-950)' }}
    />
  );
}
