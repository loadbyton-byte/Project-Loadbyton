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
    <div dir="ltr" className="lb-home">
      <section className="lb-subhero">
        <div className="lb-hero-grid" />
        <div className="container-page"><div className="lb-subhero-inner">
          <Reveal>
            <p className="lb-kicker"><i />TRUST <span>& SAFETY</span></p>
            <h1>Working with a company you've never met, without having to just hope it works out.</h1>
            <p className="lb-hero-lede">
              A shipper and a transporter agreeing to a job over chat have no real recourse if one side doesn't deliver. Every one of the mechanics below exists to close that specific gap — not as a marketing claim, but as something enforced on every job.
            </p>
          </Reveal>
        </div></div>
      </section>

      <section><div className="container-page">
        <Reveal className="lb-section-heading"><span className="lb-section-no">01 / THE PILLARS</span><h2>Five mechanics. Zero hoping.</h2><p>Each one closes a specific gap that brokered freight leaves open.</p></Reveal>
        <div className="lb-item-grid">
          {PILLARS.map((p, i) => (
            <Reveal key={p.title} delay={(i % 3) * 70} className="lb-item">
              <div className="lb-item-top"><span>T-{String(i + 1).padStart(2, '0')}</span>{p.icon}</div>
              <h3>{p.title}</h3>
              <p>{p.body}</p>
              <i className="lb-item-rail" />
            </Reveal>
          ))}
        </div>
      </div></section>

      <section className="lb-record-section"><div className="container-page">
        <Reveal className="lb-section-heading"><span className="lb-section-no">02 / HONEST LIMITS</span><h2>What this doesn't mean.</h2><p>None of the above guarantees a transporter shows up on time, or that a shipper's cargo description was accurate — those are still real business risks freight always carries. What it does mean: if something goes wrong, there's a verified counterparty, a payment that hasn't already disappeared, a rating history, and a dispute process — not just a phone number that stopped answering. For exactly how data is secured, see <Link to="/security" className="lb-quiet-link" style={{ color: '#102631' }}>Security</Link>; for the regulatory side, see <Link to="/compliance" className="lb-quiet-link" style={{ color: '#102631' }}>Compliance</Link>.</p></Reveal>
      </div></section>

      <section className="lb-final-cta"><div className="container-page">
        <Reveal className="lb-final-card">
          <span className="lb-section-no">BEGIN WITH THE NEXT MOVEMENT</span>
          <h2>See the verification gate on a real job, not a slide.</h2>
          <p>Create a free account and post a requirement both sides can trust.</p>
          <div>
            <Link to="/register" className="btn-accent btn-shine">Create a free account <IconArrowRight size={18} /></Link>
            <Link to="/security" className="lb-quiet-link">How data is secured</Link>
          </div>
        </Reveal>
      </div></section>
    </div>
  );
}
