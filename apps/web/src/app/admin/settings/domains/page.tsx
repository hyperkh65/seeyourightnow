'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Copy, Globe, Plus, RefreshCw, Trash2 } from 'lucide-react';
import { api } from '@/lib/api';
import { formatDate } from '@/lib/utils';
import { useToast } from '@/components/providers';
import {
  Alert,
  Badge,
  Button,
  Card,
  CardBody,
  Dialog,
  EmptyState,
  ErrorState,
  Field,
  Input,
  LoadingBlock,
  PageHeader,
} from '@/components/ui';
import { SettingsBack } from '../_components/editor';

interface Domain {
  id: string;
  hostname: string;
  kind: string;
  verificationToken: string;
  dnsStatus: string;
  sslStatus: string;
  active: boolean;
  isPrimary: boolean;
  lastCheckedAt: string | null;
  lastError: string | null;
}

function CopyValue({ label, value }: { label: string; value: string }) {
  const toast = useToast();
  return (
    <div className="flex items-center gap-2 text-xs">
      <span className="w-20 shrink-0 text-ink-muted">{label}</span>
      <code className="min-w-0 flex-1 truncate rounded bg-surface-sunken px-2 py-1">{value}</code>
      <Button
        size="sm"
        variant="ghost"
        aria-label={`${label} 복사`}
        onClick={() => {
          void navigator.clipboard.writeText(value);
          toast.ok('복사했습니다.');
        }}
      >
        <Copy className="h-3.5 w-3.5" />
      </Button>
    </div>
  );
}

