'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ChevronLeft, Eye, ImageUp, Rocket, Save, Undo2 } from 'lucide-react';
import { api } from '@/lib/api';
import { formatDate } from '@/lib/utils';
import { assetUrl } from '@/lib/theme';
import { useCan, useToast } from '@/components/providers';
import { Alert, Badge, Button, Card, CardBody, ErrorState, LoadingBlock, PageHeader } from '@/components/ui';

export interface SectionState<T> {
  section: string;
  published: T;
  publishedVersion: number;
  publishedAt: string | null;
  draft: T | null;
  draftVersion: number | null;
  previewToken: string | null;
  history: Array<{ version: number; status: string; createdAt: string; publishedAt: string | null }>;
}

export const PREVIEWABLE = ['brand', 'homepage', 'footer', 'social'];

export function SettingsBack() {
  return (
    <Link
      href="/admin/settings"
      className="mb-2 inline-flex items-center gap-1 text-sm text-ink-muted hover:text-ink"
    >
      <ChevronLeft className="h-4 w-4" />
      설정
    </Link>
  );
}

/**
 * Generic Draft → Preview → Publish editor for a versioned settings section.
 * The form renders `value` and calls `onChange`; saving writes a server-validated draft.
 */
export function SectionEditor<T>({
  section,
  title,
  description,
  children,
  validate,
}: {
  section: string;
  title: string;
  description?: string;
  children: (value: T, onChange: (v: T) => void, readOnly: boolean) => ReactNode;
  validate?: (v: T) => string | null;
}) {
  const qc = useQueryClient();
  const toast = useToast();
  const can = useCan();
  const router = useRouter();
  const writable = can('tenant.settings.write');
  const q = useQuery({
    queryKey: ['settings', section],
    queryFn: () => api.get<SectionState<T>>(`/admin/settings/${section}`),
  });
  const [value, setValue] = useState<T | null>(null);
  const [dirty, setDirty] = useState(false);
  useEffect(() => {
    if (q.data && !dirty) setValue(q.data.draft ?? q.data.published);
  }, [q.data, dirty]);
  const refresh = () => void qc.invalidateQueries({ queryKey: ['settings', section] });
  const problem = value && validate ? validate(value) : null;
  const saveDraft = async () =>
    api.put<{ version: number; previewToken?: string | null }>(`/admin/settings/${section}/draft`, {
      data: value,
    });
  const save = useMutation({
    mutationFn: saveDraft,
    onSuccess: () => {
      toast.ok('초안을 저장했습니다. 게시하기 전에는 사이트에 반영되지 않습니다.');
      setDirty(false);
      refresh();
    },
    onError: toast.error,
  });
  const preview = useMutation({
    mutationFn: async () => {
      if (dirty) await saveDraft();
      return api.get<SectionState<T>>(`/admin/settings/${section}`);
    },
    onSuccess: (s) => {
      setDirty(false);
      refresh();
      if (s.previewToken) window.open(`/preview?token=${s.previewToken}&to=/`, '_blank', 'noopener');
      else toast.error('미리보기 토큰을 만들지 못했습니다.');
    },
    onError: toast.error,
  });
  const publish = useMutation({
    mutationFn: async () => {
      await saveDraft();
      return api.post<{ version: number }>(`/admin/settings/${section}/publish`, {});
    },
    onSuccess: (r) => {
      toast.ok(`v${r.version}을 게시했습니다.`);
      setDirty(false);
      refresh();
      router.refresh();
    },
    onError: toast.error,
  });
  const discard = useMutation({
    mutationFn: () => api.delete(`/admin/settings/${section}/draft`),
    onSuccess: () => {
      toast.ok('초안을 삭제했습니다.');
      setDirty(false);
      refresh();
    },
    onError: toast.error,
  });
  if (q.isLoading || (q.data && value === null))
    return (
      <>
        <PageHeader back={<SettingsBack />} title={title} />
        <Card className="p-5">
          <LoadingBlock rows={8} />
        </Card>
      </>
    );
  if (q.error || !q.data || value === null) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  const s = q.data;
  const hasDraft = s.draftVersion !== null;
  return (
    <>
      <PageHeader
        back={<SettingsBack />}
        title={title}
        description={description}
        actions={
          writable && (
            <div className="flex flex-wrap gap-2">
              {hasDraft && (
                <Button
                  variant="ghost"
                  icon={<Undo2 className="h-4 w-4" />}
                  loading={discard.isPending}
                  onClick={() => discard.mutate()}
                >
                  초안 삭제
                </Button>
              )}
              {PREVIEWABLE.includes(section) && (
                <Button
                  variant="secondary"
                  icon={<Eye className="h-4 w-4" />}
                  disabled={!!problem}
                  loading={preview.isPending}
                  onClick={() => preview.mutate()}
                >
                  미리보기
                </Button>
              )}
              <Button
                variant="secondary"
                icon={<Save className="h-4 w-4" />}
                disabled={!dirty || !!problem}
                loading={save.isPending}
                onClick={() => save.mutate()}
              >
                초안 저장
              </Button>
              <Button
                icon={<Rocket className="h-4 w-4" />}
                disabled={(!dirty && !hasDraft) || !!problem}
                loading={publish.isPending}
                onClick={() => publish.mutate()}
              >
                게시
              </Button>
            </div>
          )
        }
      />
      <div className="mb-4 flex flex-wrap items-center gap-2 text-xs text-ink-muted">
        <Badge tone="ok">게시 v{s.publishedVersion || '기본값'}</Badge>
        {s.publishedAt && <span>{formatDate(s.publishedAt, true)} 게시</span>}
        {hasDraft && <Badge tone="warn">초안 v{s.draftVersion} 편집 중</Badge>}
        {dirty && <Badge tone="info">저장하지 않은 변경</Badge>}
      </div>
      {problem && (
        <Alert tone="warn" className="mb-4">
          {problem}
        </Alert>
      )}
      {children(
        value,
        (v) => {
          setValue(v);
          setDirty(true);
        },
        !writable,
      )}
      {s.history.length > 1 && (
        <Card className="mt-6">
          <CardBody className="text-xs text-ink-muted">
            <p className="mb-2 font-medium text-ink-soft">버전 기록</p>
            <ul className="space-y-1">
              {s.history.map((h) => (
                <li key={h.version}>
                  v{h.version} · {h.status === 'PUBLISHED' ? '게시' : h.status === 'DRAFT' ? '초안' : '보관'}{' '}
                  · {formatDate(h.publishedAt ?? h.createdAt, true)}
                </li>
              ))}
            </ul>
          </CardBody>
        </Card>
      )}
    </>
  );
}

