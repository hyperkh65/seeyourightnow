'use client';

import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ExternalLink, KeyRound, Plug, PlugZap, Plus, Trash2 } from 'lucide-react';
import { api } from '@/lib/api';
import { formatDate, timeAgo } from '@/lib/utils';
import { useCan, useToast } from '@/components/providers';
import { ConnectionStatus } from '@/components/status';
import {
  Alert,
  Badge,
  Button,
  Card,
  CardBody,
  CardHeader,
  Dialog,
  ErrorState,
  Field,
  Input,
  LoadingBlock,
  PageHeader,
  Select,
  Switch,
  Tabs,
  Textarea,
} from '@/components/ui';
import { SettingsBack } from '../_components/editor';

interface FieldDef {
  key: string;
  label: string;
  type?: 'text' | 'url' | 'number' | 'select' | 'textarea' | 'boolean';
  required?: boolean;
  placeholder?: string;
  help?: string;
  options?: string[];
  default?: string;
}
interface Provider {
  provider: string;
  category: string;
  label: string;
  description: string;
  howToGet: string;
  docsUrl?: string;
  required: 'REQUIRED' | 'RECOMMENDED' | 'OPTIONAL';
  configFields: FieldDef[];
  secretFields: FieldDef[];
  capabilities: string[];
}
interface Conn {
  id: string;
  provider: string;
  category: string;
  label: string;
  enabled: boolean;
  status: string;
  config: Record<string, unknown>;
  secrets: Record<string, string | null>;
  lastTestAt: string | null;
  lastSuccessAt: string | null;
  lastError: string | null;
  circuitOpen: boolean;
}
interface ConnRes {
  items: Conn[];
  system: { storage: string; email: string; pdf: string; malwareScan: string; secretsBackend: string };
}

const CAT: Record<string, string> = {
  AI: 'AI',
  MARKETPLACE: '중국 공급처',
  DOMESTIC_MARKET: '국내 시장가격',
  SHIPPING: '운송 추적',
  CUSTOMS: '통관',
  GOVERNMENT: '공공 데이터',
  EMAIL: '이메일',
  SMS: '문자·알림톡',
  PAYMENT: '결제',
  STORAGE: '저장소',
  ANALYTICS: '분석',
  WEBHOOKS: '웹훅',
  MESSAGING: '메신저',
};
const REQ: Record<string, [string, 'danger' | 'warn' | 'neutral']> = {
  REQUIRED: ['필수', 'danger'],
  RECOMMENDED: ['권장', 'warn'],
  OPTIONAL: ['선택', 'neutral'],
};

