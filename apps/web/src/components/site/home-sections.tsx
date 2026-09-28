import Link from 'next/link';
import type { HomepageSection } from '@sos/core';
import { ArrowRight, BadgeCheck, Calculator, FileCheck2, Globe2, MessageCircle, PackageSearch, Ship, Sparkles } from 'lucide-react';
import type { SiteConfig } from '@/lib/site';
import { assetUrl } from '@/lib/theme';
import { cn } from '@/lib/utils';
import { SearchBox } from './search-box';

const BG: Record<HomepageSection['background'], string> = {
  default: 'bg-surface',
  muted: 'bg-surface-sunken',
  brand: 'bg-brand text-brand-fg',
  dark: 'bg-slate-950 text-white',
};

function Buttons({ s }: { s: HomepageSection }) {
  if (!s.buttons.length) return null;
  return (
    <div className={cn('mt-8 flex flex-wrap gap-3', s.align === 'center' && 'justify-center')}>
      {s.buttons.map((b) => (
        <Link
          key={b.href + b.label}
          href={b.href}
          className={cn(
            'inline-flex h-12 items-center gap-2 rounded-brand px-6 text-[15px] font-semibold transition',
            b.variant === 'primary' ? 'bg-brand text-brand-fg shadow-sm hover:bg-brand/90' : b.variant === 'secondary' ? 'border border-line bg-surface text-ink hover:bg-surface-sunken' : 'text-brand hover:underline',
          )}
        >
          {b.label}
          {b.variant === 'primary' && <ArrowRight className="h-4 w-4" />}
        </Link>
      ))}
    </div>
  );
}

const STEP_ICONS = [PackageSearch, Globe2, Calculator, Ship];

