import test from 'node:test';
import assert from 'node:assert/strict';

import { formatAddisDateTimeInput, freezeTicketNumbers, parseAddisDateTimeInput } from './draw-schedule.js';

test('Addis date-time values round-trip using the Ethiopia time zone', () => {
  const localInput = '2026-10-07T20:15';
  const parsed = parseAddisDateTimeInput(localInput);

  assert.equal(parsed?.toISOString(), '2026-10-07T17:15:00.000Z');
  assert.equal(formatAddisDateTimeInput(parsed), localInput);
});

test('invalid Addis date-time input is rejected', () => {
  assert.equal(parseAddisDateTimeInput('2026-02-30T20:15'), null);
  assert.equal(parseAddisDateTimeInput('not-a-date'), null);
});

test('ticket freeze sorts valid ticket numbers and ignores invalid values', () => {
  assert.deepEqual(freezeTicketNumbers(50, [
    { number: '010' },
    { number: '002' },
    { number: '501' },
    { number: 'bad' },
  ]), {
    numbers: [2, 10],
    canonicalList: ['50-002', '50-010'],
  });
});
