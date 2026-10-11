import test from 'node:test';
import assert from 'node:assert/strict';

import { getAvailableWinnerNumbers, getNextDrawPlacement } from './draw-round.js';

test('draw placement advances through the three empty slots', () => {
  assert.equal(getNextDrawPlacement(), 1);
  assert.equal(getNextDrawPlacement({ 1: { winnerNumber: 7 } }), 2);
  assert.equal(getNextDrawPlacement({ 1: {}, 2: {} }), 3);
  assert.equal(getNextDrawPlacement({ 1: {}, 2: {}, 3: {} }), null);
});

test('winner selection excludes every number already used in the round', () => {
  assert.deepEqual(getAvailableWinnerNumbers([1, 2, 3, 4], [2, '4']), [1, 3]);
});