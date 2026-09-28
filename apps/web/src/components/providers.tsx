'use client';

import { QueryClient, QueryClientProvider, useQuery } from '@tanstack/react-query';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { CheckCircle2, ShieldCheck, XCircle } from 'lucide-react';
import { api, ApiError, errorMessage, setStepUpHandler } from '@/lib/api';
import type { Me, SiteConfig } from '@/lib/site';
import ko, { type MessageKey } from '@/messages/ko';
import en from '@/messages/en';
import zh from '@/messages/zh';
import { Button, Dialog, Field, Input } from './ui';

// ───────────────────────── Site ─────────────────────────
const SiteCtx = createContext<SiteConfig | null>(null);
export function useSite(): SiteConfig | null {
  return useContext(SiteCtx);
}

// ───────────────────────── i18n ─────────────────────────
type Locale = 'ko' | 'en' | 'zh';
const DICTS: Record<Locale, Partial<Record<MessageKey, string>>> = { ko, en, zh };
interface I18n {
  locale: Locale;
  setLocale: (l: Locale) => void;
  t: (key: MessageKey, fallback?: string) => string;
}
const I18nCtx = createContext<I18n>({ locale: 'ko', setLocale: () => undefined, t: (k) => ko[k] ?? k });
export function useT() {
  return useContext(I18nCtx);
}

// ───────────────────────── Toasts ─────────────────────────
interface ToastItem {
  id: number;
  tone: 'ok' | 'error' | 'info';
  text: string;
}
const ToastCtx = createContext<{ push: (tone: ToastItem['tone'], text: string) => void }>({
  push: () => undefined,
});
export function useToast() {
  const { push } = useContext(ToastCtx);
  return useMemo(
    () => ({
      ok: (t: string) => push('ok', t),
      error: (e: unknown) => push('error', typeof e === 'string' ? e : errorMessage(e)),
      info: (t: string) => push('info', t),
    }),
    [push],
  );
}

// ───────────────────────── Auth ─────────────────────────
export function useMe() {
  return useQuery({ queryKey: ['me'], queryFn: () => api.get<Me>('/auth/me'), staleTime: 30_000 });
}

export function useCan() {
  const { data } = useMe();
  return useCallback((perm: string) => !!data?.permissions.includes(perm), [data]);
}

function StepUpDialog({
  state,
  onDone,
}: {
  state: { open: boolean; resolve?: (ok: boolean) => void };
  onDone: () => void;
}) {
  const [value, setValue] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const me = useMe();
  const totp = !!me.data?.user?.mfaEnabled;
  const close = (ok: boolean) => {
    state.resolve?.(ok);
    setValue('');
    setErr(null);
    onDone();
  };
  const submit = async () => {
    setBusy(true);
    setErr(null);
    try {
      await api.post('/auth/step-up', totp ? { code: value } : { password: value }, { stepUp: false });
      close(true);
    } catch (e) {
      setErr(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog
      open={state.open}
      onClose={() => close(false)}
      title={
        <span className="flex items-center gap-2">
          <ShieldCheck className="h-5 w-5 text-brand" /> 본인 확인
        </span>
      }
      description="계좌·API 키·마진처럼 중요한 설정을 바꾸려면 다시 한 번 확인이 필요합니다."
      size="sm"
      footer={
        <>
          <Button variant="secondary" onClick={() => close(false)}>
            취소
          </Button>
          <Button onClick={submit} loading={busy} disabled={!value}>
            확인
          </Button>
        </>
      }
    >
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <Field label={totp ? '인증 앱의 6자리 코드' : '비밀번호'} error={err}>
          <Input
            type={totp ? 'text' : 'password'}
            inputMode={totp ? 'numeric' : undefined}
            autoComplete={totp ? 'one-time-code' : 'current-password'}
            value={value}
            onChange={(e) => setValue(e.target.value)}
          />
        </Field>
      </form>
    </Dialog>
  );
}

export function Providers({ site, children }: { site: SiteConfig | null; children: ReactNode }) {
  const [client] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            refetchOnWindowFocus: false,
            retry: (count, err) => !(err instanceof ApiError && err.status < 500) && count < 2,
          },
        },
      }),
  );
  const [locale, setLocaleState] = useState<Locale>(site?.locale.defaultLocale ?? 'ko');
  useEffect(() => {
    const saved =
      typeof localStorage !== 'undefined' ? (localStorage.getItem('locale') as Locale | null) : null;
    if (saved && DICTS[saved]) setLocaleState(saved);
  }, []);
  const i18n = useMemo<I18n>(
    () => ({
      locale,
      setLocale: (l) => {
        setLocaleState(l);
        localStorage.setItem('locale', l);
        document.documentElement.lang = l;
      },
      t: (key, fallback) => DICTS[locale][key] ?? ko[key] ?? fallback ?? key,
    }),
    [locale],
  );

  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const seq = useRef(0);
  const push = useCallback((tone: ToastItem['tone'], text: string) => {
    const id = ++seq.current;
    setToasts((t) => [...t.slice(-3), { id, tone, text }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), tone === 'error' ? 6000 : 3500);
  }, []);

  const [stepUp, setStepUp] = useState<{ open: boolean; resolve?: (ok: boolean) => void }>({ open: false });
  useEffect(() => {
    setStepUpHandler(() => new Promise<boolean>((resolve) => setStepUp({ open: true, resolve })));
    return () => setStepUpHandler(null);
  }, []);

  return (
    <SiteCtx.Provider value={site}>
      <I18nCtx.Provider value={i18n}>
        <QueryClientProvider client={client}>
          <ToastCtx.Provider value={{ push }}>
            {children}
            <StepUpDialog state={stepUp} onDone={() => setStepUp({ open: false })} />
            <div
              className="pointer-events-none fixed inset-x-0 bottom-4 z-[60] flex flex-col items-center gap-2 px-4 sm:bottom-6"
              aria-live="polite"
            >
              {toasts.map((t) => (
                <div
                  key={t.id}
                  className="pointer-events-auto flex max-w-md items-start gap-2.5 rounded-xl bg-slate-900 px-4 py-3 text-sm text-white shadow-pop animate-fade-in dark:bg-slate-100 dark:text-slate-900"
                >
                  {t.tone === 'ok' ? (
                    <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-400" />
                  ) : t.tone === 'error' ? (
                    <XCircle className="mt-0.5 h-4 w-4 shrink-0 text-red-400" />
                  ) : null}
                  <span>{t.text}</span>
                </div>
              ))}
            </div>
          </ToastCtx.Provider>
        </QueryClientProvider>
      </I18nCtx.Provider>
    </SiteCtx.Provider>
  );
}
