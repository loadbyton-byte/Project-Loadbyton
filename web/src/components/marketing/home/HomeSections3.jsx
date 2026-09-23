import React from 'react';

function HomeSection2() {
  return (
    <section className="section faq"><div className="container"><div className="center"><div className="eyebrow mkt-reveal">Questions</div><h2 className="display mkt-reveal">The visual story stays honest.</h2></div><div className="faq-wrap mkt-reveal"><div className="faq-item open"><button className="faq-q" type="button" aria-expanded="true"><span>Are the notification and WhatsApp scenes real user data?</span><span>+</span></button><div className="faq-a" style={{"maxHeight":"200px"}}><p>No. They are intentionally simulated visualizations of fragmented operational communication, built to explain the problem without exposing or inventing customer data.</p></div></div><div className="faq-item"><button className="faq-q" type="button" aria-expanded="false"><span>Is the UAE map live tracking?</span><span>+</span></button><div className="faq-a"><p>No. It is a visual operating-context illustration, not live vehicle telemetry.</p></div></div><div className="faq-item"><button className="faq-q" type="button" aria-expanded="false"><span>Can these interactions connect to the real application?</span><span>+</span></button><div className="faq-a"><p>Yes. The UI can be ported into the production frontend and the local demo state replaced with authenticated Loadbyton APIs and real document/message workflows.</p></div></div></div></div></section>
  );
}

function HomeCtaWrap() {
  return (
    <section className="cta-wrap"><div className="container"><div className="cta mkt-reveal"><div className="border-beam" aria-hidden="true"></div><div className="cta-in"><div className="eyebrow">Start moving</div><h2>LESS CHASING.<br />MORE MOVING.</h2><p>Put the job back at the center of freight operations.</p><div style={{"display":"flex","gap":"10px","flexWrap":"wrap"}}><button className="btn btn-red shimmer" data-post="" type="button">Post a Load →</button><a className="btn btn-glass" href="#demo">Open Demo</a></div></div></div></div></section>
  );
}

function HomePostoverlay() {
  return (
    <div className="overlay" id="postOverlay" role="dialog" aria-modal="true" aria-labelledby="postTitle"><div className="modal"><div className="modal-head"><div><h3 id="postTitle">Post a Load</h3><p>Create a local demo requirement. Nothing is sent to a server.</p></div><button className="x" data-close="" type="button" aria-label="Close">×</button></div><div className="modal-body"><div className="stepper" aria-hidden="true"><i className="step-dot active"></i><i className="step-dot"></i><i className="step-dot"></i><i className="step-dot"></i></div><form id="postForm" noValidate><div className="form-step" data-step="0"><div className="form-grid"><div className="group"><label htmlFor="f-pickup">Pickup</label><input className="input" id="f-pickup" name="pickup" placeholder="Jebel Ali" required /></div><div className="group"><label htmlFor="f-delivery">Delivery</label><input className="input" id="f-delivery" name="delivery" placeholder="Dubai South" required /></div><div className="group"><label htmlFor="f-equipment">Equipment</label><select className="select" id="f-equipment" name="equipment" required><option value="">Select</option><option>40ft HC</option><option>20ft</option><option>FTL</option><option>LTL</option><option>Reefer</option></select></div><div className="group"><label htmlFor="f-date">Pickup date</label><input className="input" id="f-date" name="date" type="date" required /></div></div></div><div className="form-step hidden" data-step="1"><div className="form-grid"><div className="group"><label htmlFor="f-cargo">Cargo</label><input className="input" id="f-cargo" name="cargo" /></div><div className="group"><label htmlFor="f-ref">Reference</label><input className="input" id="f-ref" name="reference" /></div><div className="group full"><label htmlFor="f-notes">Operational notes</label><textarea className="textarea" id="f-notes" name="notes"></textarea></div></div></div><div className="form-step hidden" data-step="2"><div className="form-grid"><div className="group"><label htmlFor="f-contact">Contact</label><input className="input" id="f-contact" name="contact" /></div><div className="group"><label htmlFor="f-phone">Phone</label><input className="input" id="f-phone" name="phone" /></div></div></div><div className="form-step hidden" data-step="3"><div className="summary" id="summary"></div></div></form></div><div className="modal-foot"><button className="btn btn-light" id="back" type="button" disabled>Back</button><button className="btn btn-red" id="nextStep" type="button">Continue →</button></div></div></div>
  );
}

