import React from 'react';
import { Link } from 'react-router-dom';
import { usePageTitle, useMeta } from '../lib/seo.jsx';
import { Reveal } from '../components/Reveal.jsx';
import { IconArrowRight, IconStorefront, IconAcUnit, IconBoat, IconWarehouse, IconRuler, IconInventory } from '../components/icons.jsx';

const INDUSTRIES = [
  {
    icon: <IconStorefront size={20} />,
    title: 'Retail & FMCG',
    body: 'Restocking a warehouse or distribution centre on a schedule the shelves can\'t wait on. Volume inquiries cover a recurring container count at one agreed rate, so a weekly restock doesn\'t mean re-negotiating a price every time.',
  },
  {
    icon: <IconRuler size={20} />,
    title: 'Construction & building materials',
    body: 'Steel, cement, tiles, fittings — heavy, awkward, or just bulky freight moving from a port or supplier straight to a site. Equipment posted by type (flatbed, lowbed, tripper) so a transporter can see what the job actually needs before bidding.',
  },
  {
    icon: <IconAcUnit size={20} />,
    title: 'F&B & cold chain',
    body: 'Temperature matters more than almost anything else in the move. Post the requirement as a reefer container or reefer truck, state the cargo type, and only transporters with the right equipment ever see the job.',
  },
  {
    icon: <IconBoat size={20} />,
    title: 'General trading & re-export',
    body: 'Import, export, and local moves all live on one platform with the same documentation trail — customs paperwork, proof of delivery, and payment status attached to the job permanently, not scattered across a dozen WhatsApp threads with different transporters.',
  },
  {
    icon: <IconWarehouse size={20} />,
    title: 'Manufacturing & industrial',
    body: 'Inbound raw materials and outbound finished goods, often on a fixed production schedule where a missed pickup window has a real cost. Committed delivery dates and times are part of every bid, not a verbal promise.',
  },
  {
    icon: <IconInventory size={20} />,
    title: 'E-commerce fulfillment',
    body: 'Container-to-warehouse moves feeding a fulfillment operation that runs on inventory arriving when it says it will. Live tracking and a delivery commitment on every job, visible to whoever\'s managing the warehouse side.',
  },
];

export default function Industries() {
  usePageTitle('Industries');
  useMeta('How different UAE industries — retail, construction, cold chain, trading, manufacturing, e-commerce — use Loadbyton for road freight and container drayage.');
  return (
    <div dir="ltr">
      <section className="border-b" style={{ borderColor: 'var(--border-default)' }}>
        <div className="container-page py-16 md:py-20">
          <Reveal className="max-w-2xl">
            <span className="badge" style={{ background: 'var(--brand-accent-bg)', color: 'var(--brand-accent-on-tint)' }}>Industries</span>
            <h1 className="mt-4 font-display text-3xl font-semibold leading-tight text-ink md:text-4xl">Different freight, the same accountable process.</h1>
            <p className="mt-4 text-lg leading-relaxed text-ink-secondary">
              A cold-chain move and a construction-materials move need different equipment and different urgency — but the same verified transporters, the same payment protection, and the same paper trail underneath either one.
            </p>
          </Reveal>
        </div>
      </section>

      <section className="py-16 md:py-20">
        <div className="container-page">
          <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {INDUSTRIES.map((ind, i) => (
              <Reveal key={ind.title} delay={(i % 3) * 70} className="card card-hover p-6">
                <div className="flex h-10 w-10 items-center justify-center rounded-md" style={{ background: 'var(--bg-raised)', color: 'var(--brand-accent)' }}>{ind.icon}</div>
                <p className="mt-4 font-display text-base font-semibold text-ink">{ind.title}</p>
                <p className="mt-1.5 text-sm leading-relaxed text-ink-muted">{ind.body}</p>
              </Reveal>
            ))}
          </div>
        </div>
      </section>

      <section className="pb-16 md:pb-20">
        <div className="container-page">
          <Reveal
            className="flex flex-col items-start justify-between gap-6 rounded-xl px-8 py-10 sm:flex-row sm:items-center"
            style={{ background: 'var(--lb-ink-900)' }}
          >
            <p className="font-display text-xl font-semibold text-white">Don't see your exact freight type listed?</p>
            <Link to="/register" className="btn-accent shrink-0 rounded-full px-6 py-3 text-base">Post a load and describe it <IconArrowRight size={18} /></Link>
          </Reveal>
        </div>
      </section>
    </div>
  );
}
