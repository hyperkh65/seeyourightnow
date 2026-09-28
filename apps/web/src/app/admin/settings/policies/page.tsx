'use client';

import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { formatDate } from '@/lib/utils';
import { useCan, useToast } from '@/components/providers';
import {
  Alert,
  Badge,
  Button,
  Card,
  CardBody,
  CardHeader,
  ErrorState,
  Field,
  Input,
  LoadingBlock,
  PageHeader,
  Textarea,
} from '@/components/ui';
import { SettingsBack } from '../_components/editor';

interface Policy {
  id: string;
  type: string;
  version: number;
  title: string;
  body: string;
  status: string;
  publishedAt: string | null;
  createdAt: string;
}
const TYPES: Record<string, string> = {
  TERMS: '이용약관',
  PRIVACY: '개인정보처리방침',
  SOURCING_TERMS: '소싱 서비스 약관',
  QUOTATION_NOTICE: '견적 안내',
  CANCELLATION: '취소 규정',
  REFUND: '환불 규정',
  SHIPPING: '배송 안내',
};

export default function Policies() {
  const qc = useQueryClient();
  const toast = useToast();
  const can = useCan();
  const q = useQuery({
    queryKey: ['policies'],
    queryFn: () => api.get<{ items: Policy[] }>('/admin/policies'),
  });
  const [type, setType] = useState('TERMS');
  const [edit, setEdit] = useState<{ title: string; body: string } | null>(null);
  const versions = useMemo(
    () => (q.data?.items ?? []).filter((p) => p.type === type).sort((a, b) => b.version - a.version),
    [q.data, type],
  );
  const current = versions.find((p) => p.status === 'PUBLISHED');
  const save = useMutation({
    mutationFn: (publish: boolean) =>
      api.post('/admin/policies', { type, title: edit!.title, body: edit!.body, publish }),
    onSuccess: (_r, publish) => {
      toast.ok(
        publish ? '새 버전을 게시했습니다. 기존 동의 기록은 그대로 보존됩니다.' : '초안으로 저장했습니다.',
      );
      setEdit(null);
      void qc.invalidateQueries({ queryKey: ['policies'] });
    },
    onError: toast.error,
  });
  const writable = can('tenant.settings.write');
  return (
    <>
      <PageHeader
        back={<SettingsBack />}
        title="약관·정책"
        description="약관은 버전별로 보관되며, 고객이 동의한 버전이 함께 기록됩니다."
      />
      <Alert tone="warn" className="mb-6">
        기본 문구는 예시입니다. 실제 서비스 전에 법률 검토를 받은 내용으로 바꿔 주세요.
      </Alert>
      <div className="grid gap-6 lg:grid-cols-[220px_1fr]">
        <nav className="flex gap-1 overflow-x-auto lg:flex-col" aria-label="정책 종류">
          {Object.entries(TYPES).map(([k, l]) => (
            <button
              key={k}
              type="button"
              onClick={() => {
                setType(k);
                setEdit(null);
              }}
              className={`whitespace-nowrap rounded-lg px-3 py-2 text-left text-sm ${type === k ? 'bg-brand/10 font-semibold text-brand' : 'text-ink-soft hover:bg-surface-sunken'}`}
            >
              {l}
            </button>
          ))}
        </nav>
        {q.isLoading ? (
          <Card className="p-5">
            <LoadingBlock rows={6} />
          </Card>
        ) : q.error ? (
          <ErrorState error={q.error} />
        ) : (
          <div className="space-y-6">
            <Card>
              <CardHeader
                title={current?.title ?? TYPES[type]}
                description={
                  current
                    ? `v${current.version} · ${formatDate(current.publishedAt)} 게시`
                    : '게시된 버전이 없습니다'
                }
                action={
                  writable &&
                  !edit && (
                    <Button
                      size="sm"
                      onClick={() =>
                        setEdit({ title: current?.title ?? TYPES[type]!, body: current?.body ?? '' })
                      }
                    >
                      새 버전 작성
                    </Button>
                  )
                }
              />
              <CardBody>
                {edit ? (
                  <div className="space-y-3">
                    <Field label="제목">
                      <Input
                        value={edit.title}
                        onChange={(e) => setEdit({ ...edit, title: e.target.value })}
                      />
                    </Field>
                    <Field
                      label="내용"
                      hint="마크다운 없이 일반 텍스트로 작성합니다. 줄바꿈은 그대로 표시됩니다."
                    >
                      <Textarea
                        rows={18}
                        value={edit.body}
                        onChange={(e) => setEdit({ ...edit, body: e.target.value })}
                      />
                    </Field>
                    <div className="flex justify-end gap-2">
                      <Button variant="ghost" onClick={() => setEdit(null)}>
                        취소
                      </Button>
                      <Button
                        variant="secondary"
                        loading={save.isPending}
                        disabled={!edit.body.trim()}
                        onClick={() => save.mutate(false)}
                      >
                        초안 저장
                      </Button>
                      <Button
                        loading={save.isPending}
                        disabled={!edit.body.trim()}
                        onClick={() => save.mutate(true)}
                      >
                        게시
                      </Button>
                    </div>
                  </div>
                ) : (
                  <p className="max-h-[480px] overflow-y-auto whitespace-pre-wrap text-sm leading-relaxed text-ink-soft">
                    {current?.body ?? '내용이 없습니다.'}
                  </p>
                )}
              </CardBody>
            </Card>
            <Card>
              <CardHeader title="버전 기록" />
              <CardBody className="space-y-1.5 text-sm">
                {versions.length === 0 ? (
                  <p className="text-ink-muted">기록이 없습니다.</p>
                ) : (
                  versions.map((p) => (
                    <div key={p.id} className="flex items-center gap-2">
                      v{p.version}
                      <Badge tone={p.status === 'PUBLISHED' ? 'ok' : 'neutral'}>
                        {p.status === 'PUBLISHED' ? '게시' : '초안'}
                      </Badge>
                      <span className="text-xs text-ink-muted">
                        {formatDate(p.publishedAt ?? p.createdAt, true)}
                      </span>
                    </div>
                  ))
                )}
              </CardBody>
            </Card>
          </div>
        )}
      </div>
    </>
  );
}
