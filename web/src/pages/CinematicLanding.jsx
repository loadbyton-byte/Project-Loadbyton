import React, { useEffect, useState } from 'react';
import { Link, Navigate } from 'react-router-dom';
import { useAuth, homePath } from '../lib/auth.jsx';
import { useMeta, usePageTitle } from '../lib/seo.jsx';
import { Reveal } from '../components/Reveal.jsx';
import { Spinner } from '../components/ui.jsx';
import { IconArrowRight, IconCheck, IconFile, IconMapPin, IconShield, IconTruck } from '../components/icons.jsx';
import { CAMPAIGN_LIST } from '../lib/campaignImages.js';

const SCENES = [
  ['Fleet operations', 'Al Quoz fleet and operations office'],
  ['Container movement', 'Port-to-road container transport'],
  ['Gate coordination', 'Night terminal gate handoff'],
  ['Road freight', 'UAE long-haul convoy'],
  ['Cold chain', 'Temperature-controlled dock inspection'],
  ['Port handoff', 'Container crane coordination'],
  ['Verified team', 'Operations team and mixed fleet'],
  ['Live coordination', 'Port-side planning with the team'],
  ['Heavy haul', 'Lowbed excavator movement'],
  ['Side loader', 'Container lift at the terminal'],
  ['Warehouse delivery', 'Curtain-side unloading operation'],
];

const STEPS = [
  ['01', 'Post', 'Share the load, equipment, lane and payment terms.'],
  ['02', 'Compare', 'Review bids from verified transport partners.'],
  ['03', 'Assign', 'Confirm the transporter and coordinate the driver.'],
  ['04', 'Move', 'Track the job, documents and operational updates.'],
  ['05', 'Complete', 'Close delivery with one permanent record.'],
];

