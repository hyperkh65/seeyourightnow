'use client';

import { useSearchParams } from 'next/navigation';
import { Suspense, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import QRCode from 'qrcode';
import { startRegistration } from '@simplewebauthn/browser';
import { KeyRound, Laptop, ShieldCheck, Trash2 } from 'lucide-react';
import { api, errorMessage } from '@/lib/api';
import { formatDate, timeAgo } from '@/lib/utils';
import { useMe, useToast } from '@/components/providers';
import { Alert, Badge, Button, Card, CardBody, CardHeader, Field, Input, PageHeader } from '@/components/ui';

function MfaCard() {
  const me = useMe();
  const qc = useQueryClient();
  const toast = useToast();
  const [setup, setSetup] = useState<{ secret: string; qr: string } | null>(null);
  const [code, setCode] = useState('');
  const [codes, setCodes] = useState<string[] | null>(null);
  const enabled = !!me.data?.user?.mfaEnabled;
  const start = async () => {
    try {
      const r = await api.post<{ secret: string; otpauthUri: string }>('/auth/mfa/setup');
      setSetup({ secret: r.secret, qr: await QRCode.toDataURL(r.otpauthUri, { margin: 1, width: 180 }) });
    } catch (e) {
      toast.error(e);
    }
  };
  const enable = useMutation({
    mutationFn: () => api.post<{ recoveryCodes: string[] }>('/auth/mfa/enable', { code }),
    onSuccess: (r) => {
      setCodes(r.recoveryCodes);
      setSetup(null);
      void qc.invalidateQueries({ queryKey: ['me'] });
      toast.ok('2단계 인증이 켜졌습니다.');
    },
    onError: toast.error,
  });
  return (
    <Card>
      <CardHeader title="2단계 인증 (OTP)" description="Google Authenticator 등 인증 앱으로 로그인을 한 번 더 보호합니다." action={enabled ? <Badge tone="ok">사용 중</Badge> : <Badge>꺼짐</Badge>} />
      <CardBody className="space-y-4">
        {codes && (
          <Alert tone="warn" title="복구 코드를 안전한 곳에 보관하세요 (한 번만 표시됩니다)">
            <div className="mt-2 grid grid-cols-2 gap-1 font-mono text-sm">{codes.map((c) => <span key={c}>{c}</span>)}</div>
          </Alert>
        )}
        {!enabled && !setup && <Button onClick={start} icon={<ShieldCheck className="h-4 w-4" />}>2단계 인증 설정하기</Button>}
        {setup && (
          <div className="flex flex-col gap-4 sm:flex-row">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={setup.qr} alt="OTP 등록 QR 코드" className="h-44 w-44 rounded-xl border border-line bg-white p-2" />
            <form className="flex-1 space-y-3" onSubmit={(e) => { e.preventDefault(); enable.mutate(); }}>
              <p className="text-sm text-ink-soft">인증 앱으로 QR 코드를 스캔하거나 아래 키를 직접 입력한 뒤, 앱에 표시된 6자리 코드를 입력하세요.</p>
              <p className="break-all rounded-lg bg-surface-sunken px-3 py-2 font-mono text-xs">{setup.secret}</p>
              <Field label="인증 코드"><Input inputMode="numeric" autoComplete="one-time-code" value={code} onChange={(e) => setCode(e.target.value)} /></Field>
              <Button type="submit" loading={enable.isPending} disabled={code.length < 6}>켜기</Button>
            </form>
          </div>
        )}
      </CardBody>
    </Card>
  );
}

function PasskeysCard() {
  const qc = useQueryClient();
  const toast = useToast();
  const q = useQuery({ queryKey: ['passkeys'], queryFn: () => api.get<{ items: Array<{ id: string; label: string; createdAt: string; lastUsedAt: string | null }> }>('/auth/passkeys') });
  const add = async () => {
    try {
      const opts = await api.post<Record<string, unknown>>('/auth/passkeys/register/options');
      const response = await startRegistration({ optionsJSON: opts as never });
      await api.post('/auth/passkeys/register/verify', { response, label: navigator.platform || '패스키' });
      toast.ok('패스키를 등록했습니다.');
      void qc.invalidateQueries({ queryKey: ['passkeys'] });
    } catch (e) {
      toast.error(e instanceof Error && e.name === 'NotAllowedError' ? '등록이 취소되었습니다.' : errorMessage(e));
    }
  };
  const del = useMutation({ mutationFn: (id: string) => api.delete(`/auth/passkeys/${id}`), onSuccess: () => qc.invalidateQueries({ queryKey: ['passkeys'] }) });
  return (
    <Card>
      <CardHeader title="패스키" description="지문·얼굴 인식으로 비밀번호 없이 안전하게 로그인합니다." action={<Button size="sm" variant="secondary" onClick={add} icon={<KeyRound className="h-4 w-4" />}>추가</Button>} />
      <CardBody className="space-y-2">
        {!q.data?.items.length ? <p className="text-sm text-ink-muted">등록된 패스키가 없습니다.</p> : q.data.items.map((p) => (
          <div key={p.id} className="flex items-center justify-between text-sm">
            <span>{p.label || '패스키'} <span className="text-xs text-ink-muted">· 등록 {formatDate(p.createdAt)}{p.lastUsedAt ? ` · 최근 사용 ${timeAgo(p.lastUsedAt)}` : ''}</span></span>
            <Button variant="ghost" size="icon" aria-label="삭제" onClick={() => del.mutate(p.id)}><Trash2 className="h-4 w-4" /></Button>
          </div>
        ))}
      </CardBody>
    </Card>
  );
}

function SessionsCard() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['sessions'], queryFn: () => api.get<{ items: Array<{ id: string; deviceLabel: string; ip: string; lastSeenAt: string; current: boolean }> }>('/auth/sessions') });
  const revoke = useMutation({ mutationFn: (id: string) => api.delete(`/auth/sessions/${id}`), onSuccess: () => qc.invalidateQueries({ queryKey: ['sessions'] }) });
  return (
    <Card>
      <CardHeader title="로그인된 기기" />
      <CardBody className="space-y-3">
        {q.data?.items.map((s) => (
          <div key={s.id} className="flex items-center justify-between gap-3 text-sm">
            <span className="flex items-center gap-2"><Laptop className="h-4 w-4 text-ink-muted" />{s.deviceLabel} <span className="text-xs text-ink-muted">· {s.ip} · {timeAgo(s.lastSeenAt)}</span>{s.current && <Badge tone="brand">현재 기기</Badge>}</span>
            {!s.current && <Button variant="ghost" size="sm" onClick={() => revoke.mutate(s.id)}>로그아웃</Button>}
          </div>
        ))}
      </CardBody>
    </Card>
  );
}

