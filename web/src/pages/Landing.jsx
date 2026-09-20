import React, { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../lib/api.js';
import { formatAED, formatLabel } from '../lib/constants.js';
import { usePageTitle } from '../lib/seo.jsx';
import { Reveal } from '../components/Reveal.jsx';
import { StickyMobileCta } from '../components/StickyMobileCta.jsx';
import { useMagnetic } from '../lib/motion.js';
import { IconArrowRight, IconCheck, IconCheckCircle, IconClock, IconFile, IconMapPin, IconMessage, IconPackage, IconShield, IconTruck } from '../components/icons.jsx';
import { CAMPAIGN_IMAGES } from '../lib/campaignImages.js';

const PHOTO = {
  hero: CAMPAIGN_IMAGES.containerChassis,
  port: CAMPAIGN_IMAGES.port,
};

const RECORD_STEPS = [
  { id: '01', title: 'Post', body: 'Lane, equipment, time and target price become one structured requirement.', icon: IconPackage },
  { id: '02', title: 'Discover', body: 'Verified capacity sees the load. Every response returns to the same record.', icon: IconTruck },
  { id: '03', title: 'Award', body: 'Choose the right bid. The agreed terms and payment are locked in.', icon: IconShield },
  { id: '04', title: 'Move', body: 'Driver, location, exceptions and documents stay visible while freight moves.', icon: IconMapPin },
  { id: '05', title: 'Close', body: 'POD completes the record and releases payment without another chase.', icon: IconCheckCircle },
];

const ROLE_CONTENT = {
  shipper: {
    eyebrow: 'For shippers', title: 'Control the movement without managing the noise.',
    body: 'Post once, compare accountable bids and follow the load through delivery. Every decision is recorded and every party works from the same facts.',
    points: ['Structured requirements', 'Comparable live bids', 'Protected payment', 'Permanent delivery record'], cta: 'Move a load', to: '/register',
  },
  transporter: {
    eyebrow: 'For transporters', title: 'Turn available capacity into dependable work.',
    body: 'See relevant lanes, price with context and keep drivers connected to the job. Less time negotiating in chats; more time moving profitable freight.',
    points: ['Qualified load discovery', 'Clear lane economics', 'Driver-ready instructions', 'Faster payment release'], cta: 'Find loads', to: '/register?role=CARRIER',
  },
};

function LoadRecord({ market }) {
  return (
    <div className="lb-record" aria-label="Example Loadbyton load record">
      <div className="lb-record-head"><div><span className="lb-record-kicker">LIVE LOAD RECORD</span><h2>LBT-4821</h2></div><span className="lb-live-pill"><i /> Open for bids</span></div>
      <div className="lb-route">
        <div className="lb-route-place"><span>AUH</span><strong>Khalifa Port</strong><small>Pickup · Today 14:30</small></div>
        <div className="lb-route-line"><i /><span>164 km</span><i /></div>
        <div className="lb-route-place lb-route-place--right"><span>SHJ</span><strong>Industrial Area 10</strong><small>Delivery · Today 18:00</small></div>
      </div>
      <div className="lb-record-grid"><div><small>Equipment</small><strong>40FT Flatbed</strong></div><div><small>Target</small><strong>AED 2,400</strong></div><div><small>Best bid</small><strong>AED 2,350</strong></div><div><small>Responses</small><strong>3 verified</strong></div></div>
      <div className="lb-award-row"><span className="lb-company-mark">DL</span><span><strong>Desert Line Haulage</strong><small><IconShield size={12} /> Verified · 67 jobs · 4.9</small></span><strong>AED 2,350</strong></div>
      <div className="lb-record-foot"><span><IconClock size={14} /> Bid received 2 min ago</span><span>{market?.openJobsNow ?? '—'} open loads now</span></div>
    </div>
  );
}

function ChannelDemo() {
  const [channel, setChannel] = useState('web');
  const copy = {
    web: ['Operations desk', 'Full load record', 'Compare bids, documents, tracking and payment in one dense workspace.'],
    mobile: ['Driver view', 'One next action', 'Pickup context first, large controls and no irrelevant office detail.'],
    whatsapp: ['WhatsApp connected', 'A channel, not the database', 'Offers and driver replies flow back into LBT-4821 automatically.'],
  }[channel];
  return (
    <div className="lb-channel-demo">
      <div className="lb-channel-tabs" role="tablist" aria-label="Loadbyton operating surfaces">
        {['web', 'mobile', 'whatsapp'].map((item) => <button key={item} type="button" role="tab" aria-selected={channel === item} onClick={() => setChannel(item)}>{item === 'web' ? 'Web app' : item === 'mobile' ? 'Mobile' : 'WhatsApp'}</button>)}
      </div>
      <div className={`lb-channel-screen lb-channel-screen--${channel}`}>
        <div className="lb-channel-chrome"><i /><i /><i /><span>loadbyton / LBT-4821</span></div>
        <div className="lb-channel-body"><div className="lb-channel-copy"><span>{copy[0]}</span><h3>{copy[1]}</h3><p>{copy[2]}</p></div><div className="lb-mini-timeline"><span className="done"><IconCheck size={13} /> Load posted</span><span className="done"><IconCheck size={13} /> Bid awarded</span><span className="active"><IconTruck size={14} /> Driver en route</span><span><IconFile size={14} /> POD pending</span></div></div>
      </div>
    </div>
  );
}

export default function Landing() {
  usePageTitle('');
  const [market, setMarket] = useState(null); const [lanes, setLanes] = useState([]); const [carriers, setCarriers] = useState([]); const [role, setRole] = useState('shipper');
  const heroRef = useRef(null); const heroCtaRef = useMagnetic(); const finalCtaRef = useMagnetic();
  useEffect(() => {
    api.publicMarket().then((d) => setMarket(d.market)).catch(() => {});
    api.publicLanes().then((d) => setLanes(d.lanes.slice(0, 4))).catch(() => {});
    api.publicCarriers().then((d) => setCarriers(d.carriers.slice(0, 3))).catch(() => {});
  }, []);
  const roleCopy = ROLE_CONTENT[role];
  return (
    <div className="lb-home" dir="ltr">
      <section ref={heroRef} className="lb-hero">
        <img src={PHOTO.hero} alt="Freight truck operating in the UAE" className="lb-hero-photo" /><div className="lb-hero-wash" /><div className="lb-hero-grid" />
        <div className="container-page lb-hero-inner"><div className="lb-hero-copy">
          <p className="lb-kicker"><span>UAE FREIGHT INFRASTRUCTURE</span><i /> DXB · AUH · SHJ · FUJ</p>
          <h1>Every load is an opportunity.<br /><em>LOAD|BY|TON makes it visible.</em></h1>
          <p className="lb-hero-lede">The challenge isn't always finding the load. It's making the opportunity visible, structured and actionable.</p>
          <div className="lb-hero-actions"><Link ref={heroCtaRef} to="/register" className="btn-accent btn-shine">Start with one load <IconArrowRight size={18} /></Link><Link to="/for-transporters" className="lb-quiet-link">I move freight <IconArrowRight size={16} /></Link></div>
          <div className="lb-hero-proof"><span><IconShield size={15} /> Verified network</span><span><IconClock size={15} /> 24h auto-release</span><span><IconMapPin size={15} /> UAE-wide lanes</span></div>
        </div><LoadRecord market={market} /></div><div className="lb-hero-index"><span>01</span><i /><span>ONE RECORD</span></div>
      </section>

      <section className="lb-noise-section"><div className="container-page lb-two-col">
        <Reveal className="lb-section-copy"><span className="lb-section-no">01 / THE PROBLEM</span><h2>Freight does not fail from lack of communication.</h2><p>It fails because the communication has no shared structure. One load becomes twelve conversations, three spreadsheets and several versions of what is true.</p></Reveal>
        <Reveal delay={100} className="lb-noise-stack" aria-label="Example fragmented freight messages"><div className="lb-message lb-message--one"><span>WHATSAPP · 09:12</span><strong>Driver reached?</strong><p>He said 20 mins but terminal says no booking.</p></div><div className="lb-message lb-message--two"><span>OPERATIONS · 09:17</span><strong>Which rate was final?</strong><p>I have AED 2,400. Accounts has AED 2,550.</p></div><div className="lb-message lb-message--three"><span>ACCOUNTS · 09:24</span><strong>POD still missing</strong><p>Cannot release payment without the signed copy.</p></div><div className="lb-noise-resolution"><IconMessage size={18} /><span>12 messages</span><IconArrowRight size={16} /><strong>1 load record</strong></div></Reveal>
      </div></section>

      <section className="lb-record-section"><div className="container-page"><Reveal className="lb-section-heading"><span className="lb-section-no">02 / THE SYSTEM</span><h2>One load. One permanent operational truth.</h2><p>Every stage adds context to the same record instead of starting another conversation.</p></Reveal><div className="lb-record-steps">{RECORD_STEPS.map((step, index) => <Reveal key={step.id} delay={index * 70} className="lb-record-step"><div className="lb-step-top"><span>{step.id}</span><step.icon size={20} /></div><h3>{step.title}</h3><p>{step.body}</p><i className="lb-step-rail" /></Reveal>)}</div></div></section>

      <section className="lb-role-section"><div className="container-page lb-role-grid">
        <Reveal className="lb-role-panel"><div className="lb-role-switch" role="tablist" aria-label="Choose your role">{Object.keys(ROLE_CONTENT).map((key) => <button key={key} role="tab" aria-selected={role === key} onClick={() => setRole(key)}>{key === 'shipper' ? 'I ship freight' : 'I move freight'}</button>)}</div><span className="lb-section-no">{roleCopy.eyebrow}</span><h2>{roleCopy.title}</h2><p>{roleCopy.body}</p><ul>{roleCopy.points.map((point) => <li key={point}><IconCheck size={15} /> {point}</li>)}</ul><Link to={roleCopy.to} className="btn-primary">{roleCopy.cta} <IconArrowRight size={17} /></Link></Reveal>
        <Reveal delay={100} className="lb-role-visual"><div className="lb-role-map"><span>JEBEL ALI</span><i /><span>AL QUOZ</span></div><div className="lb-role-card lb-role-card--main"><small>ACTIVE MOVEMENT</small><strong>Container · 40FT</strong><p>Jebel Ali → Al Quoz</p><span><IconTruck size={15} /> Driver en route · 34 min</span></div><div className="lb-role-card lb-role-card--status"><IconCheckCircle size={18} /><span><strong>Terms locked</strong><small>AED 1,850 · Protected</small></span></div><div className="lb-role-card lb-role-card--driver"><span className="lb-avatar">MK</span><span><strong>Mohammed K.</strong><small>Location updated now</small></span></div></Reveal>
      </div></section>

      <section className="lb-surfaces-section"><div className="container-page"><Reveal className="lb-section-heading lb-section-heading--light"><span className="lb-section-no">03 / EVERYWHERE THE WORK HAPPENS</span><h2>Different surfaces. The same load.</h2><p>Office teams, drivers and WhatsApp users see the right level of detail without creating parallel versions of the job.</p></Reveal><Reveal delay={80}><ChannelDemo /></Reveal></div></section>

      <section className="lb-lanes-section"><div className="container-page"><Reveal className="lb-section-heading"><span className="lb-section-no">04 / LIVE MARKET CONTEXT</span><h2>Know the lane before you negotiate it.</h2><p>Market context turns freight pricing from a phone-call opinion into an operational decision.</p></Reveal><div className="lb-lane-grid">{(lanes.length ? lanes : Array.from({ length: 4 })).map((lane, index) => <Reveal key={lane?.laneId || index} delay={index * 60} className="lb-lane-card"><span className="lb-lane-code">LN-{String(index + 1).padStart(2, '0')}</span><h3>{lane ? `${formatLabel(lane.terminal)} → ${formatLabel(lane.area)}` : 'Live lane loading…'}</h3><strong>{lane ? formatAED(lane.basePriceAed) : '—'}</strong><div><span>{lane ? `${lane.distanceKm} km` : 'Distance'}</span><span>{lane ? `${lane.onTimePct}% on-time` : 'Performance'}</span></div></Reveal>)}</div><div className="lb-network-proof"><span><strong>{market ? `${(market.teu2024 / 1e6).toFixed(1)}M` : '—'}</strong> UAE TEU / year</span><span><strong>{market?.openJobsNow ?? '—'}</strong> Open loads now</span><span><strong>{carriers.length || '—'}</strong> Featured verified carriers</span></div></div></section>

      <section className="lb-industrial-break"><img src={PHOTO.port} alt="Container terminal operations" /><div className="lb-industrial-overlay" /><div className="container-page"><Reveal><span>THE MOVEMENT IS PHYSICAL.</span><h2>The operational truth should be just as real.</h2><p>Every lane. Every party. Every decision. One record that moves with the freight.</p></Reveal></div></section>

      <section className="lb-final-cta"><div className="container-page"><Reveal className="lb-final-card"><span className="lb-section-no">BEGIN WITH THE NEXT MOVEMENT</span><h2>Start with one load.</h2><p>No digital-transformation project. No long implementation. Put the next real requirement into Loadbyton and let the record prove its value.</p><div><Link ref={finalCtaRef} to="/register" className="btn-accent btn-shine">Post your first load <IconArrowRight size={18} /></Link><Link to="/login" className="lb-quiet-link">Already have an account</Link></div></Reveal></div></section>
      <StickyMobileCta heroRef={heroRef} to="/register" label="Start with one load" />
    </div>
  );
}
