import test from 'node:test';
import assert from 'node:assert/strict';

import {
  isEligibleDrawTicket,
  isValidTicketNumber,
  MAX_TICKET_NUMBER,
  RESERVATION_DURATION_MS,
} from './ticket-constants.js';

test('new ticket reservations last six hours', () => {
  assert.equal(RESERVATION_DURATION_MS, 6 * 60 * 60 * 1000);
});

test('ticket numbers are limited to the range 1 through 500', () => {
  assert.equal(MAX_TICKET_NUMBER, 500);
  assert.equal(isValidTicketNumber(1), true);
  assert.equal(isValidTicketNumber(500), true);
  assert.equal(isValidTicketNumber(0), false);
  assert.equal(isValidTicketNumber(501), false);
  assert.equal(isValidTicketNumber(1.5), false);
});

test('only approved tickets in the selected category and number range enter the draw', () => {
  assert.equal(isEligibleDrawTicket({ status: 'approved', tier: '100', number: '500' }, 100), true);
  assert.equal(isEligibleDrawTicket({ status: 'approved', tier: 100, number: '007' }, 100), true);
  assert.equal(isEligibleDrawTicket({ status: 'pending', tier: '100', number: '001' }, 100), false);
  assert.equal(isEligibleDrawTicket({ status: 'approved', tier: '200', number: '001' }, 100), false);
  assert.equal(isEligibleDrawTicket({ status: 'approved', tier: '100', number: '501' }, 100), false);
});
