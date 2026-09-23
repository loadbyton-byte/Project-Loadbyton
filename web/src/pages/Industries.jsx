// Ported from the design-tool export's pages/Marketing.jsx (IndustriesPage).
import React from 'react';
import { usePageTitle, useMeta } from '../lib/seo.jsx';
import { MktIcon } from '../components/marketing/MktIcon.jsx';
import { SitePage, SubHero, SubSection, SubCta, PHOTOS, PAGE } from '../components/marketing/SubKit.jsx';

const P = PAGE;

const ITEMS = [
  { icon: 'Storefront', title: 'Retail & FMCG', photo: PHOTOS.boxTruck, body: "Restocking a warehouse or distribution centre on a schedule the shelves can't wait on. Volume inquiries cover a recurring container count at one agreed rate, so a weekly restock doesn't mean re-negotiating a price every time." },
  { icon: 'Ruler', title: 'Construction & building materials', photo: PHOTOS.flatbed, body: 'Steel, cement, tiles, fittings — heavy, awkward, or just bulky freight moving from a port or supplier straight to a site. Equipment posted by type (flatbed, lowbed, tripper) so a transporter can see what the job actually needs before bidding.' },
  { icon: 'AcUnit', title: 'F&B & cold chain', photo: PHOTOS.reefer, body: 'Temperature matters more than almost anything else in the move. Post the requirement as a reefer container or reefer truck, state the cargo type, and only transporters with the right equipment ever see the job.' },
  { icon: 'Boat', title: 'General trading & re-export', photo: PHOTOS.port, body: 'Import, export, and local moves all live on one platform with the same documentation trail — customs paperwork, proof of delivery, and payment status attached to the job permanently, not scattered across a dozen WhatsApp threads with different transporters.' },
  { icon: 'Warehouse', title: 'Manufacturing & industrial', photo: PHOTOS.industrialCargo, body: 'Inbound raw materials and outbound finished goods, often on a fixed production schedule where a missed pickup window has a real cost. Committed delivery dates and times are part of every bid, not a verbal promise.' },
  { icon: 'Inventory', title: 'E-commerce fulfillment', photo: PHOTOS.crossDock, body: "Container-to-warehouse moves feeding a fulfillment operation that runs on inventory arriving when it says it will. Live tracking and a delivery commitment on every job, visible to whoever's managing the warehouse side." },
];

export default function Industries() {
  usePageTitle('Industries');
  useMeta('How different UAE industries — retail, construction, cold chain, trading, manufacturing, e-commerce — use Loadbyton for road freight and container drayage.');
  return (
    <SitePage>
      <SubHero photo={PHOTOS.materials} kicker="INDUSTRIES" title="Different freight, the same accountable process." lede="A cold-chain move and a construction-materials move need different equipment and different urgency — but the same verified transporters, the same payment protection, and the same paper trail underneath either one." />
      <SubSection tone="cloud" no="01 / Sectors" title="Six sectors. One record beneath them." copy="Whatever the cargo, the job moves through the same verified, payment-held sequence.">
        <div className="sub-grid">
          {ITEMS.map((it, i) => (
            <article className="pcard pcard--photo" key={it.title} style={{ transitionDelay: (i % 3) * 70 + 'ms' }}>
              <div className="pcard-img"><img src={it.photo} alt="" loading="lazy" /></div>
              <div className="pcard-body">
                <div className="pcard-top"><span className="pcard-num">{'S-' + String(i + 1).padStart(2, '0')}</span><span className="pcard-ico"><MktIcon name={it.icon} size={18} /></span></div>
                <h3>{it.title}</h3><p>{it.body}</p>
              </div>
            </article>
          ))}
        </div>
      </SubSection>
      <section className="sub-band">
        <img src={PHOTOS.materials} alt="Bulk freight operations" />
        <div className="hero-vignette" />
        <div className="container mkt-reveal"><div className="eyebrow">The freight varies.</div><h2>The accountability doesn't.</h2></div>
      </section>
      <SubCta kicker="Begin with the next movement" title="Don't see your exact freight type listed?" body="Post a load and describe it — the record adapts to the cargo, not the other way round." primary={['Post a load and describe it', P.register]} secondary={['How shippers work', P.shippers]} />
    </SitePage>
  );
}
