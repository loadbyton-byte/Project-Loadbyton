import React from 'react';
import { Link } from 'react-router-dom';
import { usePageTitle, useMeta } from '../lib/seo.jsx';
import { Reveal } from '../components/Reveal.jsx';
import { IconArrowRight, IconStorefront, IconAcUnit, IconBoat, IconWarehouse, IconRuler, IconInventory } from '../components/icons.jsx';
import { CAMPAIGN_IMAGES } from '../lib/campaignImages.js';

const PHOTO = CAMPAIGN_IMAGES.materials;

// Sector photography, hotlinked from Pexels — verified live and checked for
// unwanted third-party branding before use (see the marketing-media-refresh
// PR description for the sourcing note).
const INDUSTRIES = [
  {
    icon: <IconStorefront size={20} />,
    title: 'Retail & FMCG',
    body: 'Restocking a warehouse or distribution centre on a schedule the shelves can\'t wait on. Volume inquiries cover a recurring container count at one agreed rate, so a weekly restock doesn\'t mean re-negotiating a price every time.',
    photo: CAMPAIGN_IMAGES.boxTruck,
  },
  {
    icon: <IconRuler size={20} />,
    title: 'Construction & building materials',
    body: 'Steel, cement, tiles, fittings — heavy, awkward, or just bulky freight moving from a port or supplier straight to a site. Equipment posted by type (flatbed, lowbed, tripper) so a transporter can see what the job actually needs before bidding.',
    photo: CAMPAIGN_IMAGES.flatbed,
  },
  {
    icon: <IconAcUnit size={20} />,
    title: 'F&B & cold chain',
    body: 'Temperature matters more than almost anything else in the move. Post the requirement as a reefer container or reefer truck, state the cargo type, and only transporters with the right equipment ever see the job.',
    photo: CAMPAIGN_IMAGES.reefer,
  },
  {
    icon: <IconBoat size={20} />,
    title: 'General trading & re-export',
    body: 'Import, export, and local moves all live on one platform with the same documentation trail — customs paperwork, proof of delivery, and payment status attached to the job permanently, not scattered across a dozen WhatsApp threads with different transporters.',
    photo: CAMPAIGN_IMAGES.port,
  },
  {
    icon: <IconWarehouse size={20} />,
    title: 'Manufacturing & industrial',
    body: 'Inbound raw materials and outbound finished goods, often on a fixed production schedule where a missed pickup window has a real cost. Committed delivery dates and times are part of every bid, not a verbal promise.',
    photo: CAMPAIGN_IMAGES.industrialCargo,
  },
  {
    icon: <IconInventory size={20} />,
    title: 'E-commerce fulfillment',
    body: 'Container-to-warehouse moves feeding a fulfillment operation that runs on inventory arriving when it says it will. Live tracking and a delivery commitment on every job, visible to whoever\'s managing the warehouse side.',
    photo: CAMPAIGN_IMAGES.crossDock,
  },
];

export default function Industries() {
  usePageTitle('Industries');
  useMeta('How different UAE industries — retail, construction, cold chain, trading, manufacturing, e-commerce — use Loadbyton for road freight and container drayage.');
  return (
    <div dir="ltr" className="lb-home">
      <section className="lb-subhero">
        <img className="lb-hero-photo" src={PHOTO} alt="" aria-hidden="true" />
        <div className="lb-hero-wash" />
        <div className="lb-hero-grid" />
        <div className="container-page"><div className="lb-subhero-inner">
          <Reveal>
            <p className="lb-kicker"><i />INDUS<span>TRIES</span></p>
            <h1>Different freight, the same accountable process.</h1>
            <p className="lb-hero-lede">
              A cold-chain move and a construction-materials move need different equipment and different urgency — but the same verified transporters, the same payment protection, and the same paper trail underneath either one.
            </p>
          </Reveal>
        </div></div>
      </section>

      <section><div className="container-page">
        <Reveal className="lb-section-heading"><span className="lb-section-no">01 / SECTORS</span><h2>Six sectors. One record beneath them.</h2><p>Whatever the cargo, the job moves through the same verified, payment-held sequence.</p></Reveal>
        <div className="lb-item-grid">
          {INDUSTRIES.map((ind, i) => (
            <Reveal key={ind.title} delay={(i % 3) * 70} className="lb-item" style={{ padding: 0, overflow: 'hidden' }}>
              <div style={{ aspectRatio: '16/9', overflow: 'hidden' }}>
                <img src={ind.photo} alt="" loading="lazy" style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
              </div>
              <div style={{ padding: '26px' }}>
                <div className="lb-item-top"><span>S-{String(i + 1).padStart(2, '0')}</span>{ind.icon}</div>
                <h3>{ind.title}</h3>
                <p>{ind.body}</p>
              </div>
              <i className="lb-item-rail" />
            </Reveal>
          ))}
        </div>
      </div></section>

      <section className="lb-industrial-break lb-industrial-break--band">
        <img src={PHOTO} alt="Bulk freight operations" />
        <div className="lb-industrial-overlay" />
        <div className="container-page"><Reveal><span>THE FREIGHT VARIES.</span><h2 style={{ fontSize: 'clamp(30px,3.6vw,52px)' }}>The accountability doesn't.</h2></Reveal></div>
      </section>

      <section className="lb-final-cta"><div className="container-page">
        <Reveal className="lb-final-card">
          <span className="lb-section-no">BEGIN WITH THE NEXT MOVEMENT</span>
          <h2>Don't see your exact freight type listed?</h2>
          <p>Post a load and describe it — the record adapts to the cargo, not the other way round.</p>
          <div>
            <Link to="/register" className="btn-accent btn-shine">Post a load and describe it <IconArrowRight size={18} /></Link>
            <Link to="/for-shippers" className="lb-quiet-link">How shippers work</Link>
          </div>
        </Reveal>
      </div></section>
    </div>
  );
}
