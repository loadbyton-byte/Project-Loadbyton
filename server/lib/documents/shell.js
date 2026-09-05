// Shared branded "letterhead" used by every generated document (tax invoice,
// settlement statement, load confirmation, POD certificate, EIR summary,
// dispute notice). Colors/fonts/logo are pulled straight from the app's own
// brand kit (docs/docs/brand/design-tokens.json, docs/docs/brand/BRAND_GUIDELINES.md)
// — nothing here is a new visual identity, only the existing one applied.
//
// Every document is served from this same Express app, which serves
// web/dist statically (server/app.js), so a relative /brand/logo-full.svg
// reference resolves correctly whether the page is opened directly against
// the API host or through the Vercel rewrite proxy at the app's own domain.

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function platformFooter() {
  const legalName = process.env.PLATFORM_LEGAL_NAME || 'Loadbyton (legal name not configured)';
  const trn = process.env.PLATFORM_TRN;
  const address = process.env.PLATFORM_REGISTERED_ADDRESS || 'United Arab Emirates';
  const trnLine = trn
    ? `TRN: ${esc(trn)}`
    : `<span class="doc-warning">⚠ PLATFORM_TRN not configured — this document is not FTA-compliant until it is set.</span>`;
  return `<footer class="doc-footer">
    <div>${esc(legalName)}</div>
    <div>${esc(address)} · ${trnLine}</div>
  </footer>`;
}

/**
 * @param {{title: string, subtitle?: string, bodyHtml: string, docCode?: string}} opts
 */
function renderDocumentShell({ title, subtitle, bodyHtml, docCode }) {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${esc(title)}${docCode ? ' — ' + esc(docCode) : ''}</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Geist:wght@500;600;700&family=Inter:wght@400;500;600&family=JetBrains+Mono:wght@400;500&display=swap" rel="stylesheet">
<style>
  :root {
    --lb-navy: #0F2B3D;
    --lb-navy-800: #1A3A52;
    --lb-red: #E53935;
    --lb-ink: #0F2129;
    --lb-muted: #586A72;
    --lb-border: #E5E8E3;
    --lb-surface: #F5F6F4;
    --lb-warn-bg: #FEF0E0;
    --lb-warn-text: #8f2f24;
  }
  * { box-sizing: border-box; }
  body {
    font-family: 'Inter', ui-sans-serif, sans-serif;
    color: var(--lb-ink);
    max-width: 760px;
    margin: 32px auto;
    padding: 0 24px 40px;
    background: #fff;
  }
  h1, h2 { font-family: 'Geist', 'Inter', sans-serif; letter-spacing: -0.01em; }
  .doc-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 16px;
    padding: 20px 0 16px;
    border-bottom: 3px solid var(--lb-red);
    margin-bottom: 24px;
  }
  .doc-header img { height: 34px; display: block; }
  .doc-header .doc-meta { text-align: right; font-size: 13px; color: var(--lb-muted); }
  .doc-title { font-size: 22px; font-weight: 700; color: var(--lb-navy); margin: 0 0 2px; }
  .doc-subtitle { font-size: 14px; color: var(--lb-muted); margin: 0 0 24px; }
  .doc-warning {
    display: block;
    background: var(--lb-warn-bg);
    color: var(--lb-warn-text);
    border: 1px solid var(--lb-warn-text);
    font: 600 12px 'Inter', sans-serif;
    padding: 8px 12px;
    border-radius: 6px;
    margin-bottom: 16px;
  }
  table { width: 100%; border-collapse: collapse; margin-top: 20px; }
  th, td { text-align: left; padding: 9px 6px; border-bottom: 1px solid var(--lb-border); font-size: 14px; }
  th { font: 600 11px 'Inter', sans-serif; text-transform: uppercase; letter-spacing: 0.05em; color: var(--lb-muted); }
  td.num, th.num { text-align: right; font-family: 'JetBrains Mono', ui-monospace, monospace; font-variant-numeric: tabular-nums; }
  .totals td { font-weight: 700; color: var(--lb-navy); }
  .cols { display: flex; justify-content: space-between; gap: 24px; margin-top: 8px; }
  .cols > div { flex: 1; }
  .cols strong { color: var(--lb-navy); font-family: 'Geist', sans-serif; font-size: 13px; text-transform: uppercase; letter-spacing: 0.03em; }
  .card { background: var(--lb-surface); border: 1px solid var(--lb-border); border-radius: 8px; padding: 16px; margin: 16px 0; }
  .mono { font-family: 'JetBrains Mono', ui-monospace, monospace; font-variant-numeric: tabular-nums; }
  .muted { color: var(--lb-muted); font-size: 13px; }
  .doc-footer {
    margin-top: 40px;
    padding-top: 16px;
    border-top: 1px solid var(--lb-border);
    font-size: 12px;
    color: var(--lb-muted);
    display: flex;
    justify-content: space-between;
    gap: 16px;
  }
  .print-bar { display: flex; justify-content: flex-end; margin-bottom: 8px; }
  .print-bar button {
    font: 600 13px 'Inter', sans-serif;
    padding: 9px 18px;
    border-radius: 6px;
    border: 1px solid var(--lb-navy);
    background: var(--lb-navy);
    color: #fff;
    cursor: pointer;
  }
  .print-bar button:hover { background: var(--lb-navy-800); }
  @media print {
    @page { margin: 16mm; }
    body { margin: 0; max-width: none; }
    .no-print { display: none !important; }
  }
</style>
</head>
<body>
  <div class="print-bar no-print"><button onclick="window.print()">Print / Save as PDF</button></div>
  <div class="doc-header">
    <img src="/brand/logo-full.svg" alt="Loadbyton" onerror="this.style.display='none'" />
    <div class="doc-meta">${docCode ? `<div class="mono">${esc(docCode)}</div>` : ''}</div>
  </div>
  <h1 class="doc-title">${esc(title)}</h1>
  ${subtitle ? `<p class="doc-subtitle">${esc(subtitle)}</p>` : ''}
  ${bodyHtml}
  ${platformFooter()}
</body>
</html>`;
}

module.exports = { renderDocumentShell, esc };
