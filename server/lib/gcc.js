// GCC expansion — CountryConfig abstraction so UAE logic isn't hard-coded.
const COUNTRY_CONFIG = {
  AE: { currency: 'AED', phoneRe: /^(\+?971|0)?5\d{8}$/, trnRe: /^\d{15}$/, taxBps: 500, paymentProvider: 'stripe' },
  SA: { currency: 'SAR', phoneRe: /^(\+?966|0)?5\d{8}$/, trnRe: /^\d{15}$/, taxBps: 1500, paymentProvider: 'stripe' },
  OM: { currency: 'OMR', phoneRe: /^(\+?968)?[79]\d{7}$/, trnRe: /^\d{15}$/, taxBps: 500, paymentProvider: 'stripe' },
  QA: { currency: 'QAR', phoneRe: /^(\+?974)?[34567]\d{7}$/, trnRe: /^\d{10}$/, taxBps: 0, paymentProvider: 'stripe' },
  BH: { currency: 'BHD', phoneRe: /^(\+?973)?[39]\d{7}$/, trnRe: /^\d{10}$/, taxBps: 1000, paymentProvider: 'stripe' },
  KW: { currency: 'KWD', phoneRe: /^(\+?965)?[569]\d{7}$/, trnRe: /^\d{12}$/, taxBps: 0, paymentProvider: 'stripe' },
};
function getCountryConfig(code = 'AE') { return COUNTRY_CONFIG[code] || COUNTRY_CONFIG.AE; }
module.exports = { COUNTRY_CONFIG, getCountryConfig };
