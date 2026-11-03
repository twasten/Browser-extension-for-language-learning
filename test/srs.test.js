import test from 'node:test';
import assert from 'node:assert/strict';
import { newCard, review, GRADES, isDue, previewIntervals, formatDelay } from '../src/shared/srs.js';

const DAY = 86400000;
const T0 = Date.UTC(2026, 0, 1);

test('new cards are due immediately', () => {
  assert.ok(isDue(newCard(T0), T0));
});

test('good answers grow the interval 1 → 6 → ~15 days', () => {
  let c = newCard(T0);
  c = review(c, GRADES.good, T0);
  assert.equal(c.interval, 1);
  c = review(c, GRADES.good, T0 + DAY);
  assert.equal(c.interval, 6);
  c = review(c, GRADES.good, T0 + 7 * DAY);
  assert.equal(c.interval, 15);
  assert.equal(c.due, T0 + 7 * DAY + 15 * DAY);
});

test('"again" resets the card and lowers ease, not below 1.3', () => {
  let c = { ...newCard(T0), reps: 5, interval: 40, ease: 1.4 };
  c = review(c, GRADES.again, T0);
  assert.equal(c.reps, 0);
  assert.equal(c.interval, 0);
  assert.equal(c.lapses, 1);
  assert.equal(c.ease, 1.3);
  assert.equal(c.due, T0 + 10 * 60000);
});

test('easy > good > hard intervals', () => {
  const base = { ...newCard(T0), reps: 3, interval: 10, ease: 2.5 };
  const hard = review(base, GRADES.hard, T0).interval;
  const good = review(base, GRADES.good, T0).interval;
  const easy = review(base, GRADES.easy, T0).interval;
  assert.ok(hard < good && good < easy, `${hard} ${good} ${easy}`);
});

test('previewIntervals and formatDelay', () => {
  assert.deepEqual(previewIntervals(newCard(T0), T0), { again: '10m', hard: '1d', good: '1d', easy: '4d' });
  assert.equal(formatDelay(90 * DAY), '3mo');
});
