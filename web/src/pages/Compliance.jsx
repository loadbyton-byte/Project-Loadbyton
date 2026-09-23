// Ported from the design-tool export's pages/Marketing.jsx (CompliancePage).
// Real PDPL principles, stated generally and accurately. Anything specific
// to this company (trade licence number, registered address) is a clearly
// marked placeholder — never a fabricated number. Filling those in is a
// business/legal step, not a code change.
import React from 'react';
import { usePageTitle, useMeta } from '../lib/seo.jsx';
import { MktIcon } from '../components/marketing/MktIcon.jsx';
import { SitePage, SubHero, SubSection, SubCta, PAGE, delay } from '../components/marketing/SubKit.jsx';

const P = PAGE;

export default function Compliance() {
  usePageTitle('Compliance');
  useMeta('How Loadbyton handles personal data under UAE PDPL, VAT invoicing, and where account data is hosted.');
  return (
    <SitePage>
      <SubHero kicker="COMPLIANCE" title="Data protection, hosting, and invoicing — stated plainly." />
      <SubSection tone="cloud" no="01 / Position" title="Three statements, no gloss.">
        <div className="sub-docs">
          <div className="sub-doc mkt-reveal">
            <div className="sub-doc-head"><span className="pcard-ico"><MktIcon name="Shield" size={18} /></span><h3>Data protection (UAE PDPL)</h3></div>
            <p>Loadbyton processes personal data — company contacts, TRN, IBAN, driver names and phone numbers — under the principles of the UAE's Federal Decree-Law No. 45 of 2021 on the Protection of Personal Data (PDPL): data is collected for a stated purpose, kept only as long as that purpose requires, and protected with controls proportionate to its sensitivity (see the <a href={P.security}>Security</a> page for what that means technically — field-level encryption for IBAN/TRN specifically).</p>
            <p>Account holders can request a copy of their data, a correction, or deletion by contacting <span className="mono">privacy@loadbyton.ae</span> — a placeholder inbox to be staffed before this goes live, not yet active.</p>
          </div>
          <div className="sub-doc mkt-reveal" style={delay(60)}>
            <div className="sub-doc-head"><span className="pcard-ico"><MktIcon name="MapPin" size={18} /></span><h3>Where data is hosted</h3></div>
            <p>Hosting region depends on deployment configuration (see <span className="mono">render.yaml</span> and <span className="mono">deploy/oracle-cloud/</span> in the repository) — this is stated here rather than asserted as UAE-only, because it isn't universally true across every deployment yet. A government or regulated-industry counterparty that requires in-country hosting should confirm the specific deployment target before onboarding.</p>
          </div>
          <div className="sub-doc mkt-reveal" style={delay(120)}>
            <div className="sub-doc-head"><span className="pcard-ico"><MktIcon name="File" size={18} /></span><h3>VAT invoicing</h3></div>
            <p>Platform commission is invoiced with a sequential invoice number and a VAT breakdown at the UAE standard rate, generated automatically when a payout releases. This does not cover the freight amount itself, which is a contract between shipper and carrier that Loadbyton is not a party to.</p>
          </div>
          <div className="sub-doc mkt-reveal" style={delay(180)}>
            <div className="sub-doc-head"><span className="pcard-ico"><MktIcon name="Info" size={18} /></span><h3>Company details</h3></div>
            <div className="sub-placeholder"><span>Trade licence number: <em>— add before publishing publicly —</em></span><span>Registered address: <em>— add before publishing publicly —</em></span><span>Free zone / mainland status: <em>— add before publishing publicly —</em></span></div>
          </div>
        </div>
      </SubSection>
      <SubCta kicker="Next" title="Questions on the position?" body="Read how the platform is secured, or start with one load." primary={['How security works', P.security]} secondary={['Create an account', P.register]} />
    </SitePage>
  );
}