function HomeBidoverlay() {
  return (
    <div className="overlay" id="bidOverlay" role="dialog" aria-modal="true" aria-labelledby="bidTitle"><div className="modal" style={{"width":"min(550px,100%)"}}><div className="modal-head"><div><h3 id="bidTitle">Submit Transporter Response</h3><p id="bidLabel"></p></div><button className="x" data-close="" type="button" aria-label="Close">×</button></div><div className="modal-body"><form id="bidForm" className="form-grid" noValidate><input type="hidden" name="loadId" /><div className="group"><label htmlFor="b-amount">Offer amount (AED)</label><input className="input" id="b-amount" type="number" min="1" name="amount" required /></div><div className="group"><label htmlFor="b-avail">Availability</label><select className="select" id="b-avail" name="availability"><option>Available today</option><option>Available tomorrow</option></select></div><div className="group full"><label htmlFor="b-note">Note</label><textarea className="textarea" id="b-note" name="note"></textarea></div></form></div><div className="modal-foot"><button className="btn btn-light" data-close="" type="button">Cancel</button><button className="btn btn-red" id="submitBid" type="button">Submit response</button></div></div></div>
  );
}

function HomeDrawerwrap() {
  return (
    <div className="drawer-wrap" id="drawerWrap"><aside className="drawer" role="dialog" aria-modal="true" aria-labelledby="drawerTitle"><div className="drawer-head"><div className="drawer-top"><div><h3 id="drawerTitle"></h3><p id="drawerSub"></p></div><button className="x" id="drawerClose" type="button" aria-label="Close job detail">×</button></div><div className="tabs" role="tablist"><button className="tab active" data-tab="overview" role="tab" aria-selected="true" type="button">Overview</button><button className="tab" data-tab="responses" role="tab" aria-selected="false" type="button">Responses</button><button className="tab" data-tab="messages" role="tab" aria-selected="false" type="button">Messages</button><button className="tab" data-tab="documents" role="tab" aria-selected="false" type="button">Documents</button><button className="tab" data-tab="activity" role="tab" aria-selected="false" type="button">Activity</button></div></div><div className="drawer-body"><div className="drawer-panel active" data-panel="overview" id="overviewPanel"></div><div className="drawer-panel" data-panel="responses" id="responsesPanel"></div><div className="drawer-panel" data-panel="messages"><div className="messages" id="messageList"></div><div className="send"><input id="messageInput" placeholder="Write operational message…" aria-label="Operational message" /><button className="btn btn-dark btn-sm" id="sendMessage" type="button">Send</button></div></div><div className="drawer-panel" data-panel="documents"><div className="drop" id="drop" role="button" tabIndex="0" aria-label="Add demo documents"><b>Drop files here</b><span style={{"fontSize":"8px"}}>or click to add demo file names</span><input id="fileInput" type="file" multiple hidden /></div><div className="files" id="fileList"></div></div><div className="drawer-panel" data-panel="activity"><div className="event-list" id="eventList"></div></div></div></aside></div>
  );
}

function HomeCommandoverlay() {
  return (
    <div className="command-overlay" id="commandOverlay" role="dialog" aria-modal="true" aria-label="Command palette"><div className="command"><div className="command-search"><input id="commandSearch" placeholder="Search actions, sections, loads…" aria-label="Command search" /></div><div className="command-list" id="commandList"></div></div></div>
  );
}

function HomeToasts() {
  return (
    <div className="toasts" id="toasts" aria-live="polite" aria-atomic="false"></div>
  );
}

export { HomeSection2, HomeCtaWrap, HomePostoverlay, HomeBidoverlay, HomeDrawerwrap, HomeCommandoverlay, HomeToasts };
