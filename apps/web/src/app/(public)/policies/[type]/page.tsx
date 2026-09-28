import { notFound } from 'next/navigation';
import { serverApi } from '@/lib/server';
import { formatDate } from '@/lib/utils';

interface Policy {
  type: string;
  title: string;
  body: string;
  version: number;
  publishedAt: string | null;
}

export default async function PolicyPage({ params }: { params: Promise<{ type: string }> }) {
  const { type } = await params;
  const p = await serverApi<Policy>(`/public/policies/${encodeURIComponent(type.toUpperCase())}`);
  if (!p) notFound();
  return (
    <article className="mx-auto max-w-3xl px-4 py-12 sm:px-6">
      <h1 className="text-2xl font-bold tracking-tight">{p.title}</h1>
      <p className="mt-1 text-xs text-ink-muted">
        버전 {p.version} · 시행 {formatDate(p.publishedAt)}
      </p>
      <div className="mt-8 whitespace-pre-line text-[15px] leading-relaxed text-ink-soft">{p.body}</div>
    </article>
  );
}
