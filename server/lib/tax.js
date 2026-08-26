// Multi-tenant tax: ISO currency from country_code + coordinates → VAT/tariff
const TAX_TABLE = {
  AE: { currency: 'AED', vatBps: 500, tariffBps: 0 }, // 5% UAE VAT
  SA: { currency: 'SAR', vatBps: 1500, tariffBps: 500 },
  OM: { currency: 'OMR', vatBps: 500, tariffBps: 500 },
  IN: { currency: 'INR', vatBps: 1800, tariffBps: 1000 },
  US: { currency: 'USD', vatBps: 0, tariffBps: 0 },
  GB: { currency: 'GBP', vatBps: 2000, tariffBps: 0 },
  DE: { currency: 'EUR', vatBps: 1900, tariffBps: 0 },
};
function countryFromLatLng(lat,lng) {
  if (!lat || !lng) return 'AE';
  if (lat>=22&&lat<=27&&lng>=51&&lng<=57) return 'AE';
  if (lat>=16&&lat<=33&&lng>=34&&lng<=56) return 'SA';
  if (lat>=16&&lat<=27&&lng>=51&&lng<=60) return 'OM';
  return 'AE';
}
function currencyForCountry(cc) { return (TAX_TABLE[cc]||TAX_TABLE.AE).currency; }
function taxForJob({ countryCode, lat, lng, amount }) {
  const cc = countryCode || countryFromLatLng(lat,lng);
  const row = TAX_TABLE[cc] || TAX_TABLE.AE;
  const vat = Math.round(amount * row.vatBps / 10000);
  const tariff = Math.round(amount * row.tariffBps / 10000);
  return { countryCode: cc, currency: row.currency, vatBps: row.vatBps, tariffBps: row.tariffBps, vat, tariff, total: amount+vat+tariff };
}
module.exports = { TAX_TABLE, countryFromLatLng, currencyForCountry, taxForJob };
