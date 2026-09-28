'use client';

import { forwardRef, useEffect, useId, useRef, type ButtonHTMLAttributes, type HTMLAttributes, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from 'react';
import { AlertTriangle, Check, ChevronRight, Info, Loader2, X } from 'lucide-react';
import { cn } from '@/lib/utils';

// ───────────────────────── Button ─────────────────────────
type Variant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'outline' | 'link';
type Size = 'sm' | 'md' | 'lg' | 'icon';

const VARIANT: Record<Variant, string> = {
  primary: 'bg-brand text-brand-fg hover:bg-brand/90 shadow-sm',
  secondary: 'bg-surface text-ink border border-line hover:bg-surface-sunken shadow-sm',
  outline: 'border border-brand/40 text-brand hover:bg-brand/5',
  ghost: 'text-ink-soft hover:bg-ink/5',
  danger: 'bg-red-600 text-white hover:bg-red-700 shadow-sm',
  link: 'text-brand underline-offset-4 hover:underline px-0',
};
const SIZE: Record<Size, string> = { sm: 'h-8 px-3 text-[13px] gap-1.5', md: 'h-10 px-4 text-sm gap-2', lg: 'h-12 px-6 text-[15px] gap-2', icon: 'h-9 w-9' };

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  loading?: boolean;
  icon?: ReactNode;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button({ className, variant = 'primary', size = 'md', loading, icon, children, disabled, type = 'button', ...props }, ref) {
  return (
    <button
      ref={ref}
      type={type}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={cn('inline-flex shrink-0 select-none items-center justify-center whitespace-nowrap rounded-brand font-medium transition-colors disabled:pointer-events-none disabled:opacity-50', VARIANT[variant], SIZE[size], className)}
      {...props}
    >
      {loading ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : icon}
      {children}
    </button>
  );
});

// ───────────────────────── Form controls ─────────────────────────
const control = 'w-full rounded-brand border border-line bg-surface px-3 text-sm text-ink placeholder:text-ink-muted/70 shadow-sm transition focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/20 disabled:opacity-60';

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(function Input({ className, ...p }, ref) {
  return <input ref={ref} className={cn(control, 'h-10', className)} {...p} />;
});

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement>>(function Textarea({ className, ...p }, ref) {
  return <textarea ref={ref} className={cn(control, 'min-h-[88px] py-2 leading-relaxed', className)} {...p} />;
});

export const Select = forwardRef<HTMLSelectElement, SelectHTMLAttributes<HTMLSelectElement>>(function Select({ className, children, ...p }, ref) {
  return (
    <select ref={ref} className={cn(control, 'h-10 appearance-none bg-[length:16px] bg-[right_10px_center] bg-no-repeat pr-9', className)} style={{ backgroundImage: "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='%2364748b' stroke-width='2'%3E%3Cpath d='m6 9 6 6 6-6'/%3E%3C/svg%3E\")" }} {...p}>
      {children}
    </select>
  );
});

export function Field({ label, hint, error, required, children, className, htmlFor }: { label?: ReactNode; hint?: ReactNode; error?: string | null; required?: boolean; children: ReactNode; className?: string; htmlFor?: string }) {
  return (
    <div className={cn('space-y-1.5', className)}>
      {label && (
        <label htmlFor={htmlFor} className="block text-[13px] font-medium text-ink-soft">
          {label}
          {required && <span className="ml-0.5 text-red-500">*</span>}
        </label>
      )}
      {children}
      {error ? <p className="text-xs text-red-600" role="alert">{error}</p> : hint ? <p className="text-xs text-ink-muted">{hint}</p> : null}
    </div>
  );
}

export function Switch({ checked, onChange, label, disabled, id }: { checked: boolean; onChange: (v: boolean) => void; label?: ReactNode; disabled?: boolean; id?: string }) {
  const auto = useId();
  const sid = id ?? auto;
  return (
    <label htmlFor={sid} className={cn('inline-flex cursor-pointer items-center gap-2.5 text-sm', disabled && 'cursor-not-allowed opacity-60')}>
      <button
        id={sid}
        type="button"
        role="switch"
        aria-checked={checked}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className={cn('relative inline-flex h-6 w-10 shrink-0 items-center rounded-full transition-colors', checked ? 'bg-brand' : 'bg-line')}
      >
        <span className={cn('inline-block h-5 w-5 transform rounded-full bg-white shadow transition-transform', checked ? 'translate-x-[18px]' : 'translate-x-0.5')} />
      </button>
      {label && <span className="text-ink-soft">{label}</span>}
    </label>
  );
}

