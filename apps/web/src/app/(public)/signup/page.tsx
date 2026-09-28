'use client';

import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { api, ApiError, errorMessage } from '@/lib/api';
import { afterLogin } from '@/lib/auth-client';
import { useSite } from '@/components/providers';
import { Alert, Button, Card, CardBody, Checkbox, Field, Input } from '@/components/ui';

function SignupForm() {
  const router = useRouter();
  const sp = useSearchParams();
  const qc = useQueryClient();
  const site = useSite();
  const [f, setF] = useState({ name: '', email: '', password: '', companyName: '', phone: '' });
  const [agree, setAgree] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const claimId = sp.get('claim');
  const claim = claimId ? { id: claimId, token: sp.get('t') ?? '' } : null;
  const required = site?.policies.filter((p) => ['PRIVACY', 'TERMS', 'SOURCING_TERMS'].includes(p.type)) ?? [];

  const submit = async () => {
    if (!agree) return setError('약관에 동의해 주세요.');
    setBusy(true);
    setError(null);
    try {
      await api.post('/auth/signup', { ...f, agreePolicies: true });
      await afterLogin(router, qc, null, claim);
    } catch (e) {
      setError(e instanceof ApiError && e.code === 'EMAIL_TAKEN' ? '이미 가입된 이메일입니다. 로그인해 주세요.' : errorMessage(e));
      setBusy(false);
    }
  };

  return (
    <div className="mx-auto max-w-md px-4 py-12 sm:py-16">
      <h1 className="text-center text-2xl font-bold tracking-tight">회원가입</h1>
      <p className="mt-2 text-center text-sm text-ink-muted">견적 요청과 진행 상황 확인을 위해 간단한 정보가 필요합니다.</p>
      <Card className="mt-8">
        <CardBody>
          <form
            className="space-y-4"
            onSubmit={(e) => {
              e.preventDefault();
              void submit();
            }}
          >
            {claim && <Alert tone="info">가입하면 방금 검색한 결과로 바로 견적 요청이 시작됩니다.</Alert>}
            <Field label="이름" required>
              <Input autoComplete="name" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} required />
            </Field>
            <Field label="회사명" required hint="개인 사업자는 상호를 입력하세요.">
              <Input autoComplete="organization" value={f.companyName} onChange={(e) => setF({ ...f, companyName: e.target.value })} required />
            </Field>
            <Field label="이메일" required>
              <Input type="email" autoComplete="email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} required />
            </Field>
            <Field label="비밀번호" required hint="10자 이상으로 입력하세요.">
              <Input type="password" autoComplete="new-password" minLength={10} value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} required />
            </Field>
            <Field label="연락처" hint="선택 · 배송·통관 안내에 사용됩니다.">
              <Input type="tel" autoComplete="tel" value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} />
            </Field>
            <div className="rounded-xl bg-surface-sunken p-3">
              <Checkbox checked={agree} onChange={setAgree} label={<span>아래 약관에 모두 동의합니다 (필수)</span>} />
              <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 pl-6 text-xs">
                {required.map((p) => (
                  <Link key={p.type} href={`/policies/${p.type.toLowerCase()}`} target="_blank" className="text-brand hover:underline">
                    {p.title} (v{p.version})
                  </Link>
                ))}
              </div>
            </div>
            {error && <Alert tone="danger">{error}</Alert>}
            <Button type="submit" size="lg" className="w-full" loading={busy}>
              가입하기
            </Button>
          </form>
        </CardBody>
      </Card>
      <p className="mt-6 text-center text-sm text-ink-muted">
        이미 계정이 있나요?{' '}
        <Link href={`/login${claim ? `?claim=${claim.id}&t=${encodeURIComponent(claim.token)}` : ''}`} className="font-medium text-brand hover:underline">
          로그인
        </Link>
      </p>
    </div>
  );
}

export default function SignupPage() {
  return (
    <Suspense>
      <SignupForm />
    </Suspense>
  );
}
