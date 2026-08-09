import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const routes = readFileSync('src/routes/project.routes.js', 'utf8');

test('project communication detail is scoped to both project and communication', () => {
  assert.match(routes, /\/:id\/communications\/:communicationId/);
  assert.match(routes, /projectCommunication\.findFirst\(\{[\s\S]*?id: communicationId,[\s\S]*?projectId: id/);
  assert.match(routes, /Communication not found/);
});
