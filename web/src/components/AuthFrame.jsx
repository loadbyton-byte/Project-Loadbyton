import React from 'react';
import BrandWordmark from './BrandWordmark.jsx';

export default function AuthFrame({ children, eyebrow = 'Loadbyton operations network', title = 'One load. One accountable record.', body = 'Move freight through a verified operational workspace built around lanes, counterparties, documents and delivery—not disconnected messages.' }) {
  return (
    <main className="ops-auth">
      <section className="ops-auth__context" aria-label="Loadbyton operating context">
        <div>
          <BrandWordmark dark className="ops-auth__logo" />
          <p className="ops-auth__eyebrow">{eyebrow}</p>
          <h1>{title}</h1>
          <p>{body}</p>
          <div className="ops-auth__route" aria-hidden="true"><span>JEBEL ALI</span><i /><span>AL QUOZ</span></div>
        </div>
        <div className="ops-auth__proof" aria-label="Platform assurances">
          <span><strong>VERIFIED</strong>Business identities</span>
          <span><strong>RECORDED</strong>Terms and documents</span>
          <span><strong>VISIBLE</strong>Movement and delivery</span>
        </div>
      </section>
      <section className="ops-auth__form"><div className="ops-auth__panel">{children}</div></section>
    </main>
  );
}
