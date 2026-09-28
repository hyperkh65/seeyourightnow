'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Copy, Plus, Webhook } from 'lucide-react';
import { api } from '@/lib/api';
import { formatDate } from '@/lib/utils';
import { useToast } from '@/components/providers';
import {
  Alert,
  Badge,
  Button,
  Card,
  CardBody,
  Checkbox,
  Dialog,
  EmptyState,
  ErrorState,
  Field,
  Input,
  LoadingBlock,
  PageHeader,
  Switch,
  Table,
  Td,
  Th,
} from '@/components/ui';
import { SettingsBack } from '../_components/editor';

interface Hook {
  id: string;
  url: string;
  events: string[];
  enabled: boolean;
  createdAt: string;
  lastDeliveryAt?: string | null;
  failureCount?: number;
}
interface Delivery {
  id: string;
  event: string;
  status: string;
  responseStatus: number | null;
  attempts: number;
  createdAt: string;
  error?: string | null;
}

export default function Webhooks() {
  const qc = useQueryClient();
  const toast = useToast();
  const q = useQuery({
    queryKey: ['webhooks'],
    queryFn: () => api.get<{ events: string[]; items: Hook[] }>('/admin/webhooks'),
  });
  const [form, setForm] = useState<{ url: string; events: string[] } | null>(null);
  const [secret, setSecret] = useState<string | null>(null);
  const [logs, setLogs] = useState<string | null>(null);
  const deliveries = useQuery({
    queryKey: ['webhook-deliveries', logs],
    queryFn: () => api.get<{ items: Delivery[] }>(`/admin/webhooks/${logs}/deliveries`),
    enabled: !!logs,
  });
  const refresh = () => void qc.invalidateQueries({ queryKey: ['webhooks'] });
  const create = useMutation({
    mutationFn: () => api.post<{ signingSecret: string }>('/admin/webhooks', form),
    onSuccess: (r) => {
      setForm(null);
      setSecret(r.signingSecret);
      refresh();
    },
    onError: toast.error,
  });
  const patch = useMutation({
    mutationFn: ({ id, body }: { id: string; body: Record<string, unknown> }) =>
      api.patch(`/admin/webhooks/${id}`, body),
    onSuccess: refresh,
    onError: toast.error,
  });
  return (
    <>
      <PageHeader
        back={<SettingsBack />}
        title="웹훅"
        description="견적 승인, 입금, 선적 같은 이벤트를 외부 시스템(ERP, n8n 등)으로 보냅니다."
        actions={
          <Button
            icon={<Plus className="h-4 w-4" />}
            onClick={() => setForm({ url: 'https://', events: [] })}
          >
            웹훅 추가
          </Button>
        }
      />
      <Alert className="mb-6">
        모든 요청에는 HMAC-SHA256 서명(<code>X-SOS-Signature: t=타임스탬프,v1=서명</code>)이 포함됩니다.
        실패하면 자동으로 재시도하며, 내부 원가·마진 정보는 전송되지 않습니다.
      </Alert>
      {q.isLoading ? (
        <Card className="p-5">
          <LoadingBlock rows={4} />
        </Card>
      ) : q.error ? (
        <ErrorState error={q.error} />
      ) : !q.data?.items.length ? (
        <Card>
          <EmptyState icon={<Webhook className="h-6 w-6" />} title="등록된 웹훅이 없습니다" />
        </Card>
      ) : (
        <div className="space-y-3">
          {q.data.items.map((h) => (
            <Card key={h.id}>
              <CardBody className="flex flex-wrap items-center gap-3">
                <div className="min-w-0 flex-1">
                  <p className="truncate font-mono text-sm">{h.url}</p>
                  <p className="mt-1 flex flex-wrap gap-1">
                    {h.events.map((e) => (
                      <Badge key={e}>{e === '*' ? '모든 이벤트' : e}</Badge>
                    ))}
                  </p>
                </div>
                <Switch
                  checked={h.enabled}
                  onChange={(x) => patch.mutate({ id: h.id, body: { enabled: x } })}
                  label="사용"
                />
                <Button size="sm" variant="secondary" onClick={() => setLogs(h.id)}>
                  전송 기록
                </Button>
              </CardBody>
            </Card>
          ))}
        </div>
      )}
      <Dialog
        open={!!form}
        onClose={() => setForm(null)}
        size="lg"
        title="웹훅 추가"
        footer={
          <>
            <Button variant="secondary" onClick={() => setForm(null)}>
              취소
            </Button>
            <Button
              loading={create.isPending}
              disabled={!form?.url.startsWith('https://') || !form.events.length}
              onClick={() => create.mutate()}
            >
              추가
            </Button>
          </>
        }
      >
        {form && (
          <div className="space-y-4">
            <Field label="받을 주소" hint="https 주소만 가능합니다. 내부망 주소는 차단됩니다.">
              <Input value={form.url} onChange={(e) => setForm({ ...form, url: e.target.value })} />
            </Field>
            <Field label="이벤트">
              <div className="grid gap-2 sm:grid-cols-2">
                <Checkbox
                  checked={form.events.includes('*')}
                  onChange={(x) => setForm({ ...form, events: x ? ['*'] : [] })}
                  label="모든 이벤트"
                />
                {!form.events.includes('*') &&
                  q.data?.events.map((e) => (
                    <Checkbox
                      key={e}
                      checked={form.events.includes(e)}
                      onChange={(x) =>
                        setForm({
                          ...form,
                          events: x ? [...form.events, e] : form.events.filter((y) => y !== e),
                        })
                      }
                      label={e}
                    />
                  ))}
              </div>
            </Field>
          </div>
        )}
      </Dialog>
      <Dialog
        open={!!secret}
        onClose={() => setSecret(null)}
        title="서명 비밀키"
        description="이 값은 지금 한 번만 표시됩니다. 안전한 곳에 보관하세요."
        footer={<Button onClick={() => setSecret(null)}>확인했습니다</Button>}
      >
        <div className="flex items-center gap-2">
          <code className="min-w-0 flex-1 break-all rounded bg-surface-sunken p-2 text-xs">{secret}</code>
          <Button
            size="sm"
            variant="secondary"
            icon={<Copy className="h-4 w-4" />}
            onClick={() => {
              void navigator.clipboard.writeText(secret ?? '');
              toast.ok('복사했습니다.');
            }}
          >
            복사
          </Button>
        </div>
      </Dialog>
      <Dialog open={!!logs} onClose={() => setLogs(null)} size="xl" title="전송 기록">
        {deliveries.isLoading ? (
          <LoadingBlock rows={4} />
        ) : !deliveries.data?.items.length ? (
          <p className="text-sm text-ink-muted">전송 기록이 없습니다.</p>
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>시각</Th>
                <Th>이벤트</Th>
                <Th>상태</Th>
                <Th>응답</Th>
                <Th>시도</Th>
              </tr>
            </thead>
            <tbody>
              {deliveries.data.items.map((d) => (
                <tr key={d.id}>
                  <Td className="text-xs">{formatDate(d.createdAt, true)}</Td>
                  <Td className="text-xs">{d.event}</Td>
                  <Td>
                    <Badge
                      tone={
                        d.status === 'SUCCESS'
                          ? 'ok'
                          : d.status === 'FAILED' || d.status === 'DEAD_LETTER'
                            ? 'danger'
                            : 'neutral'
                      }
                    >
                      {d.status}
                    </Badge>
                  </Td>
                  <Td className="text-xs">{d.responseStatus ?? '—'}</Td>
                  <Td className="text-xs">{d.attempts}</Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Dialog>
    </>
  );
}
