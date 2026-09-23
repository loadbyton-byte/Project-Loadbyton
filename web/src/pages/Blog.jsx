// Ported from the design-tool export's pages/Marketing.jsx (BlogPage).
import React from 'react';
import { usePageTitle, useMeta } from '../lib/seo.jsx';
import { SitePage, SubHero, SubSection, SubCta, PHOTOS, PAGE, delay } from '../components/marketing/SubKit.jsx';

const P = PAGE;

const POSTS = [
  { title: 'The idle container is the real cost of drayage — the truck is almost beside the point', date: '18 Jul 2026', tag: 'Operations', photo: PHOTOS.containerChassis, body: "A container sitting uncollected at the terminal for two extra days quietly outspends the truck that moved it. The fix isn't a faster truck — it's a committed delivery date and time attached to every job, not a separate spreadsheet someone forgets to check." },
  { title: 'Why "just add a phone number field" breaks a freight marketplace', date: '30 Jun 2026', tag: 'Product', photo: PHOTOS.fleet, body: "The moment a shipper and transporter can text each other directly, the second job happens off-platform — at which point the marketplace only ever sees the first transaction from any given pair. Contact gating isn't friction for its own sake; it's the difference between a marketplace and a one-time introduction service." },
  { title: 'A payment-holding state machine is not optional, even for a demo', date: '05 Jun 2026', tag: 'Engineering', photo: PHOTOS.smartGate, body: 'PENDING, HELD, FUNDED, RELEASED, DISPUTED — five states, and every transition has to be enforced server-side or the payment protection story is fiction. Building it as a real state machine from day one, even before a licensed payment rail exists, is what makes the eventual real-money version a swap of the execution layer, not a rewrite.' },
];

export default function Blog() {
  usePageTitle('Blog');
  useMeta('Notes on UAE drayage logistics and building a freight marketplace that survives past the first job.');
  return (
    <SitePage>
      <SubHero photo={PHOTOS.customs} kicker="BLOG · FIELD NOTES" title="Notes from building Loadbyton." lede="Field notes on UAE drayage economics and the product/engineering decisions behind the platform." />
      <SubSection tone="white" no="01 / Field notes" title="Three essays, no content marketing.">
        <div className="sub-posts">
          {POSTS.map((p, i) => (
            <article className="sub-post mkt-reveal" key={p.title} style={delay(i * 60)}>
              <div><p className="sub-post-meta"><span>{p.tag}</span><time>{p.date}</time></p><h3>{p.title}</h3><p>{p.body}</p></div>
              <div className="sub-post-img"><img src={p.photo} alt="" loading="lazy" /></div>
            </article>
          ))}
        </div>
      </SubSection>
      <SubCta kicker="Next" title="Read enough. Move freight." primary={['Start with one load', P.register]} secondary={['Back to the platform', P.home]} />
    </SitePage>
  );
}
