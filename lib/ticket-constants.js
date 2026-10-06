export const MAX_TICKET_NUMBER = 500;
export const RESERVATION_DURATION_MS = 6 * 60 * 60 * 1000;

export function isValidTicketNumber(number) {
  return Number.isInteger(number) && number >= 1 && number <= MAX_TICKET_NUMBER;
}

export function isEligibleDrawTicket(ticket, tier) {
  return ticket.status === 'approved'
    && ticket.tier === String(tier)
    && isValidTicketNumber(Number(ticket.number));
}
