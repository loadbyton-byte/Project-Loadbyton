import React from 'react';
import { Link } from 'react-router-dom';
import { usePageTitle, useMeta } from '../lib/seo.jsx';
import { Reveal } from '../components/Reveal.jsx';
import { MediaBackground } from '../components/MediaBackground.jsx';
import { IconArrowRight, IconGavel, IconWallet, IconTruck, IconShield, IconClock, IconStar } from '../components/icons.jsx';

const STEPS = [
  { n: '01', title: 'Get verified once', body: 'Submit your trade licence, TRN, and insurance. Usually reviewed within a day. After that, you can bid on any open load — no re-verifying per job.' },
  { n: '02', title: 'Bid on loads that fit your fleet', body: 'Filter by equipment type, route, and container size. Price and ETA are yours to set — nobody assigns you a job you didn\'t choose to bid on.' },
  { n: '03', title: 'Get awarded, move the freight', body: 'If a shipper picks your bid, the price locks and payment is already held before you pick up. Update status as you go — picked up, in transit, delivered.' },
  { n: '04', title: 'Get paid without chasing anyone', body: 'Confirm delivery, or wait for the automatic release window. The payout is net of Loadbyton\'s take rate — no separate invoice to raise, no following up to get paid.' },
];

const REASONS = [
  { icon: <IconWallet size={20} />, title: 'Payment held before you move', body: 'The shipper\'s payment is held the moment you\'re awarded the job — before you ever load a container. You\'re not extending credit to a shipper you\'ve never worked with.' },
  { icon: <IconGavel size={20} />, title: 'You set your own price', body: 'Every bid is yours — your price, your ETA, your equipment. Loadbyton doesn\'t set rates or assign work without your bid.' },
  { icon: <IconStar size={20} />, title: 'Your rating is portable', body: 'Completed jobs build a public rating and job count. A transporter with a real track record stands out on every future bid, not just this one.' },
  { icon: <IconClock size={20} />, title: 'Fast, predictable payout', body: 'Delivery confirmed, or an automatic release window if the shipper doesn\'t confirm — a payout doesn\'t depend on someone remembering to call you.' },
  { icon: <IconTruck size={20} />, title: 'One-truck or a fleet, both work', body: 'An owner-operator with one truck and a company running fifty are on the same bidding terms. Fleet size doesn\'t gate what loads you can see.' },
  { icon: <IconShield size={20} />, title: 'Verified counterparties only', body: 'Every shipper posting a job on Loadbyton has a real account tied to a real company — not an anonymous number in a broker group chat.' },
];

export default function ForTransporters() {
  usePageTitle('For Transporters');
  useMeta('Join Loadbyton as a transporter, fleet owner, or owner-operator — bid on verified UAE freight jobs, get paid without chasing invoices.');
  return (
    <div dir="ltr">
      <MediaBackground src="https://images.pexels.com/photos/28520996/pexels-photo-28520996.jpeg?cs=srgb&fm=jpg&w=1600" overlay="dark">
        <div className="container-page py-16 md:py-20">
          <Reveal className="max-w-2xl">
            <span className="badge" style={{ background: 'rgba(229,57,53,0.16)', color: '#FF8A80' }}>For transporters</span>
            <h1 className="mt-4 font-display text-3xl font-semibold leading-tight text-white md:text-4xl">Bid on real freight jobs, get paid without chasing anyone.</h1>
            <p className="mt-4 text-lg leading-relaxed text-white/80">
              Whether you run one truck or a fifty-vehicle fleet, verification happens once and bidding is open after that — on jobs from shippers whose payment is already held before you ever load a container.
            </p>
            <div className="mt-8 flex flex-wrap gap-3">
              <Link to="/register?role=CARRIER" className="btn-accent rounded-full px-6 py-3 text-base">Join as a transporter <IconArrowRight size={18} className="btn-arrow-nudge" /></Link>
              <Link to="/pricing" className="btn rounded-full px-6 py-3 text-base" style={{ background: 'rgba(255,255,255,0.08)', border: '1px solid rgba(255,255,255,0.35)', color: '#fff' }}>See the take rate</Link>
            </div>
          </Reveal>
        </div>
      </MediaBackground>

      <section className="border-b py-16 md:py-20" style={{ borderColor: 'var(--border-default)' }}>
        <div className="container-page">
          <Reveal as="h2" className="font-display text-2xl font-semibold text-ink">How it works, start to payout.</Reveal>
          <div className="mt-10 grid gap-8 md:grid-cols-4">
            {STEPS.map((s, i) => (
              <Reveal key={s.n} delay={i * 70}>
                <p className="font-mono text-sm font-semibold" style={{ color: 'var(--brand-accent)' }}>{s.n}</p>
                <p className="mt-2 font-display text-base font-semibold text-ink">{s.title}</p>
                <p className="mt-1.5 text-sm leading-relaxed text-ink-muted">{s.body}</p>
              </Reveal>
            ))}
          </div>
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
            <div>
              <p className="font-display text-xl font-semibold text-white">Verification usually clears within a day.</p>
              <p className="mt-1 text-sm text-white/60">Trade licence, TRN, and insurance — that's it to get started.</p>
            </div>
            <Link to="/register?role=CARRIER" className="btn-accent shrink-0 rounded-full px-6 py-3 text-base">Join as a transporter <IconArrowRight size={18} className="btn-arrow-nudge" /></Link>
          </Reveal>
        </div>
      </section>
    </div>
  );
}
