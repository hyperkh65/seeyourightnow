import { describe, expect, it } from 'vitest';
import sharp from 'sharp';
import { phashSimilarity } from '@sos/core';
import { isPrivateAddress } from '../src/lib/http.js';
import { csvCell, parseCsv } from '../src/modules/importexport.js';
import { aopSignature, coupangAuthorization } from '../src/services/connections/registry.js';
import { map1688Product, parse1688OfferId } from '../src/services/connectors/product-sources.js';
import { marketStats } from '../src/services/connectors/market.js';
import { getPath } from '../src/services/connectors/generic-http.js';
import { mapDcsaEvent } from '../src/services/tracking.js';
import { phash } from '../src/services/vision/phash.js';
import { decrypt, encrypt, signExpiring, verifyExpiring } from '../src/lib/crypto.js';
import { render } from '../src/services/templates/render.js';
import { scrub } from '../src/services/audit.js';

describe('service units', () => {
  it('private address detection', () => {
    expect(isPrivateAddress('10.1.2.3')).toBe(true);
    expect(isPrivateAddress('192.168.0.1')).toBe(true);
    expect(isPrivateAddress('172.20.1.1')).toBe(true);
    expect(isPrivateAddress('169.254.169.254')).toBe(true);
    expect(isPrivateAddress('::1')).toBe(true);
    expect(isPrivateAddress('8.8.8.8')).toBe(false);
    expect(isPrivateAddress('::ffff:127.0.0.1')).toBe(true);
  });

  it('CSV parsing and formula-injection-safe export', () => {
    expect(parseCsv('a,b\n"x, y","he said ""hi"""\n')).toEqual([
      ['a', 'b'],
      ['x, y', 'he said "hi"'],
    ]);
    expect(csvCell('=HYPERLINK("x")')).toBe(`"'=HYPERLINK(""x"")"`);
    expect(csvCell('plain')).toBe('plain');
  });

  it('signatures are deterministic and well-formed', () => {
    expect(aopSignature('param2/1/ns/api/123', { b: '2', a: '1' }, 'secret')).toMatch(/^[0-9A-F]{40}$/);
    expect(aopSignature('p', { b: '2', a: '1' }, 's')).toBe(aopSignature('p', { a: '1', b: '2' }, 's'));
    const h = coupangAuthorization('GET', '/v2/x', 'keyword=a', 'AK', 'SK', new Date('2026-01-02T03:04:05Z'));
    expect(h).toContain('signed-date=260102T030405Z');
    expect(h).toMatch(/signature=[0-9a-f]{64}$/);
  });

  it('1688 URL/offer parsing and mapping', () => {
    expect(parse1688OfferId('https://detail.1688.com/offer/612345678901.html?spm=a')).toBe('612345678901');
    const m = map1688Product('1', { productInfo: { subject: '小风扇', saleInfo: { priceRanges: [{ startQuantity: 2, price: 12.5 }], minOrderQuantity: 2 }, image: { images: ['img/a.jpg'] }, attributes: [{ attributeName: '材质', value: 'ABS' }] } });
    expect(m?.priceTiers).toEqual([{ minQty: 2, unitPrice: '12.5' }]);
    expect(m?.specs).toEqual({ 材质: 'ABS' });
    expect(map1688Product('2', {})).toBeNull();
  });

  it('DCSA event mapping keeps provenance classifiers', () => {
    const e = mapDcsaEvent({ eventType: 'TRANSPORT', transportEventTypeCode: 'DEPA', eventClassifierCode: 'ACT', eventDateTime: '2026-10-01T00:00:00Z', transportCall: { UNLocationCode: 'CNNGB' } });
    expect(e?.type).toBe('DEPARTED');
    expect(e?.location).toBe('CNNGB');
    expect(mapDcsaEvent({ eventType: 'X', eventDateTime: '2026-01-01' })).toBeNull();
  });

  it('market stats and JSON path mapping', () => {
    const s = marketStats([10000, 12000, 11000, 30000, 9000]);
    expect(s?.median).toBe(11000);
    expect(s?.min).toBe(9000);
    expect(getPath({ a: { b: [{ c: 5 }] } }, 'a.b.0.c')).toBe(5);
  });

  it('perceptual hash is stable across resize/recompression', async () => {
    const img = await sharp({ create: { width: 400, height: 300, channels: 3, background: '#fff' } })
      .composite([{ input: Buffer.from('<svg width="400" height="300"><circle cx="150" cy="150" r="90" fill="#1f4fd8"/><rect x="260" y="60" width="90" height="180" fill="#f59e0b"/></svg>'), top: 0, left: 0 }])
      .png()
      .toBuffer();
    const small = await sharp(img).resize(120).jpeg({ quality: 60 }).toBuffer();
    const other = await sharp({ create: { width: 400, height: 300, channels: 3, background: '#000' } }).composite([{ input: Buffer.from('<svg width="400" height="300"><rect x="0" y="0" width="200" height="300" fill="#fff"/></svg>'), top: 0, left: 0 }]).png().toBuffer();
    const a = await phash(img);
    const b = await phash(small);
    const c = await phash(other);
    expect(phashSimilarity(a, b)!).toBeGreaterThanOrEqual(0.75);
    expect(phashSimilarity(a, c)!).toBeLessThan(phashSimilarity(a, b)!);
  });

  it('secrets encrypt/decrypt and signed URLs expire', () => {
    const ct = encrypt('super-secret-key');
    expect(ct).not.toContain('super-secret');
    expect(decrypt(ct)).toBe('super-secret-key');
    const s = signExpiring('file:1', 60);
    expect(verifyExpiring('file:1', s.exp, s.sig)).toBe(true);
    expect(verifyExpiring('file:2', s.exp, s.sig)).toBe(false);
    expect(verifyExpiring('file:1', Math.floor(Date.now() / 1000) - 1, s.sig)).toBe(false);
  });

  it('templates escape HTML (no XSS through data)', () => {
    expect(render('<p>{{name}}</p>', { name: '<img src=x onerror=alert(1)>' })).toBe('<p>&lt;img src&#x3D;x onerror&#x3D;alert(1)&gt;</p>');
    expect(render('{{money v "KRW"}}', { v: '1234567.5' })).toBe('₩1,234,568');
  });

  it('audit scrub removes secrets', () => {
    expect(scrub({ apiKey: 'abc', nested: { password: 'p', ok: 1 } })).toEqual({ apiKey: '[REDACTED]', nested: { password: '[REDACTED]', ok: 1 } });
  });
});
