// H2 (security audit at 8687cf9): the sanitising error handler must apply to
// every route plugin. It used to be registered after the routes, so the
// encapsulated route plugins kept Fastify's default handler and sent raw
// Prisma invocation messages (model names, arguments, organization ids) to
// clients on 500s.
import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';

// A database that refuses every connection, so real routes raise real Prisma
// errors deterministically (with or without a local database).
process.env.DATABASE_URL = 'postgresql://nobody:nothing@127.0.0.1:1/unreachable?connect_timeout=1';

const { buildApp } = await import('../../index.js');
const { clientErrorStatus, toClientErrorBody } = await import('../../utils/http-errors.js');

function assertSanitized500(response) {
  assert.equal(response.statusCode, 500, response.body);
  const body = response.json();
  assert.deepEqual(Object.keys(body).sort(), ['error', 'message', 'statusCode', 'traceId']);
  assert.equal(body.error, 'InternalServerError');
  assert.equal(body.message, 'An unexpected error occurred');
  assert.doesNotMatch(response.body, /prisma|invocation|findUnique|findFirst|where|organizationId|postgres/i);
}

describe('route plugins use the sanitising error handler', () => {
  let app;
  before(async () => {
    app = await buildApp({ initializeRuntime: false, jwtSecret: 'error-handler-test-secret-0123456789' });
    await app.ready();
  });
  after(async () => app?.close());

  it('a public portal route whose query fails returns the sanitised 500 body', async () => {
    assertSanitized500(await app.inject({ method: 'GET', url: '/api/portal/some-project-token' }));
  });

  it('a public estimate route whose query fails returns the sanitised 500 body', async () => {
    assertSanitized500(await app.inject({ method: 'GET', url: '/api/estimates/view/some-view-token' }));
  });

  it('a client-portal route whose query fails returns the sanitised 500 body', async () => {
    assertSanitized500(await app.inject({
      method: 'POST', url: '/api/client-portal/request-access', payload: { email: 'someone@example.test' },
    }));
  });

  it('keeps intended 4xx messages (JSON body errors)', async () => {
    const response = await app.inject({
      method: 'POST', url: '/api/auth/login', headers: { 'content-type': 'application/json' }, payload: '{"email":',
    });
    assert.equal(response.statusCode, 400);
    assert.equal(response.json().statusCode, 400);
    assert.equal(response.json().error, 'Bad Request');
  });
});

describe('error body mapping', () => {
  it('a tenancy refusal never names the organization, model or record', () => {
    const error = new Error('Tenancy Error: project cm_project_1 does not belong to organization org_secret_42');
    const body = toClientErrorBody(error, { traceId: 't1' });
    assert.equal(clientErrorStatus(error), 500);
    assert.doesNotMatch(JSON.stringify(body), /org_secret_42|cm_project_1|Tenancy|project/);

    const ownership = Object.assign(new Error('Tenancy Error: project cm_project_1 does not belong to organization org_secret_42'), { name: 'TenancyError', statusCode: 404 });
    const notFound = toClientErrorBody(ownership, { traceId: 't2' });
    assert.equal(clientErrorStatus(ownership), 404);
    assert.deepEqual(notFound, { error: 'Not Found', code: 'NOT_FOUND', message: 'Resource not found', statusCode: 404, traceId: 't2' });
  });

  it('a unique conflict on user.email is a generic 409 that does not enable enumeration', () => {
    const conflict = Object.assign(new Error('Unique constraint failed on the fields: (`email`)'), {
      name: 'PrismaClientKnownRequestError', code: 'P2002', meta: { modelName: 'User', target: ['email'] },
    });
    assert.equal(clientErrorStatus(conflict), 409);
    const body = toClientErrorBody(conflict, { traceId: 't3' });
    assert.deepEqual(body, { error: 'Conflict', code: 'CONFLICT', message: 'The request conflicts with existing data', statusCode: 409, traceId: 't3' });
    assert.doesNotMatch(JSON.stringify(body), /email|User|P2002/);
  });

  it('other Prisma errors are opaque 500s even outside production', () => {
    const previous = process.env.NODE_ENV;
    process.env.NODE_ENV = 'development';
    try {
      const error = Object.assign(new Error('Invalid `prisma.invoice.findMany()` invocation: where organizationId org_9'), { name: 'PrismaClientValidationError' });
      const body = toClientErrorBody(error);
      assert.equal(body.statusCode, 500);
      assert.equal(body.detail, undefined);
      assert.doesNotMatch(JSON.stringify(body), /invoice|org_9/);
    } finally {
      process.env.NODE_ENV = previous;
    }
  });

  it('application 4xx messages are kept', () => {
    const error = Object.assign(new Error('Trashed item not found'), { statusCode: 404 });
    assert.deepEqual(toClientErrorBody(error), { error: 'Not Found', message: 'Trashed item not found', statusCode: 404 });
  });
});