export function Checkbox({ checked, onChange, label, id }: { checked: boolean; onChange: (v: boolean) => void; label?: ReactNode; id?: string }) {
  const auto = useId();
  return (
    <label htmlFor={id ?? auto} className="inline-flex cursor-pointer items-center gap-2 text-sm text-ink-soft">
      <input id={id ?? auto} type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} className="h-4 w-4 rounded border-line text-brand accent-[rgb(var(--brand))]" />
      {label}
    </label>
  );
}

// ───────────────────────── Surfaces ─────────────────────────
export function Card({ className, children, ...p }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={cn('rounded-2xl border border-line bg-surface shadow-card', className)} {...p}>
      {children}
    </div>
  );
}

export function CardHeader({ title, description, action, className }: { title: ReactNode; description?: ReactNode; action?: ReactNode; className?: string }) {
  return (
    <div className={cn('flex items-start justify-between gap-4 border-b border-line px-5 py-4', className)}>
      <div className="min-w-0">
        <h3 className="text-[15px] font-semibold text-ink">{title}</h3>
        {description && <p className="mt-0.5 text-[13px] text-ink-muted">{description}</p>}
      </div>
      {action && <div className="flex shrink-0 items-center gap-2">{action}</div>}
    </div>
  );
}

export function CardBody({ className, children }: { className?: string; children: ReactNode }) {
  return <div className={cn('p-5', className)}>{children}</div>;
}

