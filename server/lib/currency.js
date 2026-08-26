const { currencyForCountry } = require('./tax');
function formatMoney(amount, currency) {
  try { return new Intl.NumberFormat('en', { style:'currency', currency }).format(amount); }
  catch { return `${currency} ${amount?.toFixed?.(2) ?? amount}`; }
}
function deriveCurrency(job) {
  if (job.currency) return job.currency;
  return currencyForCountry(job.country_code || 'AE');
}
module.exports = { formatMoney, deriveCurrency };
