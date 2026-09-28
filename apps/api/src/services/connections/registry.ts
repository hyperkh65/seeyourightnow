import { createHmac, randomBytes } from 'node:crypto';
import type { ConnectionCategory } from '@sos/core';
import { safeFetch } from '../../lib/http.js';

/**
 * Catalogue of every external integration. Each provider documents what it is,
 * where to obtain credentials and whether it is required — shown verbatim in
 * Admin → API 연결. Only real, documented public APIs are implemented; where an
 * official API's exact endpoint depends on a partner agreement the connector
 * is generic and the admin enters the endpoint from their contract documents.
 */

export interface FieldDef {
  key: string;
  label: string;
  type?: 'text' | 'url' | 'number' | 'select' | 'textarea' | 'boolean';
  required?: boolean;
  placeholder?: string;
  help?: string;
  options?: string[];
  default?: string;
}

export interface ConnectionRuntime {
  config: Record<string, unknown>;
  secrets: Record<string, string>;
}

export interface TestResult {
  ok: boolean;
  message: string;
  details?: unknown;
}

export interface ProviderDef {
  provider: string;
  category: ConnectionCategory;
  label: string;
  description: string;
  howToGet: string;
  docsUrl?: string;
  required: 'REQUIRED' | 'RECOMMENDED' | 'OPTIONAL';
  configFields: FieldDef[];
  secretFields: FieldDef[];
  capabilities: string[];
  test(rt: ConnectionRuntime): Promise<TestResult>;
}

const str = (v: unknown, d = '') =>
  typeof v === 'string' ? v : v === undefined || v === null ? d : String(v);

async function httpCheck(url: string, init: RequestInit, okStatuses: number[] = [200]): Promise<TestResult> {
  try {
    const res = await safeFetch(url, { ...init, trusted: true, timeoutMs: 12_000 });
    const text = await res.text().catch(() => '');
    if (okStatuses.includes(res.status)) return { ok: true, message: `연결 성공 (HTTP ${res.status})` };
    return { ok: false, message: `HTTP ${res.status}: ${text.slice(0, 200)}` };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : String(e) };
  }
}

// ─── Signing helpers for real APIs ───

/** Coupang Partners CEA HMAC signature (Open API docs). */
export function coupangAuthorization(
  method: string,
  path: string,
  query: string,
  accessKey: string,
  secretKey: string,
  now = new Date(),
): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  const datetime = `${String(now.getUTCFullYear()).slice(2)}${pad(now.getUTCMonth() + 1)}${pad(now.getUTCDate())}T${pad(now.getUTCHours())}${pad(now.getUTCMinutes())}${pad(now.getUTCSeconds())}Z`;
  const message = datetime + method + path + query;
  const signature = createHmac('sha256', secretKey).update(message).digest('hex');
  return `CEA algorithm=HmacSHA256, access-key=${accessKey}, signed-date=${datetime}, signature=${signature}`;
}

/** 1688 / Alibaba Open Platform (AOP) signature: HMAC-SHA1 over urlPath + sorted key/value pairs, hex upper-case. */
export function aopSignature(urlPath: string, params: Record<string, string>, appSecret: string): string {
  const concatenated = Object.keys(params)
    .sort()
    .map((k) => `${k}${params[k]}`)
    .join('');
  return createHmac('sha1', appSecret)
    .update(urlPath + concatenated)
    .digest('hex')
    .toUpperCase();
}

/** SOLAPI HMAC-SHA256 authorization header. */
export function solapiAuthorization(apiKey: string, apiSecret: string, now = new Date()): string {
  const date = now.toISOString();
  const salt = randomBytes(16).toString('hex');
  const signature = createHmac('sha256', apiSecret)
    .update(date + salt)
    .digest('hex');
  return `HMAC-SHA256 apiKey=${apiKey}, date=${date}, salt=${salt}, signature=${signature}`;
}

