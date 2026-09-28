import cookie from '@fastify/cookie';
import helmet from '@fastify/helmet';
import multipart from '@fastify/multipart';
import rateLimit from '@fastify/rate-limit';
import swagger from '@fastify/swagger';
import swaggerUi from '@fastify/swagger-ui';
import Fastify, { type FastifyBaseLogger, type FastifyError } from 'fastify';
import { jsonSchemaTransform, serializerCompiler, validatorCompiler, type ZodTypeProvider } from 'fastify-type-provider-zod';
import { randomUUID } from 'node:crypto';
import { ZodError } from 'zod';
import { config } from './config.js';
import { AppError } from './lib/errors.js';
import { logger } from './lib/logger.js';
import { getRedis } from './lib/cache.js';
import { registerContext } from './http/plugins.js';
import type { App } from './http/types.js';
import { registerRoutes } from './modules/index.js';

export async function buildApp(): Promise<App> {
  const app = Fastify({
    loggerInstance: logger as unknown as FastifyBaseLogger,
    trustProxy: config.TRUST_PROXY || config.NODE_ENV !== 'production',
    bodyLimit: 2 * 1024 * 1024,
    genReqId: () => randomUUID(),
    disableRequestLogging: config.NODE_ENV === 'test',
  }).withTypeProvider<ZodTypeProvider>();

  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);

  await app.register(cookie);
  await app.register(helmet, {
    contentSecurityPolicy: { directives: { defaultSrc: ["'none'"], frameAncestors: ["'none'"], imgSrc: ["'self'", 'data:'], styleSrc: ["'self'", "'unsafe-inline'"], scriptSrc: ["'self'", "'unsafe-inline'"] } },
    crossOriginResourcePolicy: { policy: 'same-origin' },
    hsts: config.NODE_ENV === 'production' ? { maxAge: 31536000, includeSubDomains: true } : false,
  });
  await app.register(rateLimit, {
    global: true,
    max: config.NODE_ENV === 'test' ? 100000 : 600,
    timeWindow: '1 minute',
    redis: getRedis() ?? undefined,
    keyGenerator: (req) => req.ip,
    errorResponseBuilder: (_req, ctx) => ({ statusCode: 429, error: 'RATE_LIMITED', code: 'RATE_LIMITED', message: `요청이 너무 많습니다. ${Math.ceil(ctx.ttl / 1000)}초 후 다시 시도해 주세요.` }),
  });
  await app.register(multipart, { limits: { fileSize: config.UPLOAD_MAX_MB * 1024 * 1024, files: 10, fields: 40 } });

  await app.register(swagger, {
    openapi: {
      info: { title: 'Sourcing OS API', version: '1.0.0', description: 'White-label AI Sourcing OS — REST API v1. Tenant context is resolved server-side from the request host.' },
      components: { securitySchemes: { cookieAuth: { type: 'apiKey', in: 'cookie', name: 'sos_session' } } },
    },
    transform: jsonSchemaTransform,
  });
  if (config.NODE_ENV !== 'production' || config.DEV_MODE) {
    await app.register(swaggerUi, { routePrefix: '/api/docs' });
  }

  await registerContext(app);

  app.setErrorHandler((err: FastifyError | Error, req, reply) => {
    const requestId = req.ctx?.requestId ?? req.id;
    if (err instanceof AppError) {
      return reply.status(err.status).send({ code: err.code, message: err.message, details: err.details ?? null, requestId });
    }
    if (err instanceof ZodError || (err as FastifyError).validation) {
      const details = err instanceof ZodError ? err.flatten() : (err as FastifyError).validation;
      return reply.status(400).send({ code: 'VALIDATION_ERROR', message: '입력값을 확인해 주세요.', details, requestId });
    }
    const fe = err as FastifyError & { code?: string };
    if (fe.statusCode === 429) return reply.status(429).send({ code: 'RATE_LIMITED', message: fe.message, requestId });
    if (fe.statusCode === 413 || fe.code === 'FST_REQ_FILE_TOO_LARGE') return reply.status(413).send({ code: 'FILE_TOO_LARGE', message: `파일은 ${config.UPLOAD_MAX_MB}MB 이하만 올릴 수 있습니다.`, requestId });
    // Postgres errors
    if (fe.code === '23505') return reply.status(409).send({ code: 'DUPLICATE', message: '이미 존재하는 항목입니다.', requestId });
    if (fe.code === '23514') return reply.status(409).send({ code: 'CONSTRAINT', message: '변경할 수 없는 상태입니다.', requestId });
    if (fe.code === '42501') {
      req.log.error({ err, requestId }, 'row level security violation');
      return reply.status(403).send({ code: 'FORBIDDEN', message: '권한이 없습니다.', requestId });
    }
    if (fe.statusCode && fe.statusCode < 500) return reply.status(fe.statusCode).send({ code: fe.code ?? 'ERROR', message: fe.message, requestId });
    req.log.error({ err, requestId }, 'unhandled error');
    return reply.status(500).send({ code: 'INTERNAL', message: '일시적인 오류가 발생했습니다. 잠시 후 다시 시도해 주세요.', requestId });
  });

  app.setNotFoundHandler((req, reply) => reply.status(404).send({ code: 'NOT_FOUND', message: '요청한 API를 찾을 수 없습니다.', requestId: req.ctx?.requestId }));

  await app.register(async (api) => registerRoutes(api as unknown as App), { prefix: '/api/v1' });
  return app;
}