function SectionView({ s, site }: { s: HomepageSection; site: SiteConfig }) {
  const center = s.align === 'center' || s.type === 'FAQ' || s.type === 'CONTACT' || s.type === 'MESSENGER_CTA';
  const img = assetUrl(s.imageFileId);
  const head = (
    <div className={cn('max-w-3xl', center && 'mx-auto text-center')}>
      {s.title && <h2 className="text-2xl font-bold tracking-tight sm:text-3xl">{s.title}</h2>}
      {s.subtitle && <p className={cn('mt-3 text-base leading-relaxed sm:text-lg', s.background === 'brand' || s.background === 'dark' ? 'opacity-85' : 'text-ink-muted')}>{s.subtitle}</p>}
    </div>
  );

  switch (s.type) {
    case 'HERO':
      return (
        <div className="relative overflow-hidden">
          <div className="pointer-events-none absolute inset-0 -z-0 bg-[radial-gradient(60%_50%_at_50%_0%,rgb(var(--brand)/0.12),transparent)]" />
          <div className={cn('relative mx-auto max-w-6xl px-4 pb-10 pt-16 sm:px-6 sm:pt-24', center && 'text-center')}>
            <div className={cn('mb-5 inline-flex items-center gap-1.5 rounded-full border border-brand/20 bg-brand/5 px-3 py-1 text-xs font-semibold text-brand')}>
              <Sparkles className="h-3.5 w-3.5" /> AI 소싱
            </div>
            <h1 className={cn('text-[32px] font-extrabold leading-[1.15] tracking-tight sm:text-5xl', center && 'mx-auto max-w-3xl')}>{s.title}</h1>
            {s.subtitle && <p className={cn('mt-5 text-base leading-relaxed text-ink-muted sm:text-lg', center && 'mx-auto max-w-2xl')}>{s.subtitle}</p>}
            {img && (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={img} alt="" className="mx-auto mt-10 max-h-[420px] rounded-3xl border border-line object-cover shadow-pop" />
            )}
            {s.videoUrl && <video src={s.videoUrl} className="mx-auto mt-10 max-h-[420px] rounded-3xl" autoPlay muted loop playsInline />}
            <Buttons s={s} />
          </div>
        </div>
      );
    case 'IMAGE_SEARCH':
    case 'PRODUCT_SEARCH':
      return (
        <div className="mx-auto max-w-6xl px-4 py-10 sm:px-6">
          {(s.title || s.subtitle) && <div className="mb-6 text-center">{s.title && <h2 className="text-xl font-bold sm:text-2xl">{s.title}</h2>}{s.subtitle && <p className="mt-2 text-sm text-ink-muted">{s.subtitle}</p>}</div>}
          <SearchBox />
          <div className="mx-auto mt-5 flex max-w-3xl flex-wrap justify-center gap-x-6 gap-y-2 text-[13px] text-ink-muted">
            <span className="flex items-center gap-1.5"><BadgeCheck className="h-4 w-4 text-accent" /> 가입 없이 첫 검색</span>
            <span className="flex items-center gap-1.5"><Calculator className="h-4 w-4 text-accent" /> 운임·관세 포함 예상 도착가</span>
            <span className="flex items-center gap-1.5"><FileCheck2 className="h-4 w-4 text-accent" /> 필요한 인증 미리 확인</span>
          </div>
        </div>
      );
    case 'HOW_IT_WORKS':
    case 'AI_SOURCING':
      return (
        <div className="mx-auto max-w-6xl px-4 py-16 sm:px-6">
          {head}
          <ol className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {s.items.map((it, i) => {
              const Icon = STEP_ICONS[i % STEP_ICONS.length]!;
              return (
                <li key={i} className="rounded-2xl border border-line bg-surface p-5 shadow-card">
                  <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-brand/10 text-brand">
                    <Icon className="h-5 w-5" />
                  </span>
                  <p className="mt-4 font-semibold">{it.title}</p>
                  {it.text && <p className="mt-1.5 text-sm leading-relaxed text-ink-muted">{it.text}</p>}
                </li>
              );
            })}
          </ol>
        </div>
      );
    case 'FAQ':
      return (
        <div className="mx-auto max-w-3xl px-4 py-16 sm:px-6">
          {head}
          <div className="mt-8 divide-y divide-line rounded-2xl border border-line bg-surface">
            {s.items.map((it, i) => (
              <details key={i} className="group px-5 py-4 [&_summary::-webkit-details-marker]:hidden">
                <summary className="flex cursor-pointer list-none items-center justify-between gap-4 font-medium">
                  {it.title}
                  <span className="text-ink-muted transition group-open:rotate-45">+</span>
                </summary>
                <p className="mt-3 text-sm leading-relaxed text-ink-muted">{it.text}</p>
              </details>
            ))}
          </div>
        </div>
      );
    case 'REVIEWS':
    case 'CASE_STUDIES':
    case 'POPULAR_PRODUCTS':
    case 'RECOMMENDED_PRODUCTS':
      return (
        <div className="mx-auto max-w-6xl px-4 py-16 sm:px-6">
          {head}
          {s.items.length > 0 && (
            <div className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {s.items.map((it, i) => (
                <article key={i} className="overflow-hidden rounded-2xl border border-line bg-surface shadow-card">
                  {it.imageFileId && (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={assetUrl(it.imageFileId)!} alt="" className="aspect-[4/3] w-full object-cover" />
                  )}
                  <div className="p-5">
                    <p className="font-semibold">{it.title}</p>
                    {it.text && <p className="mt-1.5 text-sm leading-relaxed text-ink-muted">{it.text}</p>}
                  </div>
                </article>
              ))}
            </div>
          )}
          <Buttons s={s} />
        </div>
      );
    case 'CONTACT':
    case 'MESSENGER_CTA': {
      const c = site.company;
      const ctas = site.social.links.filter((l) => l.enabled && l.url);
      return (
        <div className="mx-auto max-w-6xl px-4 py-16 sm:px-6">
          <div className="rounded-3xl border border-line bg-surface-sunken px-6 py-10 text-center sm:px-10">
            {head}
            <div className="mt-6 flex flex-wrap justify-center gap-3 text-sm">
              {c.phone && <a href={`tel:${c.phone}`} className="rounded-full border border-line bg-surface px-4 py-2 font-medium hover:border-brand/40">{c.phone}</a>}
              {c.email && <a href={`mailto:${c.email}`} className="rounded-full border border-line bg-surface px-4 py-2 font-medium hover:border-brand/40">{c.email}</a>}
              {ctas.slice(0, 4).map((l) => (
                <a key={l.id} href={l.url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1.5 rounded-full bg-brand px-4 py-2 font-semibold text-brand-fg hover:bg-brand/90">
                  <MessageCircle className="h-4 w-4" /> {l.label || l.type}
                </a>
              ))}
            </div>
            {c.csHours && <p className="mt-4 text-xs text-ink-muted">상담시간 {c.csHours}</p>}
            <Buttons s={s} />
          </div>
        </div>
      );
    }
    case 'CUSTOM_TEXT':
    default:
      return (
        <div className="mx-auto max-w-6xl px-4 py-16 sm:px-6">
          {head}
          {s.body && <div className={cn('mt-6 whitespace-pre-line text-[15px] leading-relaxed', center && 'text-center')}>{s.body}</div>}
          <Buttons s={s} />
        </div>
      );
  }
}

export function HomeSections({ site }: { site: SiteConfig }) {
  const sections = site.homepage.sections.filter((s) => s.enabled && s.visibility !== 'LOGGED_IN');
  return (
    <>
      {sections.map((s) => (
        <section key={s.id} className={cn(BG[s.background], s.hideOnMobile && 'hidden sm:block')} aria-label={s.title || s.type}>
          <SectionView s={s} site={site} />
        </section>
      ))}
    </>
  );
}
