'use client';

import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useRef, useState, type DragEvent } from 'react';
import { ChevronDown, ImagePlus, Link2, Search, SlidersHorizontal, X } from 'lucide-react';
import { api, errorMessage } from '@/lib/api';
import { cn } from '@/lib/utils';
import { useMe, useSite } from '../providers';
import { Alert, Button, Field, Input, Select, Switch, Textarea } from '../ui';

interface Preview {
  file: File;
  url: string;
}

const MAX_IMAGES = 5;
const MAX_MB = 20;

export function SearchBox({ compact = false, autoFocus = false }: { compact?: boolean; autoFocus?: boolean }) {
  const router = useRouter();
  const site = useSite();
  const me = useMe();
  const [images, setImages] = useState<Preview[]>([]);
  const [text, setText] = useState('');
  const [details, setDetails] = useState(false);
  const [drag, setDrag] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [opts, setOpts] = useState({ quantity: '', targetLandedPriceKrw: '', targetSellingPriceKrw: '', desiredLeadTimeDays: '', oem: false, logoPrint: false, packageChange: false, certificationNeeded: 'UNSURE', qualityLevel: '', colors: '', notes: '' });
  const fileInput = useRef<HTMLInputElement>(null);

  const addFiles = useCallback((files: FileList | File[]) => {
    setError(null);
    const list = [...files].filter((f) => f.type.startsWith('image/'));
    const tooBig = list.find((f) => f.size > MAX_MB * 1024 * 1024);
    if (tooBig) return setError(`사진은 ${MAX_MB}MB 이하만 올릴 수 있습니다.`);
    setImages((prev) => [...prev, ...list.map((file) => ({ file, url: URL.createObjectURL(file) }))].slice(0, MAX_IMAGES));
  }, []);

  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      const files = [...(e.clipboardData?.files ?? [])];
      if (files.some((f) => f.type.startsWith('image/'))) addFiles(files);
    };
    window.addEventListener('paste', onPaste);
    return () => window.removeEventListener('paste', onPaste);
  }, [addFiles]);

  useEffect(() => () => images.forEach((i) => URL.revokeObjectURL(i.url)), [images]);

  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setDrag(false);
    addFiles(e.dataTransfer.files);
  };

  const isUrl = /^https?:\/\//i.test(text.trim());
  const anonymousBlocked = !me.data?.user && site?.search.anonymousSearchEnabled === false;

  const submit = async () => {
    if (!images.length && !text.trim()) return setError('사진을 올리거나 제품명·링크를 입력해 주세요.');
    if (anonymousBlocked) return router.push('/login?next=/search');
    setBusy(true);
    setError(null);
    try {
      const fd = new FormData();
      for (const i of images) fd.append('images', i.file, i.file.name);
      if (isUrl) fd.append('url', text.trim());
      else if (text.trim().length > 60) fd.append('description', text.trim());
      else fd.append('query', text.trim());
      if (opts.quantity) fd.append('quantity', opts.quantity);
      if (opts.targetLandedPriceKrw) fd.append('targetLandedPriceKrw', opts.targetLandedPriceKrw);
      if (opts.targetSellingPriceKrw) fd.append('targetSellingPriceKrw', opts.targetSellingPriceKrw);
      if (opts.desiredLeadTimeDays) fd.append('desiredLeadTimeDays', opts.desiredLeadTimeDays);
      fd.append(
        'options',
        JSON.stringify({ oem: opts.oem, logoPrint: opts.logoPrint, packageChange: opts.packageChange, certificationNeeded: opts.certificationNeeded, qualityLevel: opts.qualityLevel || undefined, colors: opts.colors || undefined, notes: opts.notes || undefined }),
      );
      const r = await api.upload<{ requestId: string; projectId: string | null; accessToken: string | null }>('/sourcing/requests', fd);
      if (r.accessToken) {
        try {
          const saved = JSON.parse(localStorage.getItem('anonRequests') ?? '[]') as Array<{ id: string; token: string }>;
          localStorage.setItem('anonRequests', JSON.stringify([{ id: r.requestId, token: r.accessToken }, ...saved].slice(0, 20)));
        } catch {
          /* storage disabled */
        }
      }
      router.push(`/r/${r.requestId}${r.accessToken ? `?t=${encodeURIComponent(r.accessToken)}` : ''}`);
    } catch (e) {
      setError(errorMessage(e));
      setBusy(false);
    }
  };

  return (
    <div className={cn('w-full', !compact && 'mx-auto max-w-3xl')}>
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setDrag(true);
        }}
        onDragLeave={() => setDrag(false)}
        onDrop={onDrop}
        className={cn('rounded-3xl border bg-surface p-3 shadow-pop transition sm:p-4', drag ? 'border-brand ring-4 ring-brand/15' : 'border-line')}
      >
        {images.length > 0 && (
          <div className="mb-3 flex flex-wrap gap-2">
            {images.map((i, idx) => (
              <div key={i.url} className="group relative h-20 w-20 overflow-hidden rounded-xl border border-line bg-surface-sunken">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={i.url} alt={`첨부 사진 ${idx + 1}`} className="h-full w-full object-cover" />
                <button onClick={() => setImages((p) => p.filter((_, x) => x !== idx))} className="absolute right-1 top-1 rounded-full bg-black/60 p-0.5 text-white opacity-90 hover:opacity-100" aria-label="사진 삭제">
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
            ))}
            {images.length < MAX_IMAGES && (
              <button onClick={() => fileInput.current?.click()} className="flex h-20 w-20 items-center justify-center rounded-xl border border-dashed border-line text-ink-muted hover:border-brand hover:text-brand" aria-label="사진 추가">
                <ImagePlus className="h-5 w-5" />
              </button>
            )}
          </div>
        )}
        <div className="flex items-end gap-2">
          <button onClick={() => fileInput.current?.click()} className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-brand/10 text-brand transition hover:bg-brand/15" aria-label="제품 사진 올리기" title="사진 올리기 (끌어다 놓기·붙여넣기 가능)">
            <ImagePlus className="h-5 w-5" />
          </button>
          <div className="relative min-w-0 flex-1">
            {isUrl && <Link2 className="pointer-events-none absolute left-3 top-3.5 h-4 w-4 text-brand" />}
            <textarea
              value={text}
              autoFocus={autoFocus}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  void submit();
                }
              }}
              rows={1}
              placeholder={images.length ? '제품명이나 요구사항을 덧붙이면 더 정확해집니다 (선택)' : '제품 사진을 올리거나, 제품명 · 상품 링크를 입력하세요'}
              className={cn('max-h-40 min-h-[48px] w-full resize-none rounded-2xl border-0 bg-transparent px-3 py-3 text-[15px] text-ink placeholder:text-ink-muted focus:outline-none focus:ring-0', isUrl && 'pl-9')}
              aria-label="제품명, 설명 또는 상품 링크"
            />
          </div>
          <Button size="lg" onClick={submit} loading={busy} className="h-12 rounded-2xl px-5" icon={!busy ? <Search className="h-4 w-4" /> : undefined}>
            <span className="hidden sm:inline">찾아보기</span>
          </Button>
        </div>
        <input ref={fileInput} type="file" accept="image/jpeg,image/png,image/webp,image/avif,image/gif" multiple className="hidden" onChange={(e) => e.target.files && addFiles(e.target.files)} />
        <div className="mt-2 flex items-center justify-between px-1">
          <p className="text-xs text-ink-muted">사진은 최대 {MAX_IMAGES}장 · 끌어다 놓거나 붙여넣기(Ctrl+V)도 됩니다</p>
          <button onClick={() => setDetails((d) => !d)} className="flex items-center gap-1 rounded-lg px-2 py-1 text-xs font-medium text-ink-soft hover:bg-ink/5" aria-expanded={details}>
            <SlidersHorizontal className="h-3.5 w-3.5" /> 조건 추가
            <ChevronDown className={cn('h-3.5 w-3.5 transition', details && 'rotate-180')} />
          </button>
        </div>
        {details && (
          <div className="mt-3 grid gap-4 border-t border-line px-1 pt-4 sm:grid-cols-2">
            <Field label="희망 수량">
              <Input inputMode="numeric" value={opts.quantity} onChange={(e) => setOpts({ ...opts, quantity: e.target.value.replace(/\D/g, '') })} placeholder="예: 500" />
            </Field>
            <Field label="목표 한국 도착가 (개당, 원)">
              <Input inputMode="numeric" value={opts.targetLandedPriceKrw} onChange={(e) => setOpts({ ...opts, targetLandedPriceKrw: e.target.value.replace(/\D/g, '') })} placeholder="예: 6000" />
            </Field>
            <Field label="목표 판매가 (개당, 원)">
              <Input inputMode="numeric" value={opts.targetSellingPriceKrw} onChange={(e) => setOpts({ ...opts, targetSellingPriceKrw: e.target.value.replace(/\D/g, '') })} />
            </Field>
            <Field label="원하는 납기 (일)">
              <Input inputMode="numeric" value={opts.desiredLeadTimeDays} onChange={(e) => setOpts({ ...opts, desiredLeadTimeDays: e.target.value.replace(/\D/g, '') })} placeholder="예: 30" />
            </Field>
            <Field label="인증 필요 여부">
              <Select value={opts.certificationNeeded} onChange={(e) => setOpts({ ...opts, certificationNeeded: e.target.value })}>
                <option value="UNSURE">잘 모르겠어요</option>
                <option value="YES">필요해요</option>
                <option value="NO">필요 없어요</option>
              </Select>
            </Field>
            <Field label="원하는 품질 수준">
              <Select value={opts.qualityLevel} onChange={(e) => setOpts({ ...opts, qualityLevel: e.target.value })}>
                <option value="">상관없음</option>
                <option value="ECONOMY">가성비</option>
                <option value="STANDARD">표준</option>
                <option value="PREMIUM">고품질</option>
              </Select>
            </Field>
            <div className="flex flex-wrap gap-x-6 gap-y-3 sm:col-span-2">
              <Switch checked={opts.oem} onChange={(v) => setOpts({ ...opts, oem: v })} label="OEM 생산" />
              <Switch checked={opts.logoPrint} onChange={(v) => setOpts({ ...opts, logoPrint: v })} label="로고 인쇄" />
              <Switch checked={opts.packageChange} onChange={(v) => setOpts({ ...opts, packageChange: v })} label="패키지 변경" />
            </div>
            <Field label="색상 · 사이즈" className="sm:col-span-2">
              <Input value={opts.colors} onChange={(e) => setOpts({ ...opts, colors: e.target.value })} placeholder="예: 화이트, 핑크 / 소형" />
            </Field>
            <Field label="기타 요구사항" className="sm:col-span-2">
              <Textarea value={opts.notes} onChange={(e) => setOpts({ ...opts, notes: e.target.value })} placeholder="원하는 사양, 참고 사항 등을 적어 주세요." />
            </Field>
          </div>
        )}
      </div>
      {error && (
        <Alert tone="danger" className="mt-3">
          {error}
        </Alert>
      )}
      {anonymousBlocked && <p className="mt-3 text-center text-xs text-ink-muted">검색하려면 로그인이 필요합니다.</p>}
    </div>
  );
}