export const PROVIDERS: ProviderDef[] = [
  // ─────────── AI ───────────
  {
    provider: 'GROQ',
    category: 'AI',
    label: 'Groq (LLM · Vision)',
    description:
      '제품 설명 구조화, 다국어 검색어 생성, 이미지 이해에 사용하는 기본 AI 제공자입니다. OpenAI 호환 API를 사용합니다.',
    howToGet: 'console.groq.com 에서 가입 후 API Keys 메뉴에서 키를 발급합니다.',
    docsUrl: 'https://console.groq.com/docs',
    required: 'RECOMMENDED',
    configFields: [
      { key: 'baseUrl', label: 'API 주소', type: 'url', default: 'https://api.groq.com/openai/v1' },
      { key: 'textModel', label: '텍스트 모델', default: 'llama-3.3-70b-versatile' },
      {
        key: 'visionModel',
        label: '비전 모델',
        default: 'meta-llama/llama-4-scout-17b-16e-instruct',
        help: '이미지 입력을 지원하는 모델이어야 합니다.',
      },
    ],
    secretFields: [{ key: 'apiKey', label: 'API Key', required: true }],
    capabilities: ['TEXT', 'VISION'],
    test: (rt) =>
      httpCheck(`${str(rt.config.baseUrl, 'https://api.groq.com/openai/v1')}/models`, {
        headers: { Authorization: `Bearer ${rt.secrets.apiKey}` },
      }),
  },
  {
    provider: 'OPENAI_COMPATIBLE',
    category: 'AI',
    label: 'OpenAI 호환 API (OpenAI, vLLM, Ollama 등)',
    description:
      'OpenAI Chat Completions 형식을 지원하는 모든 LLM을 연결합니다. 대체(fallback) 제공자로 쓰기 좋습니다.',
    howToGet:
      '사용하는 제공자의 콘솔에서 API 키와 API 주소를 확인합니다. 자체 호스팅 모델은 서버 주소를 입력합니다.',
    required: 'OPTIONAL',
    configFields: [
      {
        key: 'baseUrl',
        label: 'API 주소',
        type: 'url',
        required: true,
        placeholder: 'https://api.openai.com/v1',
      },
      { key: 'textModel', label: '텍스트 모델', required: true },
      { key: 'visionModel', label: '비전 모델 (선택)' },
    ],
    secretFields: [{ key: 'apiKey', label: 'API Key' }],
    capabilities: ['TEXT', 'VISION'],
    test: (rt) =>
      httpCheck(`${str(rt.config.baseUrl)}/models`, {
        headers: rt.secrets.apiKey ? { Authorization: `Bearer ${rt.secrets.apiKey}` } : {},
      }),
  },
  {
    provider: 'ANTHROPIC',
    category: 'AI',
    label: 'Anthropic Claude',
    description: 'Claude 모델을 텍스트·비전 제공자로 사용합니다.',
    howToGet: 'console.anthropic.com 에서 API 키를 발급합니다.',
    docsUrl: 'https://docs.anthropic.com',
    required: 'OPTIONAL',
    configFields: [
      { key: 'textModel', label: '텍스트 모델', default: 'claude-sonnet-5' },
      { key: 'visionModel', label: '비전 모델', default: 'claude-sonnet-5' },
    ],
    secretFields: [{ key: 'apiKey', label: 'API Key', required: true }],
    capabilities: ['TEXT', 'VISION'],
    test: (rt) =>
      httpCheck('https://api.anthropic.com/v1/models', {
        headers: { 'x-api-key': rt.secrets.apiKey ?? '', 'anthropic-version': '2023-06-01' },
      }),
  },
  {
    provider: 'AI_WORKER',
    category: 'AI',
    label: 'AI 워커 (OCR · 이미지 임베딩 · Florence-2 · 배경 분리)',
    description:
      '자체 호스팅 Python 워커입니다. PaddleOCR(OCR), SigLIP(이미지 유사도), Florence-2(제품 이해), 배경 분리를 담당합니다. 설치된 모델만 사용됩니다.',
    howToGet:
      'docker compose로 ai-worker 서비스를 실행하고 주소와 토큰을 입력합니다. (README의 AI 워커 절 참고)',
    required: 'RECOMMENDED',
    configFields: [
      { key: 'baseUrl', label: '워커 주소', type: 'url', required: true, default: 'http://ai-worker:8000' },
    ],
    secretFields: [{ key: 'token', label: '워커 토큰' }],
    capabilities: ['OCR', 'EMBEDDING', 'CAPTION', 'SEGMENT'],
    test: async (rt) => {
      const r = await httpCheck(`${str(rt.config.baseUrl)}/health`, {
        headers: { Authorization: `Bearer ${rt.secrets.token ?? ''}` },
      });
      if (!r.ok) return r;
      try {
        const res = await safeFetch(`${str(rt.config.baseUrl)}/capabilities`, {
          trusted: true,
          headers: { Authorization: `Bearer ${rt.secrets.token ?? ''}` },
        });
        const caps = await res.json();
        return { ok: true, message: '연결 성공', details: caps };
      } catch {
        return r;
      }
    },
  },

  // ─────────── Supply-side marketplaces ───────────
  {
    provider: 'ALIBABA_1688_OPEN',
    category: 'MARKETPLACE',
    label: '1688 Open Platform (阿里巴巴开放平台)',
    description:
      '1688 공식 오픈 플랫폼 API로 상품 상세·가격·MOQ를 조회합니다. 사용 가능한 API는 앱 심사 시 승인된 범위로 제한됩니다.',
    howToGet:
      'open.1688.com 에서 개발자 등록 → 앱 생성 → AppKey/AppSecret 발급 → 필요한 API 권한 신청 및 판매자/구매자 계정 인증(access_token).',
    docsUrl: 'https://open.1688.com',
    required: 'OPTIONAL',
    configFields: [
      { key: 'gateway', label: '게이트웨이', type: 'url', default: 'https://gw.open.1688.com/openapi' },
      {
        key: 'productGetApi',
        label: '상품 조회 API (namespace/name/version)',
        placeholder: 'param2/1/com.alibaba.product/alibaba.product.get',
        help: '앱에 승인된 상품 조회 API 경로를 입력합니다.',
      },
      { key: 'searchApi', label: '상품 검색 API (승인된 경우)', placeholder: '승인받은 검색 API 경로' },
    ],
    secretFields: [
      { key: 'appKey', label: 'AppKey', required: true },
      { key: 'appSecret', label: 'AppSecret', required: true },
      { key: 'accessToken', label: 'access_token' },
    ],
    capabilities: ['PRODUCT_SOURCE'],
    test: async (rt) => {
      if (!rt.secrets.appKey || !rt.secrets.appSecret)
        return { ok: false, message: 'AppKey/AppSecret을 입력하세요.' };
      if (!str(rt.config.productGetApi))
        return {
          ok: false,
          message:
            '자격 증명은 저장되었습니다. 실제 호출 검증을 위해 승인된 상품 조회 API 경로를 입력하세요.',
        };
      return { ok: true, message: '서명 설정이 완료되었습니다. 첫 상품 조회 시 실제 응답으로 검증됩니다.' };
    },
  },
  {
    provider: 'GENERIC_HTTP_SOURCE',
    category: 'MARKETPLACE',
    label: '범용 상품 데이터 API (JSON)',
    description:
      '계약한 상품 데이터 제공 업체(1688·Taobao·Alibaba·Yiwugo·Made-in-China 데이터 API 등)의 JSON 검색 API를 필드 매핑만으로 연결합니다.',
    howToGet:
      '데이터 제공 업체의 검색 API 주소, 인증 헤더, 응답 필드 경로를 계약 문서에서 확인해 입력합니다. 이용약관과 재판매 가능 여부를 반드시 확인하세요.',
    required: 'OPTIONAL',
    configFields: [
      { key: 'marketName', label: '마켓 이름', required: true, placeholder: '1688 / Alibaba / Yiwugo ...' },
      {
        key: 'searchUrl',
        label: '검색 URL 템플릿',
        type: 'url',
        required: true,
        placeholder: 'https://api.example.com/search?q={query}&page=1',
      },
      { key: 'authHeader', label: '인증 헤더 이름', placeholder: 'Authorization' },
      { key: 'authPrefix', label: '인증 값 접두사', placeholder: 'Bearer ' },
      { key: 'itemsPath', label: '결과 배열 경로', required: true, placeholder: 'data.items' },
      {
        key: 'map',
        label: '필드 매핑 (JSON)',
        type: 'textarea',
        required: true,
        placeholder:
          '{"externalId":"id","title":"title","price":"price","currency":"CNY","moq":"moq","url":"url","image":"image","seller":"shop.name"}',
      },
    ],
    secretFields: [{ key: 'apiKey', label: 'API Key' }],
    capabilities: ['PRODUCT_SOURCE'],
    test: async (rt) => {
      const { genericSearch } = await import('../connectors/generic-http.js');
      try {
        const items = await genericSearch(rt, 'test', 3);
        return { ok: true, message: `연결 성공 · 결과 ${items.length}건` };
      } catch (e) {
        return { ok: false, message: e instanceof Error ? e.message : String(e) };
      }
    },
  },

  // ─────────── Domestic market (Korea) ───────────
  {
    provider: 'NAVER_SHOPPING',
    category: 'DOMESTIC_MARKET',
    label: '네이버 쇼핑 검색 API',
    description: '네이버 개발자센터 공식 검색 API로 국내 판매가격·판매처·카테고리를 조회합니다.',
    howToGet: 'developers.naver.com → 애플리케이션 등록 → 사용 API에 "검색" 추가 → Client ID/Secret 발급.',
    docsUrl: 'https://developers.naver.com/docs/serviceapi/search/shopping/shopping.md',
    required: 'RECOMMENDED',
    configFields: [],
    secretFields: [
      { key: 'clientId', label: 'Client ID', required: true },
      { key: 'clientSecret', label: 'Client Secret', required: true },
    ],
    capabilities: ['MARKET_SEARCH'],
    test: (rt) =>
      httpCheck('https://openapi.naver.com/v1/search/shop.json?query=%EC%84%A0%ED%92%8D%EA%B8%B0&display=1', {
        headers: {
          'X-Naver-Client-Id': rt.secrets.clientId ?? '',
          'X-Naver-Client-Secret': rt.secrets.clientSecret ?? '',
        },
      }),
  },
  {
    provider: 'COUPANG_PARTNERS',
    category: 'DOMESTIC_MARKET',
    label: '쿠팡 파트너스 Open API',
    description:
      '쿠팡 파트너스 상품 검색 API로 쿠팡 판매가격을 조회합니다. 파트너스 이용 약관 범위 내에서만 사용하세요.',
    howToGet: 'partners.coupang.com 가입 → 최종 승인 후 Open API 메뉴에서 Access Key/Secret Key 발급.',
    docsUrl: 'https://partners.coupang.com',
    required: 'OPTIONAL',
    configFields: [],
    secretFields: [
      { key: 'accessKey', label: 'Access Key', required: true },
      { key: 'secretKey', label: 'Secret Key', required: true },
    ],
    capabilities: ['MARKET_SEARCH'],
    test: async (rt) => {
      const path = '/v2/providers/affiliate_open_api/apis/openapi/products/search';
      const query = `keyword=${encodeURIComponent('선풍기')}&limit=1`;
      return httpCheck(`https://api-gateway.coupang.com${path}?${query}`, {
        headers: {
          Authorization: coupangAuthorization(
            'GET',
            path,
            query,
            rt.secrets.accessKey ?? '',
            rt.secrets.secretKey ?? '',
          ),
        },
      });
    },
  },
  {
    provider: 'ELEVENST_OPENAPI',
    category: 'DOMESTIC_MARKET',
    label: '11번가 Open API',
    description: '11번가 오픈 API 상품 검색(ProductSearch)으로 판매가격을 조회합니다.',
    howToGet: 'openapi.11st.co.kr 에서 회원가입 후 API Key를 발급합니다.',
    docsUrl: 'https://openapi.11st.co.kr',
    required: 'OPTIONAL',
    configFields: [],
    secretFields: [{ key: 'apiKey', label: 'API Key', required: true }],
    capabilities: ['MARKET_SEARCH'],
    test: (rt) =>
      httpCheck(
        `http://openapi.11st.co.kr/openapi/OpenApiService.tmall?key=${encodeURIComponent(rt.secrets.apiKey ?? '')}&apiCode=ProductSearch&keyword=${encodeURIComponent('선풍기')}&pageSize=1`,
        {},
      ),
  },
  {
    provider: 'GENERIC_HTTP_MARKET',
    category: 'DOMESTIC_MARKET',
    label: '범용 국내시장 데이터 API (JSON)',
    description:
      'G마켓, 무신사, 토스 등 공개 API가 없는 채널은 제휴·파트너 데이터 제공처의 JSON API를 필드 매핑으로 연결합니다.',
    howToGet: '제휴 계약 또는 데이터 제공 업체의 API 문서에서 주소와 응답 형식을 확인합니다.',
    required: 'OPTIONAL',
    configFields: [
      { key: 'marketName', label: '채널 이름', required: true, placeholder: 'GMARKET / MUSINSA / TOSS ...' },
      { key: 'searchUrl', label: '검색 URL 템플릿', type: 'url', required: true },
      { key: 'authHeader', label: '인증 헤더 이름' },
      { key: 'authPrefix', label: '인증 값 접두사' },
      { key: 'itemsPath', label: '결과 배열 경로', required: true },
      {
        key: 'map',
        label: '필드 매핑 (JSON)',
        type: 'textarea',
        required: true,
        placeholder:
          '{"externalId":"id","title":"name","price":"salePrice","url":"link","image":"img","seller":"mall","reviews":"reviewCount","rating":"rating"}',
      },
    ],
    secretFields: [{ key: 'apiKey', label: 'API Key' }],
    capabilities: ['MARKET_SEARCH'],
    test: async (rt) => {
      const { genericSearch } = await import('../connectors/generic-http.js');
      try {
        const items = await genericSearch(rt, '선풍기', 3);
        return { ok: true, message: `연결 성공 · 결과 ${items.length}건` };
      } catch (e) {
        return { ok: false, message: e instanceof Error ? e.message : String(e) };
      }
    },
  },

  // ─────────── Shipping ───────────
  {
    provider: 'DCSA_TNT',
    category: 'SHIPPING',
    label: '선사 Track & Trace (DCSA 표준)',
    description:
      'DCSA Track & Trace 표준을 지원하는 선사 API로 컨테이너·B/L 이벤트를 수집합니다. 선사별로 1개씩 등록합니다.',
    howToGet:
      '이용하는 선사(예: Maersk, Hapag-Lloyd, ONE, CMA CGM 등)의 개발자 포털에서 Track & Trace API 접근을 신청합니다.',
    docsUrl: 'https://dcsa.org/standards/track-and-trace',
    required: 'OPTIONAL',
    configFields: [
      { key: 'carrierCode', label: '선사 코드 (SCAC)', required: true, placeholder: 'MAEU' },
      {
        key: 'baseUrl',
        label: 'T&T API 기본 주소',
        type: 'url',
        required: true,
        placeholder: '선사 포털에 안내된 주소',
      },
      { key: 'apiKeyHeader', label: 'API Key 헤더 이름', default: 'Consumer-Key' },
      { key: 'eventsPath', label: '이벤트 경로', default: '/events' },
    ],
    secretFields: [{ key: 'apiKey', label: 'API Key', required: true }],
    capabilities: ['CONTAINER_TRACKING'],
    test: (rt) =>
      httpCheck(
        `${str(rt.config.baseUrl)}${str(rt.config.eventsPath, '/events')}?limit=1`,
        { headers: { [str(rt.config.apiKeyHeader, 'Consumer-Key')]: rt.secrets.apiKey ?? '' } },
        [200, 400, 404],
      ),
  },
  {
    provider: 'AISSTREAM',
    category: 'SHIPPING',
    label: 'AISStream (선박 실시간 위치)',
    description:
      '선박 MMSI 기준 실시간 AIS 위치를 수신합니다. AIS가 없거나 끊기면 마지막 위치와 경과 시간을 표시합니다.',
    howToGet: 'aisstream.io 에서 GitHub 계정으로 로그인 후 API Key를 발급합니다.',
    docsUrl: 'https://aisstream.io/documentation',
    required: 'OPTIONAL',
    configFields: [],
    secretFields: [{ key: 'apiKey', label: 'API Key', required: true }],
    capabilities: ['AIS'],
    test: async (rt) => {
      const { testAisStream } = await import('../connectors/ais.js');
      return testAisStream(rt.secrets.apiKey ?? '');
    },
  },

  // ─────────── Government / customs / FX ───────────
  {
    provider: 'KOREAEXIM_FX',
    category: 'GOVERNMENT',
    label: '한국수출입은행 환율 API',
    description: '매 영업일 고시 환율(매매기준율)을 가져와 원가 계산 기준일 환율로 저장합니다.',
    howToGet: 'koreaexim.go.kr → Open API → 인증키 발급.',
    docsUrl: 'https://www.koreaexim.go.kr/ir/HPHKIR020M01',
    required: 'RECOMMENDED',
    configFields: [],
    secretFields: [{ key: 'authKey', label: '인증키', required: true }],
    capabilities: ['FX'],
    test: (rt) =>
      httpCheck(
        `https://oapi.koreaexim.go.kr/site/program/financial/exchangeJSON?authkey=${encodeURIComponent(rt.secrets.authKey ?? '')}&data=AP01`,
        {},
      ),
  },
  {
    provider: 'UNIPASS',
    category: 'CUSTOMS',
    label: '관세청 UNI-PASS Open API',
    description:
      '관세청 UNI-PASS 공개 API(화물통관 진행정보 등)를 연결합니다. API별 인증키가 따로 발급됩니다.',
    howToGet: 'unipass.customs.go.kr → 공개 API 신청 → 사용할 API별 인증키 발급 후 API 주소를 입력합니다.',
    docsUrl: 'https://unipass.customs.go.kr',
    required: 'OPTIONAL',
    configFields: [
      {
        key: 'cargoProgressUrl',
        label: '화물통관 진행정보 API 주소',
        type: 'url',
        placeholder: '발급 안내 문서의 요청 주소',
      },
      { key: 'tariffUrl', label: '관세율 조회 API 주소 (선택)', type: 'url' },
    ],
    secretFields: [
      { key: 'cargoKey', label: '화물통관 API 인증키' },
      { key: 'tariffKey', label: '관세율 API 인증키' },
    ],
    capabilities: ['CUSTOMS_TRACKING', 'TARIFF'],
    test: async (rt) => {
      const url = str(rt.config.cargoProgressUrl);
      if (!url) return { ok: false, message: 'API 주소를 입력하세요.' };
      return httpCheck(
        `${url}${url.includes('?') ? '&' : '?'}crkyCn=${encodeURIComponent(rt.secrets.cargoKey ?? '')}`,
        {},
        [200],
      );
    },
  },

  // ─────────── Messaging ───────────
  {
    provider: 'SMTP',
    category: 'EMAIL',
    label: 'SMTP 메일 발송',
    description:
      '고객 알림 메일을 회사 도메인으로 발송합니다. 설정하지 않으면 시스템 기본 발송 서버를 사용합니다.',
    howToGet: '메일 서비스(Google Workspace, 네이버웍스, Amazon SES, SendGrid 등)의 SMTP 정보를 입력합니다.',
    required: 'RECOMMENDED',
    configFields: [
      { key: 'host', label: 'SMTP 서버', required: true },
      { key: 'port', label: '포트', type: 'number', default: '587' },
      { key: 'secure', label: 'SSL(465)', type: 'boolean' },
      { key: 'user', label: '사용자' },
      { key: 'fromEmail', label: '보내는 주소', required: true },
      { key: 'fromName', label: '보내는 이름' },
    ],
    secretFields: [{ key: 'password', label: '비밀번호' }],
    capabilities: ['EMAIL'],
    test: async (rt) => {
      const nodemailer = await import('nodemailer');
      try {
        const t = nodemailer.createTransport({
          host: str(rt.config.host),
          port: Number(rt.config.port ?? 587),
          secure: !!rt.config.secure,
          auth: rt.config.user ? { user: str(rt.config.user), pass: rt.secrets.password ?? '' } : undefined,
        });
        await t.verify();
        return { ok: true, message: 'SMTP 연결 성공' };
      } catch (e) {
        return { ok: false, message: e instanceof Error ? e.message : String(e) };
      }
    },
  },
  {
    provider: 'SOLAPI',
    category: 'SMS',
    label: 'SOLAPI (SMS · 카카오 알림톡)',
    description:
      '문자와 카카오 알림톡을 발송합니다. 알림톡은 카카오 비즈니스 채널과 승인된 템플릿이 필요합니다.',
    howToGet:
      'solapi.com 가입 → API Key 관리에서 키 발급 → 발신번호 등록 → (알림톡) 채널 연동 및 템플릿 승인.',
    docsUrl: 'https://developers.solapi.com',
    required: 'OPTIONAL',
    configFields: [
      { key: 'sender', label: '발신번호', required: true },
      { key: 'kakaoPfId', label: '카카오 채널 pfId (알림톡)' },
    ],
    secretFields: [
      { key: 'apiKey', label: 'API Key', required: true },
      { key: 'apiSecret', label: 'API Secret', required: true },
    ],
    capabilities: ['SMS', 'KAKAO'],
    test: (rt) =>
      httpCheck('https://api.solapi.com/cash/v1/balance', {
        headers: { Authorization: solapiAuthorization(rt.secrets.apiKey ?? '', rt.secrets.apiSecret ?? '') },
      }),
  },
  {
    provider: 'SLACK',
    category: 'MESSAGING',
    label: 'Slack (내부 알림)',
    description: '예외 상황(지연, 승인 대기, 오류)을 Slack 채널로 알립니다.',
    howToGet: 'Slack 앱 설정 → Incoming Webhooks 활성화 → 채널을 선택해 Webhook URL을 발급합니다.',
    required: 'OPTIONAL',
    configFields: [],
    secretFields: [{ key: 'webhookUrl', label: 'Webhook URL', required: true }],
    capabilities: ['SLACK'],
    test: (rt) =>
      httpCheck(rt.secrets.webhookUrl ?? '', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: '연결 테스트 메시지입니다.' }),
      }),
  },

  // ─────────── Payment ───────────
  {
    provider: 'TOSS_PAYMENTS',
    category: 'PAYMENT',
    label: '토스페이먼츠',
    description: '카드·간편결제 결제 확인에 사용합니다. 무역 거래는 대부분 계좌이체이므로 선택 사항입니다.',
    howToGet: '토스페이먼츠 개발자센터에서 시크릿 키를 확인합니다.',
    docsUrl: 'https://docs.tosspayments.com',
    required: 'OPTIONAL',
    configFields: [],
    secretFields: [{ key: 'secretKey', label: '시크릿 키', required: true }],
    capabilities: ['PAYMENT'],
    test: async (rt) => {
      // A non-existent payment key returns 404 for valid credentials and 401 for invalid ones.
      const r = await httpCheck(
        'https://api.tosspayments.com/v1/payments/sos-connection-test',
        {
          headers: {
            Authorization: `Basic ${Buffer.from(`${rt.secrets.secretKey ?? ''}:`).toString('base64')}`,
          },
        },
        [404],
      );
      return r.ok ? { ok: true, message: '인증 성공 (시크릿 키 확인됨)' } : r;
    },
  },

  // ─────────── Analytics ───────────
  {
    provider: 'GA4',
    category: 'ANALYTICS',
    label: 'Google Analytics 4',
    description:
      '공개 홈페이지 방문 분석을 위해 측정 ID를 삽입합니다. 로그인 이후 화면에는 삽입하지 않습니다.',
    howToGet: 'analytics.google.com → 관리 → 데이터 스트림 → 측정 ID(G-XXXX).',
    required: 'OPTIONAL',
    configFields: [{ key: 'measurementId', label: '측정 ID', required: true, placeholder: 'G-XXXXXXX' }],
    secretFields: [],
    capabilities: ['ANALYTICS'],
    test: async (rt) =>
      /^G-[A-Z0-9]+$/.test(str(rt.config.measurementId))
        ? { ok: true, message: '형식 확인 완료' }
        : { ok: false, message: 'G-로 시작하는 측정 ID를 입력하세요.' },
  },
];

export function providerDef(provider: string): ProviderDef | undefined {
  return PROVIDERS.find((p) => p.provider === provider);
}

/** Public-safe description of a provider (no functions). */
export function describeProvider(p: ProviderDef) {
  const { test: _t, ...rest } = p;
  return rest;
}
