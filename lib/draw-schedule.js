const TIME_ZONE = 'Africa/Addis_Ababa';

function datePartsInAddis(date) {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date);
  return Object.fromEntries(parts.map(({ type, value }) => [type, value]));
}

export function formatAddisDateTimeInput(date) {
  if (!(date instanceof Date) || !Number.isFinite(date.getTime())) return '';
  const parts = datePartsInAddis(date);
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}`;
}

export function parseAddisDateTimeInput(value) {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(String(value || ''));
  if (!match) return null;

  const [, year, month, day, hour, minute] = match.map(Number);
  const targetUtc = Date.UTC(year, month - 1, day, hour, minute);
  const targetDate = new Date(targetUtc);
  if (targetDate.getUTCFullYear() !== year
    || targetDate.getUTCMonth() !== month - 1
    || targetDate.getUTCDate() !== day
    || hour > 23
    || minute > 59) {
    return null;
  }

  let utcMillis = targetUtc;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const parts = datePartsInAddis(new Date(utcMillis));
    const formattedAsUtc = Date.UTC(
      Number(parts.year),
      Number(parts.month) - 1,
      Number(parts.day),
      Number(parts.hour),
      Number(parts.minute),
    );
    const difference = targetUtc - formattedAsUtc;
    if (difference === 0) break;
    utcMillis += difference;
  }

  const parsed = new Date(utcMillis);
  return formatAddisDateTimeInput(parsed) === value ? parsed : null;
}

export function freezeTicketNumbers(tier, tickets) {
  const numbers = tickets
    .map((ticket) => Number(ticket.number))
    .filter((number) => Number.isInteger(number) && number >= 1 && number <= 500)
    .sort((first, second) => first - second);
  const canonicalList = numbers.map((number) => `${tier}-${String(number).padStart(3, '0')}`);
  return { numbers, canonicalList };
}
