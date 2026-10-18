// Footer directory of all six domains (master plan §2: "one footer directory
// links all six"). Planned domains are listed as "Coming soon", not linked.
import React from 'react';
import { Link } from 'react-router-dom';
import { BRANCHES, STATUS_LABEL, goPath, isLinkable } from '../../brand/ecosystem.js';

export default function BranchDirectory() {
  return (
    <div className="fcol">
      <h4>Part of Loadbyton</h4>
      <ul>
        {BRANCHES.map((b) => (
          <li key={b.key}>
            {b.key === 'freight'
              ? <Link to="/">{b.descriptor} &middot; {b.domain}</Link>
              : isLinkable(b)
                ? <Link to={goPath(b.key)}>{b.descriptor} &middot; {b.domain}</Link>
                : <span className="eco-footer-off">{b.descriptor} &middot; {b.domain} <em>({STATUS_LABEL[b.status]})</em></span>}
          </li>
        ))}
      </ul>
    </div>
  );
}
