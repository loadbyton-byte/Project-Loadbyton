// Ported from the design-tool export's pages/Marketing.jsx (FeaturesPage).
import React from 'react';
import { usePageTitle, useMeta } from '../lib/seo.jsx';
import { SitePage, SubHero, SubSection, SubCards, SubCta, PHOTOS, PAGE } from '../components/marketing/SubKit.jsx';

const P = PAGE;

const ITEMS = [
  { icon: 'Shield', title: 'Payment held, not a promise', body: 'The agreed price is held the moment you award a bid. It releases when you confirm delivery — or automatically 24h after, so nothing sits in limbo.' },
  { icon: 'Layers', title: '12 equipment types, one flow', body: 'Container chassis, flatbed, lowbed, tripper, curtain truck, side loader, or a 3–10 tonne pickup — post the equipment the job actually needs, not just a container.' },
  { icon: 'Package', title: 'Recurring templates', body: 'Save a lane once. Re-run it into a fresh open job in one click, instead of re-typing the same container, terminal and address every week.' },
  { icon: 'Truck', title: 'Verified transporters only', body: 'TRN, trade licence and insurance are checked before a transporter can place a single bid — enforced server-side, not just hidden in the UI.' },
  { icon: 'MapPin', title: 'Live tracking & delivery commitments', body: "Every job shows its position in the lifecycle, a geofence-style pickup/delivery flag, and the transporter's committed delivery date and time." },
  { icon: 'Compass', title: 'Volume inquiries, UAE-wide', body: 'State a container count or truck count once and get one bid covering the full batch — across six terminals in Dubai, Abu Dhabi, Sharjah and Fujairah.' },
  { icon: 'File', title: 'A document thread that survives', body: 'Customs paperwork, receipts and proof of delivery live on the job permanently, with a full audit trail — not in a disappearing chat that dies when the job ends.' },
  { icon: 'Star', title: 'Ratings that compound', body: "Every completed job updates a transporter or shipper's public rating, so reliability becomes a visible, portable asset." },
  { icon: 'Clock', title: 'Auto-release, no chasing', body: "Payment releases the moment a shipper confirms delivery, or automatically after a set window — a payout doesn't depend on someone remembering to call." },
];

export default function Features() {
  usePageTitle('Features');
  useMeta('Payment-protected freight jobs across the UAE, 12 equipment types, volume inquiries, live tracking, contract lanes and a verified transporter network — everything Loadbyton ships.');
  return (
    <SitePage>
      <SubHero photo={PHOTOS.crossDock} kicker="PLATFORM · CAPABILITIES" title="Everything it takes to stop re-negotiating the same shipment." lede="Loadbyton isn't a listings board. It's the payment protection, the state machine, and the paper trail a drayage marketplace actually needs." />
      <SubSection tone="cloud" no="01 / The system" title="One platform, nine load-bearing mechanics." copy="Each one enforced on the server — not a badge, not a promise.">
        <SubCards prefix="F" items={ITEMS} />
      </SubSection>
      <SubCta kicker="Begin with the next movement" title="See it on a real job, not a slide." body="Post your first load and watch the mechanics work on real freight." primary={['Post your first load', P.register]} secondary={['How pricing works', P.pricing]} />
    </SitePage>
  );
}
