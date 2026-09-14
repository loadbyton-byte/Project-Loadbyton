import React from 'react';
import { Link } from 'react-router-dom';
import { usePageTitle, useMeta } from '../lib/seo.jsx';
import { Reveal } from '../components/Reveal.jsx';
import { IconArrowRight, IconShield, IconWallet, IconStar, IconGavel, IconFile } from '../components/icons.jsx';

const PILLARS = [
  {
    icon: <IconShield size={20} />,
    title: 'Verified before they can bid',
    body: 'A transporter\'s TRN, trade licence, and insurance are checked before their first bid is ever visible to a shipper — enforced on the server, not a badge that\'s just displayed and never actually gated anything.',
  },
  {
    icon: <IconWallet size={20} />,
    title: 'Payment held, not sent on a promise',
    body: 'The agreed price is held the moment a bid is awarded, before pickup. It releases when the shipper confirms delivery — or automatically after a fixed window if they don\'t — so a transporter isn\'t working on a verbal assurance, and a shipper isn\'t paying before the job is even done.',
  },
  {
    icon: <IconStar size={20} />,
    title: 'Ratings that actually compound',
    body: 'Every completed job updates a transporter or shipper\'s public rating. A transporter with 300 completed jobs and a 4.8 average is a different bid to evaluate than one with none — and that history is visible before you accept it, not something you find out after.',
  },
  {
    icon: <IconGavel size={20} />,
    title: 'A real dispute process, not a dead end',
    body: 'If something goes wrong after award, either side can open a dispute. It pauses the payment and puts a human reviewer on it — the outcome isn\'t decided by whoever complains first or loudest.',
  },
  {
    icon: <IconFile size={20} />,
    title: 'A paper trail that survives the job',
    body: 'Customs documents, proof of delivery, and every award, status change, and payment event on a job are recorded permanently and can\'t be edited or deleted after the fact — not a chat thread that disappears once the truck arrives.',
  },
];

export default function Trust() {
  usePageTitle('Trust & Safety');
  useMeta('How Loadbyton protects both sides of a freight job — transporter verification, payment protection, ratings, and dispute resolution — before, during, and after a move.');
  return (
    <div dir="ltr">
      <section className="border-b" style={{ borderColor: 'var(--border-default)' }}>
        <div className="container-page py-16 md:py-20">
          <Reveal className="max-w-2xl">
            <span className="badge" style={{ background: 'var(--brand-accent-bg)', color: 'var(--brand-accent-on-tint)' }}>Trust & Safety</span>
            <h1 className="mt-4 font-display text-3xl font-semibold leading-tight text-ink md:text-4xl">Working with a company you've never met, without having to just hope it works out.</h1>
            <p className="mt-4 text-lg leading-relaxed text-ink-secondary">
              A shipper and a transporter agreeing to a job over chat have no real recourse if one side doesn't deliver. Every one of the mechanics below exists to close that specific gap — not as a marketing claim, but as something enforced on every job.
            </p>
          </Reveal>
        </div>
      </section>

      <section className="py-16 md:py-20">
        <div className="container-page">
          <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {PILLARS.map((p, i) => (
              <Reveal key={p.title} delay={(i % 3) * 70} className="card card-hover p-6">
                <div className="flex h-10 w-10 items-center justify-center rounded-md" style={{ background: 'var(--bg-raised)', color: 'var(--brand-accent)' }}>{p.icon}</div>
                <p className="mt-4 font-display text-base font-semibold text-ink">{p.title}</p>
                <p className="mt-1.5 text-sm leading-relaxed text-ink-muted">{p.body}</p>
              </Reveal>
            ))}
          </div>
        </div>
      </section>

      <section className="border-t py-16 md:py-20" style={{ borderColor: 'var(--border-default)' }}>
        <div className="container-page max-w-2xl">
          <Reveal>
            <h2 className="font-display text-2xl font-semibold text-ink">What this doesn't mean</h2>
            <p className="mt-4 text-sm leading-relaxed text-ink-secondary">
              None of the above guarantees a transporter shows up on time, or that a shipper's cargo description was accurate — those are still real business risks freight always carries. What it does mean: if something goes wrong, there's a verified counterparty, a payment that hasn't already disappeared, a rating history, and a dispute process — not just a phone number that stopped answering. For exactly how data is secured, see <Link to="/security" className="text-brand-secondary hover:underline">Security</Link>; for the regulatory side, see <Link to="/compliance" className="text-brand-secondary hover:underline">Compliance</Link>.
            </p>
          </Reveal>
        </div>
      </section>

      <section className="pb-16 md:pb-20">
        <div className="container-page">
          <Reveal className="flex flex-col items-start justify-between gap-6 rounded-xl px-8 py-10 sm:flex-row sm:items-center" style={{ background: 'var(--lb-ink-900)' }}>
            <p className="font-display text-xl font-semibold text-white">See the verification gate on a real job, not a slide.</p>
            <Link to="/register" className="btn-accent shrink-0 rounded-full px-6 py-3 text-base">Create a free account <IconArrowRight size={18} /></Link>
          </Reveal>
        </div>
      </section>
    </div>
  );
}
