import React, { useRef } from 'react';
import { Link } from 'react-router-dom';
import { usePageTitle, useMeta } from '../lib/seo.jsx';
import { Reveal } from '../components/Reveal.jsx';
import { StickyMobileCta } from '../components/StickyMobileCta.jsx';
import { useMagnetic } from '../lib/motion.js';
import { IconArrowRight, IconPackage, IconGavel, IconShield, IconFile, IconClock, IconLayers } from '../components/icons.jsx';

const PHOTO = 'https://images.pexels.com/photos/30824313/pexels-photo-30824313.jpeg?cs=srgb&fm=jpg&w=1600';

const STEPS = [
  { n: '01', title: 'Post the requirement', body: 'Equipment, terminal or address, deadline, target price — one structured form. It\'s visible to verified transporters the moment it\'s posted.', icon: <IconPackage size={20} /> },
  { n: '02', title: 'Review bids on your terms', body: 'Compare price, ETA, and each transporter\'s rating and completed-job history. Discuss ancillary charges before you commit — nothing is auto-selected for you.', icon: <IconGavel size={20} /> },
  { n: '03', title: 'Agree and award', body: 'Accept a bid and the price locks. Payment is held for the transport automatically — no invoice to chase, no bank transfer to confirm by phone.', icon: <IconShield size={20} /> },
  { n: '04', title: 'Track it, then release payment', body: 'Watch the job move through pickup, transit, and delivery. Confirm on delivery, or let the automatic release window handle it.', icon: <IconClock size={20} /> },
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
  const heroSectionRef = useRef(null);
  return (
    <div dir="ltr" className="lb-home">
      <div ref={heroSectionRef}>
      <section className="lb-subhero">
        <img className="lb-hero-photo" src={PHOTO} alt="" aria-hidden="true" />
        <div className="lb-hero-wash" />
        <div className="lb-hero-grid" />
        <div className="container-page"><div className="lb-subhero-inner">
          <Reveal>
            <p className="lb-kicker"><i />FOR <span>SHIPPERS</span></p>
            <h1>Post a requirement. Review real bids. Track it to delivery.</h1>
            <p className="lb-hero-lede">
              Post your transport requirement once, receive bids from verified transporters across the UAE, and manage the agreed move — documents, updates, payment status — from one place. No broker calls, no chasing proof of delivery.
            </p>
            <div className="lb-hero-actions">
              <Link ref={heroCtaRef} to="/register" className="btn-accent btn-shine">Post a load <IconArrowRight size={18} /></Link>
              <Link to="/pricing" className="lb-ghost-btn">See pricing</Link>
            </div>
          </Reveal>
        </div></div>
      </section>
      </div>

      <section className="lb-record-section"><div className="container-page">
        <Reveal className="lb-section-heading"><span className="lb-section-no">01 / HOW IT WORKS</span><h2>From post to payout release.</h2><p>The same accountable sequence on every job — nothing lives in a side conversation.</p></Reveal>
        <div className="lb-record-steps lb-record-steps--4">
          {STEPS.map((step, index) => (
            <Reveal key={step.n} delay={index * 70} className="lb-record-step">
              <div className="lb-step-top"><span>{step.n}</span>{step.icon}</div>
              <h3>{step.title}</h3>
              <p>{step.body}</p>
              <i className="lb-step-rail" />
            </Reveal>
          ))}
        </div>
      </div></section>

      <section><div className="container-page">
        <Reveal className="lb-section-heading"><span className="lb-section-no">02 / WHY SHIPPERS STAY</span><h2>Control you never had over the phone.</h2><p>Every mechanic below closes a gap that brokered freight leaves open.</p></Reveal>
        <div className="lb-item-grid">
          {REASONS.map((r, i) => (
            <Reveal key={r.title} delay={(i % 3) * 70} className="lb-item">
              <div className="lb-item-top"><span>R-{String(i + 1).padStart(2, '0')}</span>{r.icon}</div>
              <h3>{r.title}</h3>
              <p>{r.body}</p>
              <i className="lb-item-rail" />
            </Reveal>
          ))}
        </div>
      </div></section>

      <section className="lb-final-cta"><div className="container-page">
        <Reveal className="lb-final-card">
          <span className="lb-section-no">BEGIN WITH THE NEXT MOVEMENT</span>
          <h2>No card required to browse open bids on your first post.</h2>
          <p>Put the next real requirement into Loadbyton and let the record prove its value.</p>
          <div>
            <Link ref={bottomCtaRef} to="/register" className="btn-accent btn-shine">Create a free account <IconArrowRight size={18} /></Link>
            <Link to="/pricing" className="lb-quiet-link">See pricing first</Link>
          </div>
        </Reveal>
      </div></section>
      <StickyMobileCta heroRef={heroSectionRef} to="/register" label="Post a load" />
    </div>
  );
}
