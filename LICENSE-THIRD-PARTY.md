# Third-party licences

Policy: prefer MIT / Apache-2.0 / BSD / ISC. Copyleft network licences (AGPL, SSPL) and source-available licences are **not** linked into the product; where such software is useful it runs, unmodified, as a separate optional service and is listed below for review. Generated with `pnpm licenses list --prod` (Node) and package metadata (Python); re-run before each release.

## Summary (Node production dependency tree, 346 packages)

| Licence | Packages | Notes |
| --- | --- | --- |
| MIT | 239 | |
| Apache-2.0 | 39 | e.g. AWS SDK, drizzle-orm, sharp, playwright-core |
| ISC | 37 | e.g. lucide-react |
| BSD-3-Clause | 11 | e.g. maplibre-gl |
| BSD-2-Clause | 3 | |
| BlueOak-1.0.0 | 5 | glob, lru-cache, minimatch, minipass, path-scurry (permissive) |
| MIT/X11 | 2 | chainsaw, traverse (via exceljs) |
| (MIT OR Apache-2.0) | 1 | @maplibre/mlt |
| (MIT OR GPL-3.0-or-later) | 1 | jszip — used under **MIT** |
| (MIT AND Zlib) | 1 | pako |
| MIT-0 | 1 | nodemailer |
| 0BSD | 1 | tslib |
| Unlicense | 1 | big-integer |
| CC-BY-4.0 | 1 | caniuse-lite (browser data, build-time) |
| LGPL-3.0-or-later | 1 | `@img/sharp-libvips-*` — prebuilt libvips binary loaded dynamically by sharp; LGPL obligations met by distributing it unmodified as a separate shared library |
| Unknown metadata | 2 | `buffers`, `thirty-two` (transitive via exceljs / otplib) — both published under MIT/X11-style terms in their repositories; verify before redistribution |

No AGPL, SSPL, BUSL or Commons-Clause code is included in the application packages.

## Direct dependencies

- **@sos/core**: decimal.js (MIT), zod (MIT)
- **@sos/api**: fastify, @fastify/{cookie,helmet,multipart,rate-limit,swagger,swagger-ui}, fastify-type-provider-zod (MIT); drizzle-orm (Apache-2.0); pg (MIT); ioredis (MIT); @node-rs/argon2 (MIT); otplib (MIT); @simplewebauthn/server (MIT); handlebars (MIT); file-type (MIT); sharp (Apache-2.0); exceljs (MIT); nodemailer (MIT-0); pino (MIT); undici (MIT); ws (MIT); @aws-sdk/client-s3 + s3-request-presigner (Apache-2.0); playwright-core (Apache-2.0, PDF fallback renderer)
- **@sos/web**: next, react, react-dom (MIT); @tanstack/react-query (MIT); react-hook-form + @hookform/resolvers (MIT); maplibre-gl (BSD-3-Clause); lucide-react (ISC); qrcode (MIT); @simplewebauthn/browser (MIT); clsx, tailwind-merge (MIT); tailwindcss (MIT, build)
- **e2e / tooling**: @playwright/test (Apache-2.0), vitest (MIT), typescript (Apache-2.0), eslint + typescript-eslint (MIT), prettier (MIT), drizzle-kit (MIT)

## AI worker (Python)

| Package | Licence | Installed |
| --- | --- | --- |
| fastapi | MIT | always |
| uvicorn | BSD-3-Clause | always |
| pillow | MIT-CMU (HPND) | always |
| numpy | BSD-3-Clause | always |
| pyais | MIT | always |
| torch | BSD-3-Clause | `INSTALL_ML=true` |
| transformers, timm, sentencepiece | Apache-2.0 | `INSTALL_ML=true` |
| einops | MIT | `INSTALL_ML=true` |
| paddlepaddle, paddleocr | Apache-2.0 | `INSTALL_ML=true` |
| rembg | MIT | `INSTALL_ML=true` |
| onnxruntime | MIT | `INSTALL_ML=true` |

Model weights (downloaded at runtime, not redistributed): SigLIP `google/siglip-base-patch16-224` (Apache-2.0), Florence-2 `microsoft/Florence-2-base` (MIT), U²-Net `u2netp` (Apache-2.0), PaddleOCR models (Apache-2.0). Florence-2 loads custom model code (`trust_remote_code`); pin a reviewed revision in production.

## Services (separate containers, not linked)

| Service | Licence | Notes |
| --- | --- | --- |
| PostgreSQL 16 | PostgreSQL License | |
| pgvector | PostgreSQL License | |
| Valkey | BSD-3-Clause | Redis-compatible (chosen instead of Redis ≥7.4 source-available licences) |
| Gotenberg | MIT | bundles Chromium (BSD-3-Clause and others) and LibreOffice (MPL-2.0) |
| Caddy | Apache-2.0 | optional edge proxy |
| ClamAV | GPL-2.0 | optional, separate process via clamd protocol |
| MinIO (optional, not included) | AGPL-3.0 | if used as S3 storage, run unmodified; alternatives: SeaweedFS (Apache-2.0), cloud S3/R2 |
| n8n (not included) | Sustainable Use License | not embedded; integrate via webhooks only |
| Temporal (future option) | MIT | see ADR-001 |

## Fonts, data and tiles

- Pretendard (SIL Open Font License 1.1), loaded from jsDelivr; system fonts are used as fallback.
- Map tiles/style: OpenFreeMap (style MIT; map data © OpenStreetMap contributors, ODbL) — the map keeps the attribution control visible.
- UN/LOCODE port list (UNECE, free to use), HS nomenclature samples and Korean regulation summaries are reference data entered from public government sources; tariff rates are imported by each operator from official sources.
