'use client';

import { useMemo, useState } from 'react';
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
  ErrorState,
  Field,
  Input,
  LoadingBlock,
  PageHeader,
  Switch,
  Textarea,
} from '@/components/ui';
import { SettingsBack } from '../_components/editor';

interface Tpl {
  id: string;
  trigger: string;
  subject: string;
  bodyHtml: string;
  enabled: boolean;
  version: number;
  createdAt: string;
}
const TRIGGER: Record<string, string> = {
  SOURCING_RECEIVED: '소싱 요청 접수',
  ANALYSIS_COMPLETED: '분석 완료',
  QUOTE_ISSUED: '견적서 발송',
  QUOTE_REMINDER: '견적 확인 요청',
  QUOTE_APPROVED: '견적 승인',
  CONTRACT_READY: '계약서 발송',
  CONTRACT_COMPLETED: '계약 체결',
  PI_ISSUED: 'PI 발행',
  PAYMENT_RECEIVED: '입금 확인',
  PRODUCTION_STARTED: '생산 시작',
  PRODUCTION_DELAY: '생산 지연',
  INSPECTION_COMPLETED: '검품 완료',
  SHIPMENT_BOOKED: '선적 예약',
  VESSEL_DEPARTED: '출항',
  ETA_CHANGED: '도착 예정일 변경',
  ARRIVED: '입항',
  CUSTOMS_COMPLETED: '통관 완료',
  DELIVERY_STARTED: '배송 시작',
  DELIVERED: '배송 완료',
};
const VARS = [
  'siteName',
  'recipientName',
  'projectCode',
  'productName',
  'quoteNumber',
  'total',
  'validUntil',
  'eta',
  'link',
];

export default function EmailTemplates() {
  const qc = useQueryClient();
  const toast = useToast();
  const q = useQuery({
    queryKey: ['email-templates'],
    queryFn: () => api.get<{ triggers: string[]; items: Tpl[] }>('/admin/email-templates'),
  });
  const [trigger, setTrigger] = useState('QUOTE_ISSUED');
  const [draft, setDraft] = useState<{ subject: string; bodyHtml: string; enabled: boolean } | null>(null);
  const [preview, setPreview] = useState<{ subject: string; html: string } | null>(null);
  const latest = useMemo(() => {
    const m = new Map<string, Tpl>();
    for (const t of q.data?.items ?? [])
      if (!m.has(t.trigger) || m.get(t.trigger)!.version < t.version) m.set(t.trigger, t);
    return m;
  }, [q.data]);
  const cur = latest.get(trigger);
  const value =
    draft ??
    (cur
      ? { subject: cur.subject, bodyHtml: cur.bodyHtml, enabled: cur.enabled }
      : { subject: '', bodyHtml: '', enabled: true });
  const save = useMutation({
    mutationFn: () => api.post('/admin/email-templates', { trigger, ...value }),
    onSuccess: () => {
      toast.ok('저장했습니다. 다음 발송부터 적용됩니다.');
      setDraft(null);
      void qc.invalidateQueries({ queryKey: ['email-templates'] });
    },
    onError: toast.error,
  });
  const doPreview = useMutation({
    mutationFn: () =>
      api.post<{ subject: string; html: string }>('/admin/email-templates/preview', {
        subject: value.subject,
        bodyHtml: value.bodyHtml,
      }),
    onSuccess: setPreview,
    onError: toast.error,
  });
  return (
    <>
      <PageHeader
        back={<SettingsBack />}
        title="이메일 양식"
        description="상황별 자동 발송 메일의 제목과 본문입니다."
      />
      {q.isLoading ? (
        <Card className="p-5">
          <LoadingBlock rows={6} />
        </Card>
      ) : q.error ? (
        <ErrorState error={q.error} />
      ) : (
        <div className="grid gap-6 lg:grid-cols-[240px_1fr]">
          <nav
            className="flex gap-1 overflow-x-auto lg:max-h-[70vh] lg:flex-col lg:overflow-y-auto"
            aria-label="메일 종류"
          >
            {(q.data?.triggers ?? []).map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => {
                  setTrigger(t);
                  setDraft(null);
                  setPreview(null);
                }}
                className={`flex items-center justify-between gap-2 whitespace-nowrap rounded-lg px-3 py-2 text-left text-sm ${trigger === t ? 'bg-brand/10 font-semibold text-brand' : 'text-ink-soft hover:bg-surface-sunken'}`}
              >
                {TRIGGER[t] ?? t}
                {latest.get(t)?.enabled === false && <Badge>꺼짐</Badge>}
              </button>
            ))}
          </nav>
          <div className="space-y-6">
            <Card>
              <CardHeader
                title={TRIGGER[trigger] ?? trigger}
                description={cur ? `v${cur.version} · ${formatDate(cur.createdAt, true)}` : '기본 양식'}
                action={
                  <Switch
                    checked={value.enabled}
                    onChange={(x) => setDraft({ ...value, enabled: x })}
                    label="발송"
                  />
                }
              />
              <CardBody className="space-y-3">
                <Field label="제목">
                  <Input
                    value={value.subject}
                    onChange={(e) => setDraft({ ...value, subject: e.target.value })}
                  />
                </Field>
                <Field
                  label="본문 (HTML)"
                  hint="입력값은 자동으로 이스케이프됩니다. 스크립트는 사용할 수 없습니다."
                >
                  <Textarea
                    rows={14}
                    className="font-mono text-xs"
                    value={value.bodyHtml}
                    onChange={(e) => setDraft({ ...value, bodyHtml: e.target.value })}
                  />
                </Field>
                <p className="text-xs text-ink-muted">
                  사용 가능한 값:{' '}
                  {VARS.map((v) => (
                    <code key={v} className="mr-1 rounded bg-surface-sunken px-1">{`{{${v}}}`}</code>
                  ))}
                </p>
                <div className="flex justify-end gap-2">
                  <Button
                    variant="secondary"
                    icon={<Eye className="h-4 w-4" />}
                    loading={doPreview.isPending}
                    onClick={() => doPreview.mutate()}
                  >
                    미리보기
                  </Button>
                  <Button
                    disabled={!draft || !value.subject || !value.bodyHtml}
                    loading={save.isPending}
                    onClick={() => save.mutate()}
                  >
                    저장
                  </Button>
                </div>
              </CardBody>
            </Card>
            {preview && (
              <Card>
                <CardHeader title={`미리보기: ${preview.subject}`} />
                <iframe
                  title="이메일 미리보기"
                  sandbox=""
                  srcDoc={preview.html}
                  className="h-[480px] w-full rounded-b-2xl bg-white"
                />
              </Card>
            )}
            <Alert>보내는 사람 이름과 주소는 설정 → 알림에서, SMTP 서버는 API 연결에서 설정합니다.</Alert>
          </div>
        </div>
      )}
    </>
  );
}
