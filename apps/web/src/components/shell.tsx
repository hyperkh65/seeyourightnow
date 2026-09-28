'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Bell, ChevronDown, LogOut, Menu, ShieldAlert, UserCog, X, type LucideIcon } from 'lucide-react';
import { api } from '@/lib/api';
import { homeFor } from '@/lib/auth-client';
import { cn, timeAgo } from '@/lib/utils';
import { useMe } from './providers';
import { BrandMark, ThemeToggle, useLogout } from './site/chrome';
import { Avatar, Spinner } from './ui';

export interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
  perm?: string;
  feature?: string;
  exact?: boolean;
  badge?: number;
}
export interface NavGroup {
  title?: string;
  items: NavItem[];
}

interface Notification {
  id: string;
  title: string;
  body: string;
  link: string;
  severity: string;
  readAt: string | null;
  createdAt: string;
}

function NotificationBell() {
  const [open, setOpen] = useState(false);
  const qc = useQueryClient();
  const router = useRouter();
  const ref = useRef<HTMLDivElement>(null);
  const q = useQuery({ queryKey: ['notifications'], queryFn: () => api.get<{ items: Notification[]; unread: number }>('/notifications'), refetchInterval: 60_000 });
  const readAll = useMutation({ mutationFn: () => api.post('/notifications/read-all'), onSuccess: () => qc.invalidateQueries({ queryKey: ['notifications'] }) });
  useEffect(() => {
    const onClick = (e: MouseEvent) => ref.current && !ref.current.contains(e.target as Node) && setOpen(false);
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, []);
  const unread = q.data?.unread ?? 0;
  return (
    <div className="relative" ref={ref}>
      <button onClick={() => setOpen((o) => !o)} className="relative rounded-lg p-2 text-ink-muted hover:bg-ink/5" aria-label={`알림 ${unread}건`}>
        <Bell className="h-5 w-5" />
        {unread > 0 && <span className="absolute right-1 top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-red-500 px-1 text-[10px] font-bold text-white">{unread > 99 ? '99+' : unread}</span>}
      </button>
      {open && (
        <div className="absolute right-0 top-11 z-50 w-[min(92vw,380px)] overflow-hidden rounded-2xl border border-line bg-surface shadow-pop animate-fade-in">
          <div className="flex items-center justify-between border-b border-line px-4 py-3">
            <span className="text-sm font-semibold">알림</span>
            {unread > 0 && (
              <button onClick={() => readAll.mutate()} className="text-xs text-brand hover:underline">
                모두 읽음
              </button>
            )}
          </div>
          <div className="scroll-thin max-h-[60vh] overflow-y-auto">
            {q.isLoading ? (
              <div className="flex justify-center py-8">
                <Spinner />
              </div>
            ) : !q.data?.items.length ? (
              <p className="px-4 py-10 text-center text-sm text-ink-muted">새 알림이 없습니다.</p>
            ) : (
              q.data.items.slice(0, 30).map((n) => (
                <button
                  key={n.id}
                  onClick={async () => {
                    setOpen(false);
                    if (!n.readAt) await api.post(`/notifications/${n.id}/read`).catch(() => undefined);
                    void qc.invalidateQueries({ queryKey: ['notifications'] });
                    if (n.link) router.push(n.link);
                  }}
                  className={cn('flex w-full gap-3 border-b border-line/60 px-4 py-3 text-left hover:bg-surface-sunken', !n.readAt && 'bg-brand/[0.03]')}
                >
                  <span className={cn('mt-1.5 h-2 w-2 shrink-0 rounded-full', n.readAt ? 'bg-transparent' : n.severity === 'WARNING' ? 'bg-amber-500' : n.severity === 'CRITICAL' ? 'bg-red-500' : 'bg-brand')} />
                  <span className="min-w-0">
                    <span className="block text-sm text-ink">{n.title}</span>
                    {n.body && <span className="mt-0.5 block text-xs text-ink-muted">{n.body}</span>}
                    <span className="mt-1 block text-[11px] text-ink-muted">{timeAgo(n.createdAt)}</span>
                  </span>
                </button>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function UserMenu() {
  const me = useMe();
  const logout = useLogout();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const onClick = (e: MouseEvent) => ref.current && !ref.current.contains(e.target as Node) && setOpen(false);
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, []);
  const u = me.data?.user;
  if (!u) return null;
  return (
    <div className="relative" ref={ref}>
      <button onClick={() => setOpen((o) => !o)} className="flex items-center gap-2 rounded-lg p-1 pr-2 hover:bg-ink/5" aria-label="계정 메뉴" aria-expanded={open}>
        <Avatar name={u.name || u.email} />
        <span className="hidden max-w-[120px] truncate text-sm font-medium text-ink sm:block">{u.name || u.email}</span>
        <ChevronDown className="hidden h-4 w-4 text-ink-muted sm:block" />
      </button>
      {open && (
        <div className="absolute right-0 top-11 z-50 w-56 overflow-hidden rounded-xl border border-line bg-surface py-1 shadow-pop animate-fade-in">
          <div className="border-b border-line px-3 py-2">
            <p className="truncate text-sm font-medium">{u.name}</p>
            <p className="truncate text-xs text-ink-muted">{u.email}</p>
          </div>
          <Link href="/account/security" onClick={() => setOpen(false)} className="flex items-center gap-2 px-3 py-2 text-sm hover:bg-surface-sunken">
            <UserCog className="h-4 w-4 text-ink-muted" /> 계정·보안
          </Link>
          <button onClick={logout} className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-surface-sunken">
            <LogOut className="h-4 w-4 text-ink-muted" /> 로그아웃
          </button>
        </div>
      )}
    </div>
  );
}

function NavList({ groups, onNavigate }: { groups: NavGroup[]; onNavigate?: () => void }) {
  const path = usePathname();
  const me = useMe();
  const perms = new Set(me.data?.permissions ?? []);
  const features = new Set(me.data?.features ?? []);
  return (
    <nav className="space-y-5" aria-label="메뉴">
      {groups.map((g, gi) => {
        const items = g.items.filter((i) => (!i.perm || perms.has(i.perm)) && (!i.feature || features.has(i.feature)));
        if (!items.length) return null;
        return (
          <div key={gi}>
            {g.title && <p className="mb-1.5 px-3 text-[11px] font-semibold uppercase tracking-wider text-ink-muted/80">{g.title}</p>}
            <ul className="space-y-0.5">
              {items.map((i) => {
                const active = i.exact ? path === i.href : path === i.href || path.startsWith(`${i.href}/`);
                return (
                  <li key={i.href}>
                    <Link
                      href={i.href}
                      onClick={onNavigate}
                      aria-current={active ? 'page' : undefined}
                      className={cn('flex items-center gap-2.5 rounded-lg px-3 py-2 text-[13.5px] font-medium transition-colors', active ? 'bg-brand/10 text-brand' : 'text-ink-soft hover:bg-ink/5 hover:text-ink')}
                    >
                      <i.icon className="h-4 w-4 shrink-0" />
                      <span className="flex-1 truncate">{i.label}</span>
                      {!!i.badge && <span className="rounded-full bg-red-500 px-1.5 text-[10px] font-bold text-white">{i.badge}</span>}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        );
      })}
    </nav>
  );
}

/**
 * Authenticated application shell. `audience` restricts access; users of other
 * audiences are sent to their own home. Server-side authorisation is always
 * enforced by the API — this only shapes the UI.
 */
export function AppShell({ audience, groups, children, bottomNav, title }: { audience: Array<'STAFF' | 'CUSTOMER' | 'PARTNER' | 'PLATFORM'>; groups: NavGroup[]; children: ReactNode; bottomNav?: NavItem[]; title?: string }) {
  const me = useMe();
  const router = useRouter();
  const path = usePathname();
  const [drawer, setDrawer] = useState(false);
  const user = me.data?.user;

  useEffect(() => {
    if (me.isLoading) return;
    if (!user) router.replace(`/login?next=${encodeURIComponent(path)}`);
    else if (user.mfaSetupRequired && !path.startsWith('/account')) router.replace('/account/security?setup=1');
    else if (user.mfaPending) router.replace('/login/mfa');
    else if (!audience.includes(user.audience)) router.replace(homeFor(user.audience));
  }, [me.isLoading, user, audience, router, path]);

  if (me.isLoading || !user || !audience.includes(user.audience)) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <Spinner className="h-6 w-6" />
      </div>
    );
  }

  return (
    <div className="min-h-screen">
      {user.impersonating && (
        <div className="flex items-center justify-center gap-2 bg-red-600 px-4 py-1.5 text-xs font-semibold text-white">
          <ShieldAlert className="h-3.5 w-3.5" /> 지원 목적으로 다른 사용자 권한으로 접속 중입니다. 모든 작업이 기록됩니다.
        </div>
      )}
      {me.data?.tenant?.isDemo && <div className="bg-amber-100 px-4 py-1 text-center text-[11px] font-medium text-amber-900 dark:bg-amber-500/20 dark:text-amber-100">DEMO 환경 — 표시되는 운임·관세·환율·공급처는 데모 데이터입니다.</div>}
      <div className="flex">
        <aside className="sticky top-0 hidden h-screen w-60 shrink-0 flex-col border-r border-line bg-surface lg:flex">
          <div className="flex h-16 items-center px-5">
            <BrandMark href={homeFor(user.audience)} />
          </div>
          <div className="scroll-thin flex-1 overflow-y-auto px-3 pb-6 pt-2">
            <NavList groups={groups} />
          </div>
        </aside>
        {drawer && (
          <div className="fixed inset-0 z-50 lg:hidden" role="dialog" aria-modal="true">
            <div className="absolute inset-0 bg-slate-900/40" onClick={() => setDrawer(false)} />
            <div className="absolute inset-y-0 left-0 flex w-72 flex-col bg-surface shadow-pop animate-fade-in">
              <div className="flex h-16 items-center justify-between px-5">
                <BrandMark href={homeFor(user.audience)} />
                <button onClick={() => setDrawer(false)} className="rounded-lg p-1.5 hover:bg-ink/5" aria-label="메뉴 닫기">
                  <X className="h-5 w-5" />
                </button>
              </div>
              <div className="scroll-thin flex-1 overflow-y-auto px-3 pb-6">
                <NavList groups={groups} onNavigate={() => setDrawer(false)} />
              </div>
            </div>
          </div>
        )}
        <div className="flex min-w-0 flex-1 flex-col">
          <header className="sticky top-0 z-30 flex h-14 items-center justify-between gap-3 border-b border-line bg-surface/85 px-4 backdrop-blur sm:h-16 sm:px-6">
            <div className="flex items-center gap-2">
              <button onClick={() => setDrawer(true)} className="rounded-lg p-2 hover:bg-ink/5 lg:hidden" aria-label="메뉴 열기">
                <Menu className="h-5 w-5" />
              </button>
              <div className="lg:hidden">
                <BrandMark href={homeFor(user.audience)} />
              </div>
              {title && <span className="hidden text-sm font-medium text-ink-muted lg:block">{title}</span>}
            </div>
            <div className="flex items-center gap-1">
              <ThemeToggle />
              <NotificationBell />
              <UserMenu />
            </div>
          </header>
          <main className={cn('mx-auto w-full max-w-[1400px] flex-1 px-4 py-6 sm:px-6 sm:py-8', bottomNav && 'pb-24 lg:pb-8')}>{children}</main>
        </div>
      </div>
      {bottomNav && (
        <nav className="fixed inset-x-0 bottom-0 z-40 flex border-t border-line bg-surface/95 pb-[env(safe-area-inset-bottom)] backdrop-blur lg:hidden" aria-label="하단 메뉴">
          {bottomNav.map((i) => {
            const active = i.exact ? path === i.href : path.startsWith(i.href);
            return (
              <Link key={i.href} href={i.href} className={cn('flex flex-1 flex-col items-center gap-0.5 py-2 text-[11px] font-medium', active ? 'text-brand' : 'text-ink-muted')}>
                <i.icon className="h-5 w-5" />
                {i.label}
              </Link>
            );
          })}
        </nav>
      )}
    </div>
  );
}
