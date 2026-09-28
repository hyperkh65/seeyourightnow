'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { LogOut, Menu, MessageCircle, Moon, Sun, X } from 'lucide-react';
import { api } from '@/lib/api';
import { assetUrl } from '@/lib/theme';
import { cn } from '@/lib/utils';
import { useMe, useSite, useT } from '../providers';
import { Badge, Button } from '../ui';

export function BrandMark({ className, href = '/' }: { className?: string; href?: string }) {
  const site = useSite();
  const logo = assetUrl(site?.brand.logoFileId);
  const name = site?.brand.siteName ?? 'Sourcing';
  return (
    <Link href={href} className={cn('flex items-center gap-2 font-bold tracking-tight text-ink', className)} aria-label={`${name} 홈`}>
      {logo ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={logo} alt={name} className="h-7 w-auto max-w-[160px] object-contain" />
      ) : (
        <>
          <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-brand text-[13px] font-extrabold text-brand-fg">{name.slice(0, 1)}</span>
          <span className="text-[15px]">{name}</span>
        </>
      )}
      {site?.tenant.isDemo && <Badge tone="warn">DEMO</Badge>}
    </Link>
  );
}

export function ThemeToggle() {
  const toggle = () => {
    const dark = document.documentElement.classList.toggle('dark');
    localStorage.setItem('theme', dark ? 'dark' : 'light');
  };
  return (
    <button onClick={toggle} className="rounded-lg p-2 text-ink-muted hover:bg-ink/5" aria-label="화면 테마 전환">
      <Sun className="hidden h-4 w-4 dark:block" />
      <Moon className="h-4 w-4 dark:hidden" />
    </button>
  );
}

export function useLogout() {
  const qc = useQueryClient();
  const router = useRouter();
  return async () => {
    await api.post('/auth/logout').catch(() => undefined);
    qc.clear();
    router.push('/');
    router.refresh();
  };
}

export { homeFor } from '@/lib/auth-client';
import { homeFor } from '@/lib/auth-client';