/** Uploads a brand asset (logo, favicon, images). The server checks magic bytes and the allowed MIME list. */
export function AssetField({
  label,
  hint,
  value,
  onChange,
  disabled,
}: {
  label: string;
  hint?: string;
  value: string | null;
  onChange: (id: string | null) => void;
  disabled?: boolean;
}) {
  const toast = useToast();
  const ref = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const url = assetUrl(value);
  const upload = async (file: File) => {
    setBusy(true);
    try {
      const fd = new FormData();
      fd.append('purpose', 'BRAND_ASSET');
      fd.append('file', file);
      const r = await api.upload<{ id: string }>('/files', fd);
      onChange(r.id);
    } catch (e) {
      toast.error(e);
    } finally {
      setBusy(false);
      if (ref.current) ref.current.value = '';
    }
  };
  return (
    <div className="space-y-1.5">
      <p className="text-[13px] font-medium text-ink-soft">{label}</p>
      <div className="flex items-center gap-3">
        <div className="flex h-14 w-24 items-center justify-center overflow-hidden rounded-lg border border-line bg-surface-sunken">
          {url ? (
            <img src={url} alt="" className="max-h-full max-w-full object-contain" />
          ) : (
            <ImageUp className="h-5 w-5 text-ink-muted" />
          )}
        </div>
        <div className="flex gap-2">
          <Button
            size="sm"
            variant="secondary"
            disabled={disabled}
            loading={busy}
            onClick={() => ref.current?.click()}
          >
            {value ? '변경' : '업로드'}
          </Button>
          {value && (
            <Button size="sm" variant="ghost" disabled={disabled} onClick={() => onChange(null)}>
              삭제
            </Button>
          )}
        </div>
        <input
          ref={ref}
          type="file"
          accept="image/png,image/jpeg,image/webp,image/gif,image/x-icon"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void upload(f);
          }}
        />
      </div>
      {hint && <p className="text-xs text-ink-muted">{hint}</p>}
    </div>
  );
}
