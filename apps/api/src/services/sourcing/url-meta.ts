import { cached } from '../../lib/cache.js';
import { readLimitedText, safeFetch } from '../../lib/http.js';

/**
 * Fetches public metadata (title, og:image, price hints) for a single product URL
 * the customer supplied — like a link preview. robots.txt is honoured; pages
 * that disallow generic crawlers are not fetched and the user is told why.
 */

const UA = 'SourcingOS-LinkPreview/1.0 (+https://github.com/)';

export async function robotsAllows(url: URL): Promise<boolean> {
  return cached(`robots:${url.host}`, 6 * 3600, async () => {
    try {
      const res = await safeFetch(`${url.protocol}//${url.host}/robots.txt`, {
        timeoutMs: 5000,
        headers: { 'User-Agent': UA },
      });
      if (!res.ok) return { rules: [] as string[] };
      const txt = await readLimitedText(res, 200_000);
      const rules: string[] = [];
      let applies = false;
      for (const raw of txt.split('\n')) {
        const line = raw.split('#')[0]!.trim();
        const [k, ...rest] = line.split(':');
        const v = rest.join(':').trim();
        if (!k) continue;
        if (k.toLowerCase() === 'user-agent') applies = v === '*';
        else if (applies && k.toLowerCase() === 'disallow' && v) rules.push(v);
      }
      return { rules };
    } catch {
      return { rules: [] as string[] };
    }
  }).then((r) => !r.rules.some((rule) => url.pathname.startsWith(rule)));
}

export interface UrlMeta {
  url: string;
  host: string;
  title: string | null;
  description: string | null;
  image: string | null;
  price: string | null;
  currency: string | null;
  blockedByRobots: boolean;
  error: string | null;
}

const meta = (html: string, prop: string) =>
  new RegExp(`<meta[^>]+(?:property|name)=["']${prop}["'][^>]*content=["']([^"']+)["']`, 'i').exec(
    html,
  )?.[1] ??
  new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]*(?:property|name)=["']${prop}["']`, 'i').exec(
    html,
  )?.[1] ??
  null;

const decode = (s: string | null) =>
  s
    ? s
        .replace(/&amp;/g, '&')
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'")
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .trim()
    : null;

export async function fetchUrlMeta(raw: string): Promise<UrlMeta> {
  const url = new URL(raw);
  const out: UrlMeta = {
    url: raw,
    host: url.host,
    title: null,
    description: null,
    image: null,
    price: null,
    currency: null,
    blockedByRobots: false,
    error: null,
  };
  if (!(await robotsAllows(url))) {
    out.blockedByRobots = true;
    out.error = '이 사이트는 자동 수집을 허용하지 않습니다. 제품 사진이나 제품명을 함께 입력해 주세요.';
    return out;
  }
  try {
    const res = await safeFetch(raw, {
      timeoutMs: 10_000,
      headers: { 'User-Agent': UA, Accept: 'text/html' },
    });
    if (!res.ok) {
      out.error = `페이지를 불러오지 못했습니다 (HTTP ${res.status}).`;
      return out;
    }
    const html = await readLimitedText(res, 1_500_000);
    out.title = decode(meta(html, 'og:title') ?? /<title[^>]*>([^<]+)<\/title>/i.exec(html)?.[1] ?? null);
    out.description = decode(meta(html, 'og:description') ?? meta(html, 'description'));
    const img = meta(html, 'og:image');
    out.image = img ? new URL(img, raw).toString() : null;
    out.price = meta(html, 'product:price:amount') ?? meta(html, 'og:price:amount');
    out.currency = meta(html, 'product:price:currency') ?? meta(html, 'og:price:currency');
    const ld = /"price"\s*:\s*"?([0-9.,]+)"?/.exec(html);
    if (!out.price && ld) out.price = ld[1]!.replace(/,/g, '');
  } catch (e) {
    out.error = e instanceof Error ? e.message : String(e);
  }
  return out;
}
