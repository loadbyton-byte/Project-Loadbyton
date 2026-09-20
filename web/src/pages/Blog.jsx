import React from 'react';
import { Link } from 'react-router-dom';
import { usePageTitle, useMeta } from '../lib/seo.jsx';
import { formatDate } from '../lib/constants.js';
import { Reveal } from '../components/Reveal.jsx';
import { IconArrowRight } from '../components/icons.jsx';
import { CAMPAIGN_IMAGES } from '../lib/campaignImages.js';

const PHOTO = CAMPAIGN_IMAGES.customs;

const POSTS = [
  {
    title: 'The idle container is the real cost of drayage — the truck is almost beside the point',
    date: '2026-07-18',
    tag: 'Operations',
    body: 'A container sitting uncollected at the terminal for two extra days quietly outspends the truck that moved it. The fix isn\'t a faster truck — it\'s a committed delivery date and time attached to every job, not a separate spreadsheet someone forgets to check.',
    photo: CAMPAIGN_IMAGES.containerChassis,
  },
  {
    title: 'Why "just add a phone number field" breaks a freight marketplace',
    date: '2026-06-30',
    tag: 'Product',
    body: 'The moment a shipper and transporter can text each other directly, the second job happens off-platform — at which point the marketplace only ever sees the first transaction from any given pair. Contact gating isn\'t friction for its own sake; it\'s the difference between a marketplace and a one-time introduction service.',
    photo: CAMPAIGN_IMAGES.fleet,
  },
  {
    title: 'A payment-holding state machine is not optional, even for a demo',
    date: '2026-06-05',
    tag: 'Engineering',
    body: 'PENDING, HELD, FUNDED, RELEASED, DISPUTED — five states, and every transition has to be enforced server-side or the payment protection story is fiction. Building it as a real state machine from day one, even before a licensed payment rail exists, is what makes the eventual real-money version a swap of the execution layer, not a rewrite.',
    photo: CAMPAIGN_IMAGES.smartGate,
  },
];

export default function Blog() {
  usePageTitle('Blog');
  useMeta('Notes on UAE drayage logistics and building a freight marketplace that survives past the first job.');
  return (
    <div dir="ltr" className="lb-home">
      <section className="lb-subhero">
        <img className="lb-hero-photo" src={PHOTO} alt="" aria-hidden="true" />
        <div className="lb-hero-wash" />
        <div className="lb-hero-grid" />
        <div className="container-page"><div className="lb-subhero-inner">
          <Reveal>
            <p className="lb-kicker"><i />BL<span>OG</span></p>
            <h1>Notes from building Loadbyton</h1>
            <p className="lb-hero-lede">Field notes on UAE drayage economics and the product/engineering decisions behind the platform.</p>
          </Reveal>
        </div></div>
      </section>

      <section><div className="container-page">
        <Reveal className="lb-section-heading"><span className="lb-section-no">01 / FIELD NOTES</span><h2>Three essays, no content marketing.</h2></Reveal>
        <div style={{ marginTop: 8 }}>
          {POSTS.map((p, i) => (
            <Reveal key={p.title} delay={i * 60} as="article" className="lb-post">
              <div>
                <p className="lb-post-meta"><span>{p.tag}</span><time>{formatDate(p.date)}</time></p>
                <h2>{p.title}</h2>
                <p>{p.body}</p>
              </div>
              <img src={p.photo} alt="" loading="lazy" />
            </Reveal>
          ))}
        </div>
      </div></section>

      <section className="lb-final-cta"><div className="container-page">
        <Reveal className="lb-final-card">
          <span className="lb-section-no">NEXT</span>
          <h2>Read enough. Move freight.</h2>
          <div>
            <Link to="/register" className="btn-accent btn-shine">Start with one load <IconArrowRight size={18} /></Link>
            <Link to="/" className="lb-quiet-link">Back to the platform</Link>
          </div>
        </Reveal>
      </div></section>
    </div>
  );
}
