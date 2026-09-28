'use client';

import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { KeyRound } from 'lucide-react';
import { startAuthentication } from '@simplewebauthn/browser';
import { api, errorMessage } from '@/lib/api';
import { afterLogin } from '@/lib/auth-client';
import { useSite } from '@/components/providers';
import { Alert, Button, Card, CardBody, Field, Input } from '@/components/ui';

function LoginForm() {
  const router = useRouter();
  const sp = useSearchParams();
  const qc = useQueryClient();
  const site = useSite();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const claimId = sp.get('claim');
  const claim = claimId ? { id: claimId, token: sp.get('t') ?? '' } : null;

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      await api.post('/auth/login', { email, password });
      await afterLogin(router, qc, sp.get('next'), claim);
    } catch (e) {
      setError(errorMessage(e));
      setBusy(false);
    }
  };

  const passkey = async () => {
    setError(null);
    try {
      const opts = await api.post<Record<string, unknown> & { handle: string }>(
        '/auth/passkeys/login/options',
      );
      const { handle, ...o } = opts;
      const response = await startAuthentication({ optionsJSON: o as never });
      await api.post('/auth/passkeys/login/verify', { handle, response });
      await afterLogin(router, qc, sp.get('next'), claim);
    } catch (e) {
      setError(
        e instanceof Error && e.name === 'NotAllowedError'
          ? '패스키 인증이 취소되었습니다.'
          : errorMessage(e),
      );
    }
  };

  return (
    <div className="mx-auto flex max-w-md flex-col px-4 py-12 sm:py-20">
      <h1 className="text-center text-2xl font-bold tracking-tight">
        {site?.platform ? '플랫폼 관리자 로그인' : '로그인'}
      </h1>
      <p className="mt-2 text-center text-sm text-ink-muted">
        {site?.brand.siteName ?? 'Sourcing OS'}에 오신 것을 환영합니다.
      </p>
      <Card className="mt-8">
        <CardBody>
          <form
            className="space-y-4"
            onSubmit={(e) => {
              e.preventDefault();
              void submit();
            }}
          >
            {claim && <Alert tone="info">로그인하면 방금 검색한 결과가 내 소싱에 저장됩니다.</Alert>}
            <Field label="이메일" htmlFor="email">
              <Input
                id="email"
                type="email"
                autoComplete="username"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
              />
            </Field>
            <Field label="비밀번호" htmlFor="password">
              <Input
                id="password"
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
              />
            </Field>
            {error && <Alert tone="danger">{error}</Alert>}
            <Button type="submit" className="w-full" size="lg" loading={busy}>
              로그인
            </Button>
            <Button
              variant="secondary"
              className="w-full"
              onClick={passkey}
              icon={<KeyRound className="h-4 w-4" />}
            >
              패스키로 로그인
            </Button>
          </form>
        </CardBody>
      </Card>
      {!site?.platform && (
        <p className="mt-6 text-center text-sm text-ink-muted">
          아직 계정이 없나요?{' '}
          <Link
            href={`/signup${claim ? `?claim=${claim.id}&t=${encodeURIComponent(claim.token)}` : ''}`}
            className="font-medium text-brand hover:underline"
          >
            회원가입
          </Link>
        </p>
      )}
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense>
      <LoginForm />
    </Suspense>
  );
}
