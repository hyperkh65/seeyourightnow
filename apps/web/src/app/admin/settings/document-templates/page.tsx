'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Eye } from 'lucide-react';
import { api } from '@/lib/api';
import { formatDate } from '@/lib/utils';
import { useToast } from '@/components/providers';
import {
  Alert,
  Badge,
  Button,
  Card,
  CardBody,
  CardHeader,
  Checkbox,
  EmptyState,
  ErrorState,
  Field,
  LoadingBlock,
  PageHeader,
  Textarea,
} from '@/components/ui';
import { SettingsBack } from '../_components/editor';

interface Version {
  id: string;
  version: number;
  status: string;
  createdAt: string;
  requiresLegalReview: boolean;
}
interface Tpl {
  id: string;
  kind: string;
  locale: string;
  name: string;
  versions: Version[];
  published: null | { id: string; version: number; html: string; css: string; requiresLegalReview: boolean };
}

export default function DocumentTemplates() {
  const qc = useQueryClient();
  const toast = useToast();
  const q = useQuery({
    queryKey: ['doc-templates'],
    queryFn: () => api.get<{ items: Tpl[] }>('/admin/document-templates'),
  });
  const [sel, setSel] = useState<string | null>(null);
  const [draft, setDraft] = useState<{ html: string; css: string; legal: boolean } | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const tpl = q.data?.items.find((t) => t.id === (sel ?? q.data?.items[0]?.id));
  const value =
    draft ??
    (tpl?.published
      ? { html: tpl.published.html, css: tpl.published.css, legal: tpl.published.requiresLegalReview }
      : { html: '', css: '', legal: false });
  const save = useMutation({
    mutationFn: (publish: boolean) =>
      api.post(`/admin/document-templates/${tpl!.id}/versions`, {
        html: value.html,
        css: value.css,
        requiresLegalReview: value.legal,
        publish,
      }),
    onSuccess: (_r, publish) => {
      toast.ok(
        publish ? '새 양식을 게시했습니다. 이미 발행된 문서는 바뀌지 않습니다.' : '초안으로 저장했습니다.',
      );
      setDraft(null);
      void qc.invalidateQueries({ queryKey: ['doc-templates'] });
    },
    onError: toast.error,
  });
  const doPreview = useMutation({
    mutationFn: () =>
      api.post<string>('/admin/document-templates/preview', { html: value.html, css: value.css }),
    onSuccess: (h) => setPreview(h),
    onError: toast.error,
  });
  return (
    <>
      <PageHeader
        back={<SettingsBack />}
        title="문서 양식"
        description="견적서·계약서·인보이스 PDF 양식입니다. 회사 정보, 로고, 계좌는 설정에서 자동으로 채워집니다."
      />
      {q.isLoading ? (
        <Card className="p-5">
          <LoadingBlock rows={6} />
        </Card>
      ) : q.error ? (
        <ErrorState error={q.error} />
      ) : !q.data?.items.length ? (
        <EmptyState title="양식이 없습니다" />
      ) : (
        <div className="grid gap-6 lg:grid-cols-[240px_1fr]">
          <nav className="flex gap-1 overflow-x-auto lg:flex-col" aria-label="양식">
            {q.data.items.map((t) => (
              <button
                key={t.id}
                type="button"
                onClick={() => {
                  setSel(t.id);
                  setDraft(null);
                  setPreview(null);
                }}
                className={`whitespace-nowrap rounded-lg px-3 py-2 text-left text-sm ${tpl?.id === t.id ? 'bg-brand/10 font-semibold text-brand' : 'text-ink-soft hover:bg-surface-sunken'}`}
              >
                {t.name} <span className="text-xs text-ink-muted">{t.locale}</span>
              </button>
            ))}
          </nav>
          {tpl && (
            <div className="space-y-6">
              <Alert>
                양식은 Handlebars 문법을 사용합니다 (예: <code>{'{{number}}'}</code>,{' '}
                <code>{'{{#each items}}'}</code>, <code>{'{{money total currency}}'}</code>). 값은 자동으로
                이스케이프되고, 스크립트와 외부 리소스는 PDF 생성 시 차단됩니다.
              </Alert>
              <Card>
                <CardHeader
                  title={tpl.name}
                  description={tpl.published ? `게시 v${tpl.published.version}` : '게시된 버전 없음'}
                />
                <CardBody className="space-y-3">
                  <Field label="HTML">
                    <Textarea
                      rows={16}
                      className="font-mono text-xs"
                      value={value.html}
                      onChange={(e) => setDraft({ ...value, html: e.target.value })}
                    />
                  </Field>
                  <Field label="CSS (선택)">
                    <Textarea
                      rows={5}
                      className="font-mono text-xs"
                      value={value.css}
                      onChange={(e) => setDraft({ ...value, css: e.target.value })}
                    />
                  </Field>
                  {tpl.kind === 'CONTRACT' && (
                    <Checkbox
                      checked={value.legal}
                      onChange={(x) => setDraft({ ...value, legal: x })}
                      label="이 양식으로 만든 계약은 법률 검토 필요"
                    />
                  )}
                  <div className="flex flex-wrap justify-end gap-2">
                    <Button
                      variant="secondary"
                      icon={<Eye className="h-4 w-4" />}
                      loading={doPreview.isPending}
                      onClick={() => doPreview.mutate()}
                    >
                      미리보기
                    </Button>
                    <Button
                      variant="secondary"
                      disabled={!draft}
                      loading={save.isPending}
                      onClick={() => save.mutate(false)}
                    >
                      초안 저장
                    </Button>
                    <Button disabled={!draft} loading={save.isPending} onClick={() => save.mutate(true)}>
                      게시
                    </Button>
                  </div>
                </CardBody>
              </Card>
              {preview && (
                <Card>
                  <CardHeader title="미리보기 (샘플 데이터)" />
                  <iframe
                    title="문서 미리보기"
                    sandbox=""
                    srcDoc={preview}
                    className="h-[720px] w-full rounded-b-2xl bg-white"
                  />
                </Card>
              )}
              <Card>
                <CardHeader title="버전 기록" />
                <CardBody className="space-y-1.5 text-sm">
                  {tpl.versions.map((v) => (
                    <div key={v.id} className="flex items-center gap-2">
                      v{v.version}
                      <Badge tone={v.status === 'PUBLISHED' ? 'ok' : 'neutral'}>
                        {v.status === 'PUBLISHED' ? '게시' : v.status === 'DRAFT' ? '초안' : '보관'}
                      </Badge>
                      <span className="text-xs text-ink-muted">{formatDate(v.createdAt, true)}</span>
                    </div>
                  ))}
                </CardBody>
              </Card>
            </div>
          )}
        </div>
      )}
    </>
  );
}
