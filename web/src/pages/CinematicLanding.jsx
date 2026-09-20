import React, { useEffect, useRef, useState } from 'react';
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
  const frameRef = useRef(null);
  const [frameHeight, setFrameHeight] = useState(900);

  useEffect(() => {
    const onMessage = (event) => {
      if (event.origin !== window.location.origin || event.source !== frameRef.current?.contentWindow) return;
      if (event.data?.type !== 'loadbyton:cinematic-height') return;
      const nextHeight = Number(event.data.height);
      if (Number.isFinite(nextHeight) && nextHeight > 0) setFrameHeight(Math.ceil(nextHeight));
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, []);

  if (loading) {
    return <div className="flex min-h-dvh items-center justify-center" style={{ background: 'var(--lb-ink-950)' }}><Spinner size={28} className="text-white" /></div>;
  }
  if (user) return <Navigate to={homePath(user, actingAs)} replace />;

  return (
    <iframe
      ref={frameRef}
      title="Loadbyton — One Load. One Context."
      src="/loadbyton-cinematic-home.html?embedded=1"
      className="block w-full border-0"
      style={{ height: `${frameHeight}px`, background: 'var(--lb-ink-950)' }}
      scrolling="no"
    />
  );
}
