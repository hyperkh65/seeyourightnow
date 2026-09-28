export class AppError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = 'AppError';
  }
}

export const badRequest = (message: string, details?: unknown) =>
  new AppError(400, 'BAD_REQUEST', message, details);
export const unauthorized = (message = '로그인이 필요합니다.') => new AppError(401, 'UNAUTHORIZED', message);
export const forbidden = (message = '권한이 없습니다.') => new AppError(403, 'FORBIDDEN', message);
export const notFound = (message = '찾을 수 없습니다.') => new AppError(404, 'NOT_FOUND', message);
export const conflict = (message: string, details?: unknown) =>
  new AppError(409, 'CONFLICT', message, details);
export const stepUpRequired = () =>
  new AppError(403, 'STEP_UP_REQUIRED', '보안을 위해 본인 확인이 다시 필요합니다.');
export const mfaRequired = () => new AppError(403, 'MFA_REQUIRED', '2단계 인증이 필요합니다.');
export const featureDisabled = (module: string) =>
  new AppError(403, 'FEATURE_DISABLED', `이 기능(${module})은 현재 요금제에서 사용할 수 없습니다.`);
export const limitExceeded = (metric: string) =>
  new AppError(429, 'LIMIT_EXCEEDED', `사용 한도를 초과했습니다: ${metric}`);