export function PageHeader({ title, description, actions, back, eyebrow }: { title: ReactNode; description?: ReactNode; actions?: ReactNode; back?: ReactNode; eyebrow?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
      <div className="min-w-0">
        {back}
        {eyebrow && <div className="mb-1 text-xs font-medium uppercase tracking-wide text-ink-muted">{eyebrow}</div>}
        <h1 className="text-[22px] font-bold tracking-tight text-ink sm:text-2xl">{title}</h1>
        {description && <p className="mt-1 text-sm text-ink-muted">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

// ───────────────────────── Badges ─────────────────────────
type Tone = 'neutral' | 'brand' | 'ok' | 'warn' | 'danger' | 'info' | 'purple';
const TONE: Record<Tone, string> = {
  neutral: 'bg-ink/5 text-ink-soft ring-ink/10',
  brand: 'bg-brand/10 text-brand ring-brand/20',
  ok: 'bg-emerald-50 text-emerald-700 ring-emerald-600/20 dark:bg-emerald-500/10 dark:text-emerald-300',
  warn: 'bg-amber-50 text-amber-800 ring-amber-600/20 dark:bg-amber-500/10 dark:text-amber-300',
  danger: 'bg-red-50 text-red-700 ring-red-600/20 dark:bg-red-500/10 dark:text-red-300',
  info: 'bg-sky-50 text-sky-700 ring-sky-600/20 dark:bg-sky-500/10 dark:text-sky-300',
  purple: 'bg-violet-50 text-violet-700 ring-violet-600/20 dark:bg-violet-500/10 dark:text-violet-300',
};

export function Badge({ tone = 'neutral', children, className, icon, title }: { tone?: Tone; children: ReactNode; className?: string; icon?: ReactNode; title?: string }) {
  return (
    <span title={title} className={cn('inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2 py-0.5 text-[11.5px] font-medium ring-1 ring-inset', TONE[tone], className)}>
      {icon}
      {children}
    </span>
  );
}

// ───────────────────────── Feedback ─────────────────────────
export function Spinner({ className }: { className?: string }) {
  return <Loader2 className={cn('h-5 w-5 animate-spin text-ink-muted', className)} aria-label="불러오는 중" />;
}

export function Skeleton({ className }: { className?: string }) {
  return <div className={cn('skeleton h-4', className)} aria-hidden />;
}

export function LoadingBlock({ rows = 3 }: { rows?: number }) {
  return (
    <div className="space-y-3 p-1" aria-busy aria-label="불러오는 중">
      {Array.from({ length: rows }, (_, i) => (
        <Skeleton key={i} className={cn('h-4', i % 3 === 2 ? 'w-2/3' : 'w-full')} />
      ))}
    </div>
  );
}

export function EmptyState({ icon, title, description, action, className }: { icon?: ReactNode; title: ReactNode; description?: ReactNode; action?: ReactNode; className?: string }) {
  return (
    <div className={cn('flex flex-col items-center justify-center px-6 py-12 text-center', className)}>
      {icon && <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-2xl bg-brand/10 text-brand">{icon}</div>}
      <p className="text-[15px] font-semibold text-ink">{title}</p>
      {description && <p className="mt-1 max-w-sm text-sm text-ink-muted">{description}</p>}
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}

export function Alert({ tone = 'info', title, children, className, action }: { tone?: 'info' | 'warn' | 'danger' | 'ok'; title?: ReactNode; children?: ReactNode; className?: string; action?: ReactNode }) {
  const styles = {
    info: 'border-sky-200 bg-sky-50 text-sky-900 dark:border-sky-500/30 dark:bg-sky-500/10 dark:text-sky-100',
    warn: 'border-amber-200 bg-amber-50 text-amber-900 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-100',
    danger: 'border-red-200 bg-red-50 text-red-900 dark:border-red-500/30 dark:bg-red-500/10 dark:text-red-100',
    ok: 'border-emerald-200 bg-emerald-50 text-emerald-900 dark:border-emerald-500/30 dark:bg-emerald-500/10 dark:text-emerald-100',
  }[tone];
  const Icon = tone === 'ok' ? Check : tone === 'info' ? Info : AlertTriangle;
  return (
    <div role={tone === 'danger' ? 'alert' : 'status'} className={cn('flex gap-3 rounded-xl border px-4 py-3 text-sm', styles, className)}>
      <Icon className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
      <div className="min-w-0 flex-1">
        {title && <p className="font-semibold">{title}</p>}
        {children && <div className={cn('leading-relaxed', title && 'mt-0.5 opacity-90')}>{children}</div>}
      </div>
      {action}
    </div>
  );
}

export function ErrorState({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  const msg = error instanceof Error ? error.message : '문제가 발생했습니다.';
  return (
    <EmptyState
      icon={<AlertTriangle className="h-5 w-5" />}
      title="정보를 불러오지 못했습니다"
      description={msg}
      action={onRetry ? <Button variant="secondary" onClick={onRetry}>다시 시도</Button> : undefined}
    />
  );
}

// ───────────────────────── Dialog ─────────────────────────
export function Dialog({ open, onClose, title, description, children, footer, size = 'md' }: { open: boolean; onClose: () => void; title: ReactNode; description?: ReactNode; children?: ReactNode; footer?: ReactNode; size?: 'sm' | 'md' | 'lg' | 'xl' }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const prev = document.activeElement as HTMLElement | null;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      if (e.key === 'Tab' && ref.current) {
        const f = ref.current.querySelectorAll<HTMLElement>('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])');
        if (!f.length) return;
        const first = f[0]!;
        const last = f[f.length - 1]!;
        if (e.shiftKey && document.activeElement === first) {
          last.focus();
          e.preventDefault();
        } else if (!e.shiftKey && document.activeElement === last) {
          first.focus();
          e.preventDefault();
        }
      }
    };
    document.addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';
    setTimeout(() => ref.current?.querySelector<HTMLElement>('input, textarea, select, button:not([data-close])')?.focus(), 30);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = '';
      prev?.focus?.();
    };
  }, [open, onClose]);
  if (!open) return null;
  const width = { sm: 'max-w-sm', md: 'max-w-lg', lg: 'max-w-2xl', xl: 'max-w-4xl' }[size];
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center sm:p-4" role="dialog" aria-modal="true">
      <div className="absolute inset-0 bg-slate-900/40 backdrop-blur-[2px] animate-fade-in" onClick={onClose} />
      <div ref={ref} className={cn('relative flex max-h-[92vh] w-full flex-col rounded-t-2xl bg-surface shadow-pop animate-fade-in sm:rounded-2xl', width)}>
        <div className="flex items-start justify-between gap-4 border-b border-line px-5 py-4">
          <div>
            <h2 className="text-base font-semibold text-ink">{title}</h2>
            {description && <p className="mt-0.5 text-[13px] text-ink-muted">{description}</p>}
          </div>
          <button data-close onClick={onClose} className="rounded-lg p-1 text-ink-muted hover:bg-ink/5" aria-label="닫기">
            <X className="h-5 w-5" />
          </button>
        </div>
        <div className="scroll-thin overflow-y-auto px-5 py-4">{children}</div>
        {footer && <div className="flex flex-col-reverse gap-2 border-t border-line px-5 py-3 sm:flex-row sm:justify-end">{footer}</div>}
      </div>
    </div>
  );
}

// ───────────────────────── Tabs ─────────────────────────
export function Tabs<T extends string>({ value, onChange, items, className }: { value: T; onChange: (v: T) => void; items: Array<{ value: T; label: ReactNode; count?: number; alert?: boolean }>; className?: string }) {
  return (
    <div role="tablist" className={cn('scroll-thin -mx-1 flex gap-1 overflow-x-auto border-b border-line px-1', className)}>
      {items.map((it) => (
        <button
          key={it.value}
          role="tab"
          aria-selected={value === it.value}
          onClick={() => onChange(it.value)}
          className={cn('relative flex shrink-0 items-center gap-1.5 px-3 py-2.5 text-sm font-medium transition-colors', value === it.value ? 'text-ink after:absolute after:inset-x-2 after:-bottom-px after:h-0.5 after:rounded-full after:bg-brand' : 'text-ink-muted hover:text-ink')}
        >
          {it.label}
          {it.count !== undefined && <span className={cn('rounded-full px-1.5 text-[11px]', it.alert ? 'bg-red-500 text-white' : 'bg-ink/5 text-ink-muted')}>{it.count}</span>}
        </button>
      ))}
    </div>
  );
}

// ───────────────────────── Data display ─────────────────────────
export function Stat({ label, value, hint, tone, href, icon }: { label: ReactNode; value: ReactNode; hint?: ReactNode; tone?: 'default' | 'alert' | 'ok'; href?: string; icon?: ReactNode }) {
  const inner = (
    <div className={cn('group h-full rounded-2xl border bg-surface p-4 shadow-card transition', tone === 'alert' ? 'border-red-200 dark:border-red-500/30' : 'border-line', href && 'hover:border-brand/40 hover:shadow-md')}>
      <div className="flex items-center justify-between text-[13px] text-ink-muted">
        <span className="flex items-center gap-1.5">
          {icon}
          {label}
        </span>
        {href && <ChevronRight className="h-4 w-4 opacity-0 transition group-hover:opacity-100" />}
      </div>
      <div className={cn('mt-2 text-2xl font-bold tabular tracking-tight', tone === 'alert' ? 'text-red-600' : tone === 'ok' ? 'text-emerald-600' : 'text-ink')}>{value}</div>
      {hint && <div className="mt-1 text-xs text-ink-muted">{hint}</div>}
    </div>
  );
  return href ? <a href={href}>{inner}</a> : inner;
}

export function KeyValue({ items, className, cols = 2 }: { items: Array<{ label: ReactNode; value: ReactNode; hide?: boolean }>; className?: string; cols?: 1 | 2 | 3 }) {
  return (
    <dl className={cn('grid gap-x-6 gap-y-3', cols === 1 ? 'grid-cols-1' : cols === 3 ? 'grid-cols-2 sm:grid-cols-3' : 'grid-cols-1 sm:grid-cols-2', className)}>
      {items
        .filter((i) => !i.hide)
        .map((i, idx) => (
          <div key={idx} className="min-w-0">
            <dt className="text-xs text-ink-muted">{i.label}</dt>
            <dd className="mt-0.5 break-words text-sm text-ink">{i.value ?? '—'}</dd>
          </div>
        ))}
    </dl>
  );
}

export function Table({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className={cn('scroll-thin -mx-px overflow-x-auto', className)}>
      <table className="w-full min-w-[560px] border-collapse text-sm">{children}</table>
    </div>
  );
}
export function Th({ children, className }: { children?: ReactNode; className?: string }) {
  return <th className={cn('border-b border-line bg-surface-sunken/60 px-4 py-2.5 text-left text-xs font-medium text-ink-muted first:rounded-tl-lg last:rounded-tr-lg', className)}>{children}</th>;
}
export function Td({ children, className, ...p }: { children?: ReactNode; className?: string } & HTMLAttributes<HTMLTableCellElement>) {
  return (
    <td className={cn('border-b border-line/70 px-4 py-3 align-top text-ink', className)} {...p}>
      {children}
    </td>
  );
}

export function Progress({ value, className, tone = 'brand' }: { value: number; className?: string; tone?: 'brand' | 'ok' | 'warn' }) {
  return (
    <div className={cn('h-1.5 w-full overflow-hidden rounded-full bg-line/70', className)} role="progressbar" aria-valuenow={Math.round(value)} aria-valuemin={0} aria-valuemax={100}>
      <div className={cn('h-full rounded-full transition-all', tone === 'ok' ? 'bg-emerald-500' : tone === 'warn' ? 'bg-amber-500' : 'bg-brand')} style={{ width: `${Math.max(0, Math.min(100, value))}%` }} />
    </div>
  );
}

export function Avatar({ name, className }: { name: string; className?: string }) {
  const t = name.trim();
  const ini = !t ? '?' : /[가-힣]/.test(t) ? t.slice(0, 1) : t.split(/\s+/).map((w) => w[0]).slice(0, 2).join('').toUpperCase();
  return <span className={cn('inline-flex h-8 w-8 items-center justify-center rounded-full bg-brand/10 text-xs font-semibold text-brand', className)}>{ini}</span>;
}

export function Section({ title, description, children, action, className }: { title?: ReactNode; description?: ReactNode; children: ReactNode; action?: ReactNode; className?: string }) {
  return (
    <section className={cn('space-y-3', className)}>
      {(title || action) && (
        <div className="flex items-end justify-between gap-3">
          <div>
            {title && <h2 className="text-[15px] font-semibold text-ink">{title}</h2>}
            {description && <p className="text-[13px] text-ink-muted">{description}</p>}
          </div>
          {action}
        </div>
      )}
      {children}
    </section>
  );
}