export default function Domains() {
  const qc = useQueryClient();
  const toast = useToast();
  const q = useQuery({
    queryKey: ['domains'],
    queryFn: () => api.get<{ items: Domain[]; cnameTarget: string }>('/admin/domains'),
  });
  const [host, setHost] = useState<string | null>(null);
  const refresh = () => void qc.invalidateQueries({ queryKey: ['domains'] });
  const add = useMutation({
    mutationFn: () => api.post('/admin/domains', { hostname: host!.trim().toLowerCase() }),
    onSuccess: () => {
      toast.ok('도메인을 추가했습니다. DNS 설정 후 확인을 눌러 주세요.');
      setHost(null);
      refresh();
    },
    onError: toast.error,
  });
  const verify = useMutation({
    mutationFn: (id: string) =>
      api.post<{ ok: boolean; error: string | null }>(`/admin/domains/${id}/verify`, {}),
    onSuccess: (r) => {
      if (r.ok) toast.ok('확인되었습니다. 인증서 발급 후 활성화할 수 있습니다.');
      else toast.error(r.error ?? '확인하지 못했습니다.');
      refresh();
    },
    onError: toast.error,
  });
  const patch = useMutation({
    mutationFn: ({ id, body }: { id: string; body: Record<string, boolean> }) =>
      api.patch(`/admin/domains/${id}`, body),
    onSuccess: () => {
      toast.ok('저장했습니다.');
      refresh();
    },
    onError: toast.error,
  });
  const del = useMutation({
    mutationFn: (id: string) => api.delete(`/admin/domains/${id}`),
    onSuccess: () => {
      toast.ok('삭제했습니다.');
      refresh();
    },
    onError: toast.error,
  });
  const base = q.data?.cnameTarget ?? '';
  return (
    <>
      <PageHeader
        back={<SettingsBack />}
        title="도메인"
        description="자체 도메인(예: sourcing.회사.co.kr)으로 사이트를 운영할 수 있습니다."
        actions={
          <Button icon={<Plus className="h-4 w-4" />} onClick={() => setHost('')}>
            도메인 추가
          </Button>
        }
      />
      <Alert className="mb-6">
        ① 도메인을 추가하고 ② DNS에 TXT·CNAME 레코드를 등록한 뒤 ③ 확인을 누르세요. 확인되면 HTTPS 인증서가
        자동으로 발급됩니다.
      </Alert>
      {q.isLoading ? (
        <Card className="p-5">
          <LoadingBlock rows={4} />
        </Card>
      ) : q.error ? (
        <ErrorState error={q.error} />
      ) : !q.data?.items.length ? (
        <Card>
          <EmptyState icon={<Globe className="h-6 w-6" />} title="등록된 도메인이 없습니다" />
        </Card>
      ) : (
        <div className="space-y-4">
          {q.data.items.map((d) => (
            <Card key={d.id}>
              <CardBody className="space-y-3">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="font-semibold">{d.hostname}</p>
                  {d.isPrimary && <Badge tone="brand">대표</Badge>}
                  {d.kind === 'SUBDOMAIN' && <Badge>기본 주소</Badge>}
                  <Badge
                    tone={d.dnsStatus === 'VERIFIED' ? 'ok' : d.dnsStatus === 'FAILED' ? 'danger' : 'warn'}
                  >
                    DNS {d.dnsStatus === 'VERIFIED' ? '확인됨' : d.dnsStatus === 'FAILED' ? '실패' : '대기'}
                  </Badge>
                  <Badge tone={d.sslStatus === 'ACTIVE' ? 'ok' : 'neutral'}>SSL {d.sslStatus}</Badge>
                  <Badge tone={d.active ? 'ok' : 'neutral'}>{d.active ? '사용 중' : '꺼짐'}</Badge>
                  <div className="ml-auto flex flex-wrap gap-2">
                    {d.kind !== 'SUBDOMAIN' && (
                      <Button
                        size="sm"
                        variant="secondary"
                        icon={<RefreshCw className="h-4 w-4" />}
                        loading={verify.isPending}
                        onClick={() => verify.mutate(d.id)}
                      >
                        DNS 확인
                      </Button>
                    )}
                    {d.dnsStatus === 'VERIFIED' && (
                      <Button
                        size="sm"
                        variant="secondary"
                        onClick={() => patch.mutate({ id: d.id, body: { active: !d.active } })}
                      >
                        {d.active ? '끄기' : '사용'}
                      </Button>
                    )}
                    {!d.isPrimary && d.active && (
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => patch.mutate({ id: d.id, body: { isPrimary: true } })}
                      >
                        대표로
                      </Button>
                    )}
                    {d.kind !== 'SUBDOMAIN' && (
                      <Button
                        size="sm"
                        variant="ghost"
                        aria-label="삭제"
                        onClick={() => {
                          if (confirm(`${d.hostname}을(를) 삭제할까요?`)) del.mutate(d.id);
                        }}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    )}
                  </div>
                </div>
                {d.kind !== 'SUBDOMAIN' && d.dnsStatus !== 'VERIFIED' && (
                  <div className="space-y-1.5 rounded-lg border border-line p-3">
                    <p className="text-xs font-medium">DNS에 아래 레코드를 추가하세요</p>
                    <CopyValue label="TXT 이름" value={`_sos-verify.${d.hostname}`} />
                    <CopyValue label="TXT 값" value={d.verificationToken} />
                    {base && <CopyValue label="CNAME" value={base} />}
                  </div>
                )}
                {d.lastError && <p className="text-xs text-red-600">{d.lastError}</p>}
                {d.lastCheckedAt && (
                  <p className="text-xs text-ink-muted">마지막 확인 {formatDate(d.lastCheckedAt, true)}</p>
                )}
              </CardBody>
            </Card>
          ))}
        </div>
      )}
      <Dialog
        open={host !== null}
        onClose={() => setHost(null)}
        title="도메인 추가"
        footer={
          <>
            <Button variant="secondary" onClick={() => setHost(null)}>
              취소
            </Button>
            <Button loading={add.isPending} disabled={!host?.includes('.')} onClick={() => add.mutate()}>
              추가
            </Button>
          </>
        }
      >
        <Field label="도메인" hint="www 없이 입력해도 됩니다. 예: sourcing.example.co.kr">
          <Input
            value={host ?? ''}
            onChange={(e) => setHost(e.target.value)}
            placeholder="sourcing.example.co.kr"
          />
        </Field>
      </Dialog>
    </>
  );
}
