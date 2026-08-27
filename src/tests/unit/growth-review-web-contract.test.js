import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const api = fs.readFileSync('web/src/lib/api.js', 'utf8');
const page = fs.readFileSync('web/src/pages/LeadInbox.jsx', 'utf8');

test('staff API exposes the weekly growth task handoff', () => {
  assert.match(api, /createWeeklyGrowthReviewTask:\s*\(data\)/);
  assert.match(api, /client-acquisition\/leads\/growth-review-task/);
  assert.match(api, /method: 'POST'/);
});

test('inquiry review creates one owned and dated task from the recorded evidence', () => {
  assert.match(page, /Weekly growth action/);
  assert.match(page, /api\.getProjects\(\)/);
  assert.match(page, /api\.getTeam\(\)/);
  assert.match(page, /api\.createWeeklyGrowthReviewTask/);
  assert.match(page, /id="growth-review-project"/);
  assert.match(page, /id="growth-review-owner"/);
  assert.match(page, /id="growth-review-week"/);
  assert.match(page, /id="growth-review-action"/);
  assert.match(page, /id="growth-review-due"/);
  assert.match(page, /id="growth-review-source-coverage"/);
  assert.match(page, /id="growth-review-missing-attribution"/);
  assert.match(page, /id="growth-review-currencies"/);
  assert.match(page, /id="growth-review-external-state"/);
  assert.match(page, /sourceCoverageReviewed: growthReview\.sourceCoverageReviewed/);
  assert.match(page, /Create growth task/);
  assert.match(page, /Internal task only/);
  assert.match(page, /to=\{`\/task\/\$\{growthTask\.id\}`\}/);
});

test('the growth task handoff never presents automatic outreach or publishing as completed', () => {
  assert.doesNotMatch(page, /send.*prospect|publish.*automatically|automatic outreach/i);
  assert.match(page, /does not send outreach, publish content, change ad spend, or call a provider/i);
});
