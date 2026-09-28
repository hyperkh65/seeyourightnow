'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { api, errorMessage } from '@/lib/api';
import { afterLogin } from '@/lib/auth-client';
import { Alert, Button, Card, CardBody, Field, Input } from '@/components/ui';

function InviteForm() {
  const sp = useSearchParams();
  const router = useRouter();
  const qc = useQueryClient();
  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const token = sp.get('token') ?? '';
  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      await api.post('/auth/invite/accept', { token, password, ...(name ? { name } : {}) });
      await afterLogin(router, qc, null);
    } catch (e) {
      setError(errorMessage(e));
      setBusy(false);
    }
  };
  return (
    <div className="mx-auto max-w-md px-4 py-16">
      <h1 className="text-center text-2xl font-bold">초대를 수락합니다</h1>
      <p className="mt-2 text-center text-sm text-ink-muted">
        사용할 비밀번호를 정하면 바로 시작할 수 있습니다.
      </p>
      <Card className="mt-8">
        <CardBody>
          {!token ? (
            <Alert tone="danger">초대 링크가 올바르지 않습니다.</Alert>
          ) : (
            <form
              className="space-y-4"
              onSubmit={(e) => {
                e.preventDefault();
                void submit();
              }}
            >
              <Field label="이름" hint="선택">
                <Input value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" />
              </Field>
              <Field label="비밀번호" hint="10자 이상">
                <Input
                  type="password"
                  autoComplete="new-password"
                  minLength={10}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                />
              </Field>
              {error && <Alert tone="danger">{error}</Alert>}
              <Button type="submit" className="w-full" loading={busy}>
                시작하기
              </Button>
            </form>
          )}
        </CardBody>
      </Card>
    </div>
  );
}

export default function InvitePage() {
  return (
    <Suspense>
      <InviteForm />
    </Suspense>
  );
}
