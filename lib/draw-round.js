export const DRAW_PLACEMENTS = [1, 2, 3];

export function getNextDrawPlacement(placements = {}) {
  return DRAW_PLACEMENTS.find((placement) => !placements[String(placement)]) ?? null;
}

export function getAvailableWinnerNumbers(numbers, usedWinnerNumbers = []) {
  const usedNumbers = new Set(usedWinnerNumbers.map(Number));
  return numbers.filter((number) => !usedNumbers.has(Number(number)));
}