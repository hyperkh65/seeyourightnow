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
const groupDigits = (v: unknown) =>
  typeof v === 'number' || typeof v === 'string' ? String(v).replace(/\B(?=(\d{3})+(?!\d))/g, ',') : '';
const isoDate = (v: unknown) => (v ? new Date(String(v)).toISOString().slice(0, 10) : '');
hb.registerHelper('num', groupDigits);
/**
 * Legacy aliases used by templates saved before the helpers were renamed. Without
 * arguments they resolve to the context field of the same name (`{{number}}` = document
 * number, `{{date}}` = a `date` field), so both old and new templates render correctly.
 */
hb.registerHelper('number', function (this: Record<string, unknown>, ...args: unknown[]) {
  return args.length > 1 ? groupDigits(args[0]) : (this?.number ?? '');
});
hb.registerHelper('date', function (this: Record<string, unknown>, ...args: unknown[]) {
  return args.length > 1 ? isoDate(args[0]) : (this?.date ?? '');
});
hb.registerHelper('inc', (v: unknown) => Number(v) + 1);
hb.registerHelper('eq', (a: unknown, b: unknown) => a === b);
hb.registerHelper(
  'nl2br',
  (v: unknown) => new hb.SafeString(hb.Utils.escapeExpression(String(v ?? '')).replace(/\n/g, '<br>')),
);
hb.registerHelper('fmtDate', isoDate);

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
