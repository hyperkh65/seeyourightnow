import Handlebars from 'handlebars';
import { currencyPrecision, D } from '@sos/core';

/**
 * Isolated Handlebars instance. Output is HTML-escaped by default; templates
 * cannot run code, and only these helpers are available.
 */
export const hb = Handlebars.create();

hb.registerHelper('money', (amount: unknown, currency: unknown) => {
  if (amount === null || amount === undefined || amount === '') return '-';
  const cur = typeof currency === 'string' ? currency : 'KRW';
  try {
    const d = new D(String(amount)).toDecimalPlaces(currencyPrecision(cur));
    const [int, frac] = d.toFixed(currencyPrecision(cur)).split('.');
    const grouped = int!.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    const sym = cur === 'KRW' ? '₩' : cur === 'USD' ? '$' : cur === 'CNY' ? '¥' : `${cur} `;
    return `${sym}${grouped}${frac ? `.${frac}` : ''}`;
  } catch {
    return String(amount);
  }
});
hb.registerHelper('num', (v: unknown) =>
  typeof v === 'number' || typeof v === 'string' ? String(v).replace(/\B(?=(\d{3})+(?!\d))/g, ',') : '',
);
hb.registerHelper('inc', (v: unknown) => Number(v) + 1);
hb.registerHelper('eq', (a: unknown, b: unknown) => a === b);
hb.registerHelper(
  'nl2br',
  (v: unknown) => new hb.SafeString(hb.Utils.escapeExpression(String(v ?? '')).replace(/\n/g, '<br>')),
);
hb.registerHelper('fmtDate', (v: unknown) => (v ? new Date(String(v)).toISOString().slice(0, 10) : ''));

const cache = new Map<string, HandlebarsTemplateDelegate>();

export function render(template: string, data: unknown): string {
  let fn = cache.get(template);
  if (!fn) {
    fn = hb.compile(template, { strict: false, noEscape: false });
    if (cache.size > 500) cache.clear();
    cache.set(template, fn);
  }
  return fn(data);
}

/** Validates template syntax before saving a new version. */
export function validateTemplate(template: string): string | null {
  try {
    hb.precompile(template);
    return null;
  } catch (e) {
    return e instanceof Error ? e.message : String(e);
  }
}
