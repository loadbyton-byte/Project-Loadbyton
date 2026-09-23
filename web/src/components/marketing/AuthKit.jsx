// Shared building blocks for the redesigned Login/Register pages — ported
// from the design-tool export's pages/Auth.jsx (the `AuthFrame` and
// `PwField` local components it defined there). Kept separate from the
// existing components/AuthFrame.jsx, which ForgotPassword.jsx,
// ResetPassword.jsx and VerifyEmail.jsx still use unchanged — this export
// only redesigned Login and Register, not the rest of the auth flow.
import React, { useState } from 'react';
import { delay } from './SubKit.jsx';

export function MktAuthFrame({ kicker, title, body, photo, children }) {
  return (
    <section className="auth">
      <div className="auth-side">
        <img src={photo} alt="" aria-hidden="true" />
        <div className="hero-vignette" />
        <div className="auth-side-in">
          <div className="hero-kicker mkt-reveal"><i />{kicker}</div>
          <h1 className="mkt-reveal" style={delay(60)}>{title}</h1>
          <p className="mkt-reveal" style={delay(120)}>{body}</p>
          <div className="hero-proof mkt-reveal" style={delay(180)}>
            <div className="proof-row"><span className="n">01</span><span><b>Verified counterparties</b><small>TRN, trade licence and insurance checked before bidding.</small></span><span>VERIFIED</span></div>
            <div className="proof-row"><span className="n">02</span><span><b>Payment held on award</b><small>Released on confirmed delivery or after 24h.</small></span><span>PROTECTED</span></div>
            <div className="proof-row"><span className="n">03</span><span><b>One load record</b><small>Bids, documents and status stay on the job.</small></span><span>DXB &middot; AUH &middot; SHJ &middot; FUJ</span></div>
          </div>
        </div>
      </div>
      <div className="auth-main">{children}</div>
    </section>
  );
}

export function PwField({ id, value, onChange, placeholder, autoComplete, minLength, name }) {
  const [show, setShow] = useState(false);
  return (
    <div className="auth-pw">
      <input className="input" id={id} name={name || id} type={show ? 'text' : 'password'} required value={value} onChange={onChange} placeholder={placeholder} autoComplete={autoComplete} minLength={minLength} />
      <button type="button" onClick={() => setShow((v) => !v)} aria-label={show ? 'Hide password' : 'Show password'} aria-pressed={show}>{show ? 'Hide' : 'Show'}</button>
    </div>
  );
}
