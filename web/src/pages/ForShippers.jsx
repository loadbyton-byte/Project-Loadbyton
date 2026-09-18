import React from 'react';
import { Link } from 'react-router-dom';
import { usePageTitle, useMeta } from '../lib/seo.jsx';
import { Reveal } from '../components/Reveal.jsx';
import { MediaBackground } from '../components/MediaBackground.jsx';
import { ScrollSteps } from '../components/ScrollSteps.jsx';
import { useMagnetic } from '../lib/motion.js';
import { IconArrowRight, IconPackage, IconGavel, IconShield, IconFile, IconClock, IconLayers } from '../components/icons.jsx';

const STEPS = [
  { n: '01', title: 'Post the requirement', body: 'Equipment, terminal or address, deadline, target price — one structured form. It\'s visible to verified transporters the moment it\'s posted.' },
  { n: '02', title: 'Review bids on your terms', body: 'Compare price, ETA, and each transporter\'s rating and completed-job history. Discuss ancillary charges before you commit — nothing is auto-selected for you.' },
  { n: '03', title: 'Agree and award', body: 'Accept a bid and the price locks. Payment is held for the transport automatically — no invoice to chase, no bank transfer to confirm by phone.' },
  { n: '04', title: 'Track it, then release payment', body: 'Watch the job move through pickup, transit, and delivery. Confirm on delivery, or let the automatic release window handle it.' },
];

const REASONS = [
  { icon: <IconShield size={20} />, title: 'Every transporter is verified', body: 'Trade licence, TRN, and insurance checked before a transporter can place a single bid — enforced server-side, not just a badge in a profile.' },
  { icon: <IconGavel size={20} />, title: 'You choose the bid, not an algorithm', body: 'Every bid on your job is visible to you, with price, ETA, and equipment. You pick who moves your freight — nothing is auto-assigned.' },
  { icon: <IconClock size={20} />, title: 'Committed delivery times', body: 'Every bid carries an ETA the transporter is bidding against, and every job shows its live position — not a verbal "should be there by end of day."' },
  { icon: <IconFile size={20} />, title: 'One place for the whole record', body: 'Customs paperwork, receipts, and proof of delivery live on the job permanently — with a full audit trail, not a chat thread that disappears once the truck arrives.' },
  { icon: <IconLayers size={20} />, title: 'Built for the repeat shipment', body: 'Save a lane as a template and re-post it in one click. Volume inquiries cover a recurring container or truck count at one agreed price, without renegotiating every time.' },
  { icon: <IconPackage size={20} />, title: 'No broker relationship required', body: 'Post once, get bids from multiple transporters directly. You\'re not tied to whichever broker happens to answer the phone that day.' },
];

export default function ForShippers() {
  usePageTitle('For Shippers');
  useMeta('Post a road freight or container drayage requirement in the UAE, review bids from verified transporters, and manage the move from one place.');
  const heroCtaRef = useMagnetic();
  const bottomCtaRef = useMagnetic();
  return (
    <div dir="ltr">
      <MediaBackground src="https://images.pexels.com/photos/30824313/pexels-photo-30824313.jpeg?cs=srgb&fm=jpg&w=1600" overlay="dark">
        <div className="container-page py-16 md:py-20">
          <Reveal className="max-w-2xl">
            <span className="badge" style={{ background: 'rgba(229,57,53,0.16)', color: '#FF8A80' }}>For shippers</span>
            <h1 className="mt-4 font-display text-3xl font-semibold leading-tight text-white md:text-4xl">Post a requirement. Review real bids. Track it to delivery.</h1>
            <p className="mt-4 text-lg leading-relaxed text-white/80">
              Post your transport requirement once, receive bids from verified transporters across the UAE, and manage the agreed move — documents, updates, payment status — from one place. No broker calls, no chasing proof of delivery.
            </p>
            <div className="mt-8 flex flex-wrap gap-3">
              <Link ref={heroCtaRef} to="/register" className="btn-accent btn-shine rounded-full px-6 py-3 text-base">Post a load <IconArrowRight size={18} className="btn-arrow-nudge" /></Link>
              <Link to="/pricing" className="btn rounded-full px-6 py-3 text-base" style={{ background: 'rgba(255,255,255,0.08)', border: '1px solid rgba(255,255,255,0.35)', color: '#fff' }}>See pricing</Link>
            </div>
          </Reveal>
        </div>
      </MediaBackground>

      <section className="border-b py-16 md:py-20" style={{ borderColor: 'var(--border-default)' }}>
        <div className="container-page">
          <Reveal as="h2" className="font-display text-2xl font-semibold text-ink">How it works, post to payout release.</Reveal>
          <ScrollSteps
            className="mt-10"
            steps={STEPS}
            renderStep={(s) => (
              <>
                <p className="font-mono text-sm font-semibold" style={{ color: 'var(--brand-accent)' }}>{s.n}</p>
                <p className="mt-2 font-display text-base font-semibold text-ink">{s.title}</p>
                <p className="mt-1.5 text-sm leading-relaxed text-ink-muted">{s.body}</p>
              </>
            )}
          />
        </div>
      </section>

      <section className="py-16 md:py-20">
        <div className="container-page">
          <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {REASONS.map((r, i) => (
              <Reveal key={r.title} delay={(i % 3) * 70} className="card card-hover p-6">
                <div className="flex h-10 w-10 items-center justify-center rounded-md" style={{ background: 'var(--bg-raised)', color: 'var(--brand-accent)' }}>{r.icon}</div>
                <p className="mt-4 font-display text-base font-semibold text-ink">{r.title}</p>
                <p className="mt-1.5 text-sm leading-relaxed text-ink-muted">{r.body}</p>
              </Reveal>
            ))}
          </div>
        </div>
      </section>

      <section className="pb-16 md:pb-20">
        <div className="container-page">
          <Reveal className="flex flex-col items-start justify-between gap-6 rounded-xl px-8 py-10 sm:flex-row sm:items-center" style={{ background: 'var(--lb-ink-900)' }}>
            <p className="font-display text-xl font-semibold text-white">No card required to browse open bids on your first post.</p>
            <Link ref={bottomCtaRef} to="/register" className="btn-accent btn-shine shrink-0 rounded-full px-6 py-3 text-base">Create a free account <IconArrowRight size={18} className="btn-arrow-nudge" /></Link>
          </Reveal>
        </div>
      </section>
    </div>
  );
}
