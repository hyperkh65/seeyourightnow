'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { ShieldCheck } from 'lucide-react';
import { api, errorMessage } from '@/lib/api';
import { afterLogin } from '@/lib/auth-client';
import { Alert, Button, Card, CardBody, Field, Input } from '@/components/ui';

function MfaForm() {
  const router = useRouter();
  const sp = useSearchParams();
  const qc = useQueryClient();
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      await api.post('/auth/mfa/verify', { code });
      await afterLogin(router, qc, sp.get('next'));
    } catch (e) {
      setError(errorMessage(e));
      setBusy(false);
    }
  };
  return (
    <div className="mx-auto max-w-sm px-4 py-16">
      <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-brand/10 text-brand">
        <ShieldCheck className="h-6 w-6" />
      </div>
      <h1 className="mt-4 text-center text-xl font-bold">2단계 인증</h1>
      <p className="mt-1 text-center text-sm text-ink-muted">
        인증 앱에 표시된 6자리 코드 또는 복구 코드를 입력하세요.
      </p>
      <Card className="mt-6">
        <CardBody>
          <form
            className="space-y-4"
            onSubmit={(e) => {
              e.preventDefault();
              void submit();
            }}
          >
            <Field label="인증 코드">
              <Input
                autoFocus
                inputMode="numeric"
                autoComplete="one-time-code"
                value={code}
                onChange={(e) => setCode(e.target.value)}
                className="text-center text-lg tracking-[0.3em]"
              />
            </Field>
            {error && <Alert tone="danger">{error}</Alert>}
            <Button type="submit" className="w-full" loading={busy} disabled={code.length < 6}>
              확인
            </Button>
          </form>
        </CardBody>
      </Card>
    </div>
  );
}

export default function MfaPage() {
  return (
    <Suspense>
      <MfaForm />
    </Suspense>
  );
}