export default function CinematicLanding() {
  const { user, actingAs, loading } = useAuth();
  const [scene, setScene] = useState(0);
  usePageTitle('UAE Freight Operations');
  useMeta('Post, compare, coordinate and complete UAE freight movements in one connected Loadbyton workspace.');

  useEffect(() => {
    const timer = window.setInterval(() => setScene((current) => (current + 1) % CAMPAIGN_LIST.length), 5600);
    return () => window.clearInterval(timer);
  }, []);

  if (loading) return <div className="flex min-h-dvh items-center justify-center bg-[#071923]"><Spinner size={28} className="text-white" /></div>;
  if (user) return <Navigate to={homePath(user, actingAs)} replace />;

  return (
    <div dir="ltr" className="lb-home lb-native-home">
      <section className="lb-home-hero" aria-label="Loadbyton freight operations">
        <div className="lb-home-hero-media" aria-hidden="true">
          {CAMPAIGN_LIST.map((image, index) => (
            <img key={image} src={image} alt="" className={index === scene ? 'is-active' : ''} loading={index === 0 ? 'eager' : 'lazy'} fetchPriority={index === 0 ? 'high' : undefined} />
          ))}
        </div>
        <div className="lb-home-hero-wash" />
        <div className="lb-home-hero-grid" />
        <div className="container-page lb-home-hero-inner">
          <Reveal className="lb-home-hero-copy">
            <p className="lb-kicker"><i /> UAE FREIGHT OPERATIONS <span>ONE CONTEXT</span></p>
            <h1>Every load is an opportunity <em>LOADBYTON</em> makes it visible</h1>
            <p className="lb-hero-lede">Post the movement, compare verified bids, coordinate every handoff and keep the operational record together—from first requirement to final delivery.</p>
            <div className="lb-hero-actions">
              <Link to="/register" className="btn-accent btn-shine">Post a load <IconArrowRight size={18} /></Link>
              <Link to="/features" className="lb-quiet-link">Explore the platform</Link>
            </div>
            <div className="lb-hero-proof">
              <span><IconShield size={15} /> Verified transporters</span>
              <span><IconFile size={15} /> One document record</span>
              <span><IconMapPin size={15} /> UAE-wide operations</span>
            </div>
          </Reveal>
          <div className="lb-home-scene-card" aria-live="polite">
            <span>{String(scene + 1).padStart(2, '0')} / {String(CAMPAIGN_LIST.length).padStart(2, '0')}</span>
            <strong>{SCENES[scene][0]}</strong>
            <p>{SCENES[scene][1]}</p>
            <div className="lb-home-scene-dots" role="tablist" aria-label="Operational scenes">
              {CAMPAIGN_LIST.map((image, index) => (
                <button key={image} type="button" className={index === scene ? 'is-active' : ''} onClick={() => setScene(index)} aria-label={`Show ${SCENES[index][0]}`} aria-selected={index === scene} role="tab" />
              ))}
            </div>
          </div>
        </div>
      </section>

      <section className="lb-home-intro"><div className="container-page">
        <Reveal className="lb-section-heading"><span className="lb-section-no">01 / ONE OPERATIONAL RECORD</span><h2>Freight work should not disappear between calls, chats and spreadsheets.</h2><p>Loadbyton connects the commercial decision to the physical movement, giving shippers and transporters one visible context for every load.</p></Reveal>
        <div className="lb-home-principles">
          <Reveal className="lb-home-principle"><IconTruck size={22} /><h3>Built around the movement</h3><p>Container drayage, LTL, FTL, cold chain, heavy haul and local cargo workflows stay connected to the actual job.</p></Reveal>
          <Reveal className="lb-home-principle" delay={70}><IconShield size={22} /><h3>Verified before bidding</h3><p>Operational credentials and company documents create a more accountable network before work is awarded.</p></Reveal>
          <Reveal className="lb-home-principle" delay={140}><IconFile size={22} /><h3>Context that survives</h3><p>Bids, charges, documents, driver coordination and delivery history remain attached to the movement.</p></Reveal>
        </div>
      </div></section>

      <section className="lb-home-process"><div className="container-page">
        <Reveal className="lb-section-heading lb-section-heading--light"><span className="lb-section-no">02 / FROM POST TO COMPLETE</span><h2>One disciplined flow for every load.</h2><p>Clear stages keep commercial and operational teams aligned without changing how freight actually moves.</p></Reveal>
        <div className="lb-home-steps">{STEPS.map(([number, title, body], index) => <Reveal key={number} delay={index * 55} className="lb-home-step"><span>{number}</span><IconCheck size={16} /><h3>{title}</h3><p>{body}</p></Reveal>)}</div>
      </div></section>

      <section className="lb-home-gallery"><div className="container-page">
        <Reveal className="lb-section-heading"><span className="lb-section-no">03 / REAL OPERATIONS</span><h2>Built for the work happening across the UAE.</h2><p>The visual system now uses one consistent, approved Loadbyton campaign across the homepage and public pages.</p></Reveal>
        <div className="lb-home-gallery-grid">{CAMPAIGN_LIST.slice(4).map((image, index) => <Reveal key={image} delay={(index % 3) * 60} className={index === 0 || index === 3 ? 'lb-home-gallery-card is-wide' : 'lb-home-gallery-card'}><img src={image} alt={SCENES[index + 4][1]} loading="lazy" /><div><span>{SCENES[index + 4][0]}</span><strong>{SCENES[index + 4][1]}</strong></div></Reveal>)}</div>
      </div></section>

      <section className="lb-final-cta"><div className="container-page"><Reveal className="lb-final-card"><span className="lb-section-no">MAKE THE NEXT LOAD VISIBLE</span><h2>Start with a real movement.</h2><p>Bring the requirement, the bids, the coordination and the delivery record into one operational workspace.</p><div><Link to="/register" className="btn-accent btn-shine">Get started <IconArrowRight size={18} /></Link><Link to="/for-transporters" className="lb-quiet-link">For transporters</Link></div></Reveal></div></section>
    </div>
  );
}