function ConnDialog({
  provider,
  conn,
  onClose,
}: {
  provider: Provider;
  conn: Conn | null;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const toast = useToast();
  const [label, setLabel] = useState(conn?.label ?? provider.label);
  const [enabled, setEnabled] = useState(conn?.enabled ?? true);
  const [cfg, setCfg] = useState<Record<string, unknown>>(() => ({
    ...Object.fromEntries(
      provider.configFields.filter((f) => f.default !== undefined).map((f) => [f.key, f.default]),
    ),
    ...(conn?.config ?? {}),
  }));
  const [secrets, setSecrets] = useState<Record<string, string>>({});
  const missing = provider.configFields
    .filter((f) => f.required && !String(cfg[f.key] ?? '').trim())
    .map((f) => f.label);
  const save = useMutation({
    mutationFn: () => {
      const s = Object.fromEntries(Object.entries(secrets).filter(([, v]) => v.trim()));
      return conn
        ? api.patch(`/admin/connections/${conn.id}`, { label, enabled, config: cfg, secrets: s })
        : api.post('/admin/connections', {
            provider: provider.provider,
            label,
            enabled,
            config: cfg,
            secrets: s,
          });
    },
    onSuccess: () => {
      toast.ok('저장했습니다. ‘연결 테스트’로 확인해 보세요.');
      void qc.invalidateQueries({ queryKey: ['connections'] });
      onClose();
    },
    onError: toast.error,
  });
  const input = (f: FieldDef) => {
    const v = cfg[f.key];
    if (f.type === 'boolean')
      return <Switch checked={Boolean(v)} onChange={(x) => setCfg({ ...cfg, [f.key]: x })} label={f.label} />;
    if (f.type === 'select')
      return (
        <Select value={String(v ?? '')} onChange={(e) => setCfg({ ...cfg, [f.key]: e.target.value })}>
          <option value="">선택</option>
          {f.options?.map((o) => (
            <option key={o}>{o}</option>
          ))}
        </Select>
      );
    if (f.type === 'textarea')
      return (
        <Textarea
          rows={3}
          value={String(v ?? '')}
          placeholder={f.placeholder}
          onChange={(e) => setCfg({ ...cfg, [f.key]: e.target.value })}
        />
      );
    return (
      <Input
        type={f.type === 'number' ? 'number' : 'text'}
        value={String(v ?? '')}
        placeholder={f.placeholder}
        onChange={(e) =>
          setCfg({ ...cfg, [f.key]: f.type === 'number' ? Number(e.target.value) : e.target.value })
        }
      />
    );
  };
  return (
    <Dialog
      open
      onClose={onClose}
      size="lg"
      title={conn ? `${provider.label} 설정` : `${provider.label} 연결`}
      description={provider.description}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            취소
          </Button>
          <Button loading={save.isPending} disabled={missing.length > 0} onClick={() => save.mutate()}>
            저장
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Alert title="발급 방법">
          {provider.howToGet}
          {provider.docsUrl && (
            <>
              {' '}
              <a
                href={provider.docsUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-0.5 text-brand hover:underline"
              >
                공식 문서 <ExternalLink className="h-3 w-3" />
              </a>
            </>
          )}
        </Alert>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="이름">
            <Input value={label} onChange={(e) => setLabel(e.target.value)} />
          </Field>
          <div className="self-end pb-2">
            <Switch checked={enabled} onChange={setEnabled} label="사용" />
          </div>
          {provider.configFields.map((f) => (
            <Field
              key={f.key}
              label={f.type === 'boolean' ? undefined : f.label}
              required={f.required}
              hint={f.help}
              className={f.type === 'textarea' ? 'sm:col-span-2' : undefined}
            >
              {input(f)}
            </Field>
          ))}
        </div>
        {provider.secretFields.length > 0 && (
          <div className="space-y-3 rounded-xl border border-line p-4">
            <p className="flex items-center gap-1.5 text-sm font-semibold">
              <KeyRound className="h-4 w-4" />
              인증 정보
            </p>
            <p className="text-xs text-ink-muted">
              암호화되어 서버에만 저장되며 다시 표시되지 않습니다. 바꿀 때만 새 값을 입력하세요.
            </p>
            {provider.secretFields.map((f) => (
              <Field
                key={f.key}
                label={f.label}
                required={f.required && !conn?.secrets[f.key]}
                hint={conn?.secrets[f.key] ? `저장된 값: ${conn.secrets[f.key]}` : f.help}
              >
                {f.type === 'textarea' ? (
                  <Textarea
                    rows={3}
                    autoComplete="off"
                    spellCheck={false}
                    value={secrets[f.key] ?? ''}
                    placeholder={conn?.secrets[f.key] ? '변경하지 않으려면 비워 두세요' : ''}
                    onChange={(e) => setSecrets({ ...secrets, [f.key]: e.target.value })}
                  />
                ) : (
                  <Input
                    type="password"
                    autoComplete="new-password"
                    value={secrets[f.key] ?? ''}
                    placeholder={conn?.secrets[f.key] ? '변경하지 않으려면 비워 두세요' : ''}
                    onChange={(e) => setSecrets({ ...secrets, [f.key]: e.target.value })}
                  />
                )}
              </Field>
            ))}
          </div>
        )}
        {missing.length > 0 && <p className="text-xs text-red-600">필수 항목: {missing.join(', ')}</p>}
      </div>
    </Dialog>
  );
}

export default function Connections() {
  const qc = useQueryClient();
  const toast = useToast();
  const can = useCan();
  const writable = can('tenant.connections.write');
  const catalog = useQuery({
    queryKey: ['connections-catalog'],
    queryFn: () => api.get<{ categories: string[]; providers: Provider[] }>('/admin/connections/catalog'),
  });
  const q = useQuery({ queryKey: ['connections'], queryFn: () => api.get<ConnRes>('/admin/connections') });
  const [cat, setCat] = useState('AI');
  const [dialog, setDialog] = useState<{ provider: Provider; conn: Conn | null } | null>(null);
  const [results, setResults] = useState<Record<string, { ok: boolean; message: string }>>({});
  const test = useMutation({
    mutationFn: (id: string) =>
      api.post<{ ok: boolean; message: string }>(`/admin/connections/${id}/test`, {}),
    onSuccess: (r, id) => {
      setResults((x) => ({ ...x, [id]: r }));
      if (r.ok) toast.ok(r.message);
      else toast.error(r.message);
      void qc.invalidateQueries({ queryKey: ['connections'] });
    },
    onError: toast.error,
  });
  const del = useMutation({
    mutationFn: (id: string) => api.delete(`/admin/connections/${id}`),
    onSuccess: () => {
      toast.ok('연결을 삭제했습니다.');
      void qc.invalidateQueries({ queryKey: ['connections'] });
    },
    onError: toast.error,
  });
  const providers = useMemo(
    () => (catalog.data?.providers ?? []).filter((p) => p.category === cat),
    [catalog.data, cat],
  );
  if (catalog.isLoading || q.isLoading)
    return (
      <>
        <PageHeader back={<SettingsBack />} title="API 연결" />
        <Card className="p-5">
          <LoadingBlock rows={6} />
        </Card>
      </>
    );
  if (catalog.error || q.error || !catalog.data || !q.data)
    return <ErrorState error={catalog.error ?? q.error} />;
  const conns = q.data.items;
  const sys = q.data.system;
  const counts = Object.fromEntries(
    catalog.data.categories.map((c) => [c, conns.filter((x) => x.category === c).length]),
  );
  return (
    <>
      <PageHeader
        back={<SettingsBack />}
        title="API 연결"
        description="외부 서비스를 연결합니다. 연결하지 않은 기능은 ‘연결 필요’로 표시되며, 가짜 데이터를 실제처럼 보여 주지 않습니다."
      />
      <Card className="mb-6">
        <CardHeader
          title="서버 설정 (환경 변수)"
          description="아래 항목은 보안상 서버 환경 변수로만 설정합니다."
        />
        <CardBody className="flex flex-wrap gap-2 text-xs">
          <Badge>파일 저장소 {sys.storage}</Badge>
          <Badge tone={sys.email === 'CONFIGURED' ? 'ok' : 'warn'}>
            기본 SMTP {sys.email === 'CONFIGURED' ? '설정됨' : '미설정'}
          </Badge>
          <Badge>PDF {sys.pdf}</Badge>
          <Badge tone={sys.malwareScan === 'CONFIGURED' ? 'ok' : 'neutral'}>
            악성코드 검사 {sys.malwareScan === 'CONFIGURED' ? '사용' : '미사용'}
          </Badge>
          <Badge>비밀값 저장소 {sys.secretsBackend}</Badge>
        </CardBody>
      </Card>
      <Tabs
        className="mb-6"
        value={cat}
        onChange={setCat}
        items={catalog.data.categories
          .filter((c) => catalog.data!.providers.some((p) => p.category === c))
          .map((c) => ({ value: c, label: CAT[c] ?? c, count: counts[c] || undefined }))}
      />
      <div className="space-y-4">
        {providers.map((p) => {
          const mine = conns.filter((c) => c.provider === p.provider);
          const [rl, rt] = REQ[p.required]!;
          return (
            <Card key={p.provider}>
              <CardBody className="space-y-3">
                <div className="flex flex-wrap items-start gap-3">
                  <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-surface-sunken">
                    <Plug className="h-5 w-5 text-ink-soft" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="flex flex-wrap items-center gap-2 font-semibold">
                      {p.label}
                      <Badge tone={rt}>{rl}</Badge>
                    </p>
                    <p className="text-sm text-ink-muted">{p.description}</p>
                  </div>
                  {writable && (
                    <Button
                      size="sm"
                      variant={mine.length ? 'secondary' : 'primary'}
                      icon={<Plus className="h-4 w-4" />}
                      onClick={() => setDialog({ provider: p, conn: null })}
                    >
                      {mine.length ? '추가 연결' : '연결'}
                    </Button>
                  )}
                </div>
                {mine.map((c) => (
                  <div
                    key={c.id}
                    className="flex flex-wrap items-center gap-3 rounded-xl border border-line px-3 py-2.5 text-sm"
                  >
                    <span className="font-medium">{c.label}</span>
                    <ConnectionStatus status={c.enabled ? c.status : 'DISABLED'} />
                    {c.circuitOpen && <Badge tone="danger">일시 차단 (연속 실패)</Badge>}
                    <span className="text-xs text-ink-muted">
                      {Object.entries(c.secrets)
                        .map(([k, m]) => `${k} ${m ?? '없음'}`)
                        .join(' · ')}
                    </span>
                    <span className="text-xs text-ink-muted">
                      {c.lastSuccessAt
                        ? `마지막 성공 ${timeAgo(c.lastSuccessAt)}`
                        : c.lastTestAt
                          ? `테스트 ${formatDate(c.lastTestAt, true)}`
                          : '테스트 전'}
                    </span>
                    <div className="ml-auto flex gap-1">
                      <Button
                        size="sm"
                        variant="secondary"
                        icon={<PlugZap className="h-4 w-4" />}
                        loading={test.isPending && test.variables === c.id}
                        onClick={() => test.mutate(c.id)}
                      >
                        연결 테스트
                      </Button>
                      {writable && (
                        <Button size="sm" variant="ghost" onClick={() => setDialog({ provider: p, conn: c })}>
                          설정
                        </Button>
                      )}
                      {writable && (
                        <Button
                          size="sm"
                          variant="ghost"
                          aria-label="삭제"
                          onClick={() => {
                            if (confirm(`${c.label} 연결을 삭제할까요? 저장된 인증 정보도 함께 삭제됩니다.`))
                              del.mutate(c.id);
                          }}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      )}
                    </div>
                    {(results[c.id] || c.lastError) && (
                      <p
                        className={`w-full text-xs ${results[c.id]?.ok ? 'text-emerald-600' : 'text-red-600'}`}
                      >
                        {results[c.id]?.message ?? c.lastError}
                      </p>
                    )}
                  </div>
                ))}
              </CardBody>
            </Card>
          );
        })}
      </div>
      {dialog && <ConnDialog provider={dialog.provider} conn={dialog.conn} onClose={() => setDialog(null)} />}
    </>
  );
}
