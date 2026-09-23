// Ported from the design-tool export's pages/Marketing.jsx (ShippersPage).
import React from 'react';
import { Link } from 'react-router-dom';
import { usePageTitle, useMeta } from '../lib/seo.jsx';
import { SitePage, SubHero, SubSection, SubSteps, SubCards, SubCta, PHOTOS, PAGE } from '../components/marketing/SubKit.jsx';

const P = PAGE;

const STEPS = [
  { n: '01', icon: 'Package', title: 'Post the requirement', body: "Equipment, terminal or address, deadline, target price — one structured form. It's visible to verified transporters the moment it's posted." },
  { n: '02', icon: 'Gavel', title: 'Review bids on your terms', body: "Compare price, ETA, and each transporter's rating and completed-job history. Discuss ancillary charges before you commit — nothing is auto-selected for you." },
  { n: '03', icon: 'Shield', title: 'Agree and award', body: 'Accept a bid and the price locks. Payment is held for the transport automatically — no invoice to chase, no bank transfer to confirm by phone.' },
  { n: '04', icon: 'Clock', title: 'Track it, then release payment', body: 'Watch the job move through pickup, transit, and delivery. Confirm on delivery, or let the automatic release window handle it.' },
];

const REASONS = [
  { icon: 'Shield', title: 'Every transporter is verified', body: 'Trade licence, TRN, and insurance checked before a transporter can place a single bid — enforced server-side, not just a badge in a profile.' },
  { icon: 'Gavel', title: 'You choose the bid, not an algorithm', body: 'Every bid on your job is visible to you, with price, ETA, and equipment. You pick who moves your freight — nothing is auto-assigned.' },
  { icon: 'Clock', title: 'Committed delivery times', body: 'Every bid carries an ETA the transporter is bidding against, and every job shows its live position — not a verbal "should be there by end of day."' },
  { icon: 'File', title: 'One place for the whole record', body: 'Customs paperwork, receipts, and proof of delivery live on the job permanently — with a full audit trail, not a chat thread that disappears once the truck arrives.' },
  { icon: 'Layers', title: 'Built for the repeat shipment', body: 'Save a lane as a template and re-post it in one click. Volume inquiries cover a recurring container or truck count at one agreed price, without renegotiating every time.' },
  { icon: 'Package', title: 'No broker relationship required', body: "Post once, get bids from multiple transporters directly. You're not tied to whichever broker happens to answer the phone that day." },
];

export default function ForShippers() {
  usePageTitle('For Shippers');
  useMeta('Post a road freight or container drayage requirement in the UAE, review bids from verified transporters, and manage the move from one place.');
  return (
    <SitePage>
      <SubHero
        photo={PHOTOS.crossDock}
        kicker="FOR SHIPPERS"
        title="Post a requirement. Review real bids. Track it to delivery."
        lede="Post your transport requirement once, receive bids from verified transporters across the UAE, and manage the agreed move — documents, updates, payment status — from one place. No broker calls, no chasing proof of delivery."
        actions={<>
          <Link className="btn btn-red shimmer" to={P.register}>Post a load &#8594;</Link>
          <Link className="btn btn-glass" to={P.pricing}>See pricing</Link>
        </>}
      />
      <SubSection tone="cloud" no="01 / How it works" title="From post to payout release." copy="The same accountable sequence on every job — nothing lives in a side conversation.">
        <SubSteps steps={STEPS} />
      </SubSection>
      <SubSection tone="paper" no="02 / Why shippers stay" title="Control you never had over the phone." copy="Every mechanic below closes a gap that brokered freight leaves open.">
        <SubCards prefix="R" items={REASONS} />
      </SubSection>
      <SubCta kicker="Begin with the next movement" title="No card required to browse open bids on your first post." body="Put the next real requirement into Loadbyton and let the record prove its value." primary={['Create a free account', P.register]} secondary={['See pricing first', P.pricing]} />
    </SitePage>
  );
}
