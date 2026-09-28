import type { Metadata } from 'next';
import { SearchBox } from '@/components/site/search-box';

export const metadata: Metadata = { title: '제품 찾기' };

export default function SearchPage() {
  return (
    <div className="mx-auto max-w-6xl px-4 py-12 sm:px-6 sm:py-20">
      <div className="mb-8 text-center">
        <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">어떤 제품을 찾으세요?</h1>
        <p className="mt-2 text-sm text-ink-muted sm:text-base">사진 한 장이면 충분합니다. 공급처, 예상 도착가격, 필요한 인증을 정리해 드립니다.</p>
      </div>
      <SearchBox autoFocus />
    </div>
  );
}