export function PublicHeader() {
  const { t } = useT();
  const me = useMe();
  const [open, setOpen] = useState(false);
  const logout = useLogout();
  const path = usePathname();
  const user = me.data?.user;
  const links = [
    { href: '/search', label: t('nav.search') },
    ...(user ? [{ href: homeFor(user.audience), label: user.audience === 'CUSTOMER' ? t('nav.mySourcing') : '관리 화면' }] : []),
  ];
  return (
    <header className="sticky top-0 z-40 border-b border-line/80 bg-surface/85 backdrop-blur supports-[backdrop-filter]:bg-surface/70">
      <div className="mx-auto flex h-16 max-w-6xl items-center justify-between gap-4 px-4 sm:px-6">
        <BrandMark />
        <nav className="hidden items-center gap-1 md:flex" aria-label="주 메뉴">
          {links.map((l) => (
            <Link key={l.href} href={l.href} className={cn('rounded-lg px-3 py-2 text-sm font-medium text-ink-soft hover:bg-ink/5 hover:text-ink', path.startsWith(l.href) && 'text-ink')}>
              {l.label}
            </Link>
          ))}
        </nav>
        <div className="hidden items-center gap-2 md:flex">
          <ThemeToggle />
          {user ? (
            <Button variant="ghost" size="sm" onClick={logout} icon={<LogOut className="h-4 w-4" />}>
              {t('nav.logout')}
            </Button>
          ) : (
            <>
              <Link href="/login">
                <Button variant="ghost" size="sm">
                  {t('nav.login')}
                </Button>
              </Link>
              <Link href="/signup">
                <Button size="sm">{t('nav.signup')}</Button>
              </Link>
            </>
          )}
        </div>
        <button className="rounded-lg p-2 md:hidden" onClick={() => setOpen((o) => !o)} aria-label="메뉴 열기" aria-expanded={open}>
          {open ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
        </button>
      </div>
      {open && (
        <div className="border-t border-line bg-surface px-4 py-3 md:hidden">
          <nav className="flex flex-col" aria-label="모바일 메뉴">
            {links.map((l) => (
              <Link key={l.href} href={l.href} onClick={() => setOpen(false)} className="rounded-lg px-3 py-3 text-[15px] font-medium text-ink hover:bg-ink/5">
                {l.label}
              </Link>
            ))}
            {user ? (
              <button onClick={logout} className="rounded-lg px-3 py-3 text-left text-[15px] text-ink-muted hover:bg-ink/5">
                {t('nav.logout')}
              </button>
            ) : (
              <div className="mt-2 grid grid-cols-2 gap-2">
                <Link href="/login" onClick={() => setOpen(false)}>
                  <Button variant="secondary" className="w-full">
                    {t('nav.login')}
                  </Button>
                </Link>
                <Link href="/signup" onClick={() => setOpen(false)}>
                  <Button className="w-full">{t('nav.signup')}</Button>
                </Link>
              </div>
            )}
          </nav>
        </div>
      )}
    </header>
  );
}

const SOCIAL_LABEL: Record<string, string> = {
  KAKAO_CHANNEL: '카카오톡 채널',
  KAKAO_OPENCHAT: '카카오 오픈채팅',
  WECHAT: 'WeChat',
  WHATSAPP: 'WhatsApp',
  INSTAGRAM: 'Instagram',
  YOUTUBE: 'YouTube',
  FACEBOOK: 'Facebook',
  X: 'X',
  THREADS: 'Threads',
  NAVER_BLOG: '네이버 블로그',
};

export function PublicFooter() {
  const site = useSite();
  if (!site) return null;
  const c = site.company;
  const links = site.social.links.filter((l) => l.enabled && l.showInFooter);
  const policies = site.policies;
  return (
    <footer className="mt-20 border-t border-line bg-surface">
      <div className="mx-auto grid max-w-6xl gap-8 px-4 py-10 sm:px-6 md:grid-cols-[1.5fr_1fr]">
        <div className="space-y-3 text-[13px] leading-relaxed text-ink-muted">
          <BrandMark />
          {site.footer.showCompanyInfo && (
            <p>
              {[c.legalName, c.representative && `대표 ${c.representative}`, c.businessRegistrationNo && `사업자등록번호 ${c.businessRegistrationNo}`, c.ecommerceRegistrationNo && `통신판매업 ${c.ecommerceRegistrationNo}`].filter(Boolean).join(' · ')}
              <br />
              {[c.address, c.phone && `Tel ${c.phone}`, c.fax && `Fax ${c.fax}`, c.email].filter(Boolean).join(' · ')}
              {c.csHours && (
                <>
                  <br />
                  상담시간 {c.csHours}
                </>
              )}
            </p>
          )}
          {site.footer.customText && <p className="whitespace-pre-line">{site.footer.customText}</p>}
          <p>{site.footer.copyright}</p>
        </div>
        <div className="space-y-4 text-[13px]">
          {links.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {links.map((l) =>
                l.url ? (
                  <a key={l.id} href={l.url} target="_blank" rel="noopener noreferrer" className="rounded-full border border-line px-3 py-1.5 text-ink-soft hover:border-brand/40 hover:text-brand">
                    {l.label || SOCIAL_LABEL[l.type] || l.type}
                  </a>
                ) : (
                  <span key={l.id} className="rounded-full border border-line px-3 py-1.5 text-ink-soft">
                    {l.label || SOCIAL_LABEL[l.type] || l.type} {l.value}
                  </span>
                ),
              )}
            </div>
          )}
          <div className="flex flex-wrap gap-x-4 gap-y-2 text-ink-muted">
            {policies.map((p) => (
              <Link key={p.type} href={`/policies/${p.type.toLowerCase()}`} className={cn('hover:text-ink', p.type === 'PRIVACY' && 'font-semibold text-ink-soft')}>
                {p.title}
              </Link>
            ))}
            {site.footer.policyLinks.map((l) => (
              <a key={l.href} href={l.href} className="hover:text-ink">
                {l.label}
              </a>
            ))}
          </div>
        </div>
      </div>
    </footer>
  );
}

/** Floating messenger CTA (Kakao / WeChat / WhatsApp …) configured in Admin → SNS. */
export function MessengerCta() {
  const site = useSite();
  const cta = site?.social.links.find((l) => l.enabled && l.showAsCta && l.url);
  if (!cta) return null;
  return (
    <a href={cta.url} target="_blank" rel="noopener noreferrer" className="fixed bottom-5 right-5 z-30 flex items-center gap-2 rounded-full bg-[#FEE500] px-4 py-3 text-sm font-semibold text-[#191919] shadow-pop hover:brightness-95 no-print" style={cta.type.startsWith('KAKAO') ? undefined : { background: 'rgb(var(--brand))', color: 'rgb(var(--brand-fg))' }}>
      <MessageCircle className="h-4 w-4" />
      {cta.label || SOCIAL_LABEL[cta.type] || '상담하기'}
    </a>
  );
}

export function PreviewBanner() {
  const site = useSite();
  if (!site?.previewing) return null;
  return <div className="bg-amber-400 px-4 py-1.5 text-center text-xs font-semibold text-amber-950">미리보기 중입니다 — 게시 전 초안이 표시되고 있습니다.</div>;
}
