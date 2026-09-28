import { redirect } from 'next/navigation';
import { HomeSections } from '@/components/site/home-sections';
import { getSite } from '@/lib/server';

export default async function HomePage({ searchParams }: { searchParams: Promise<{ preview?: string }> }) {
  const { preview } = await searchParams;
  const site = await getSite(preview);
  if (site?.platform) redirect('/platform');
  if (!site) {
    return (
      <div className="mx-auto max-w-lg px-6 py-24 text-center">
        <h1 className="text-xl font-bold">사이트를 찾을 수 없습니다</h1>
        <p className="mt-2 text-sm text-ink-muted">주소를 다시 확인해 주세요. 등록되지 않은 도메인이거나 서비스가 일시 중지되었을 수 있습니다.</p>
      </div>
    );
  }
  return <HomeSections site={site} />;
}