function PasswordCard() {
  const toast = useToast();
  const [f, setF] = useState({ currentPassword: '', newPassword: '' });
  const m = useMutation({ mutationFn: () => api.post('/auth/password', f), onSuccess: () => { toast.ok('비밀번호를 바꿨습니다. 다른 기기는 로그아웃됩니다.'); setF({ currentPassword: '', newPassword: '' }); }, onError: toast.error });
  return (
    <Card>
      <CardHeader title="비밀번호 변경" />
      <CardBody>
        <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); m.mutate(); }}>
          <Field label="현재 비밀번호"><Input type="password" autoComplete="current-password" value={f.currentPassword} onChange={(e) => setF({ ...f, currentPassword: e.target.value })} /></Field>
          <Field label="새 비밀번호" hint="10자 이상"><Input type="password" autoComplete="new-password" value={f.newPassword} onChange={(e) => setF({ ...f, newPassword: e.target.value })} /></Field>
          <Button type="submit" loading={m.isPending} disabled={!f.currentPassword || f.newPassword.length < 10}>변경</Button>
        </form>
      </CardBody>
    </Card>
  );
}

function Security() {
  const sp = useSearchParams();
  const me = useMe();
  return (
    <>
      <PageHeader title="계정·보안" description={me.data?.user?.email} />
      {sp.get('setup') && <Alert tone="warn" className="mb-6" title="2단계 인증이 필요합니다">플랫폼 관리자 계정은 2단계 인증을 켜야 사용할 수 있습니다.</Alert>}
      <div className="grid gap-6 lg:grid-cols-2">
        <MfaCard />
        <PasskeysCard />
        <PasswordCard />
        <SessionsCard />
      </div>
    </>
  );
}

export default function SecurityPage() {
  return <Suspense><Security /></Suspense>;
}
