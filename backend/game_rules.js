const SHIP_DEFINITIONS = [
  { id: 'carrier', name: 'Carrier', length: 5 },
  { id: 'battleship', name: 'Battleship', length: 4 },
  { id: 'cruiser', name: 'Cruiser', length: 3 },
  { id: 'submarine', name: 'Submarine', length: 3 },
  { id: 'destroyer', name: 'Destroyer', length: 2 },
];

const BOARD_SIZE = 10;

function isCoordinate(value) {
  return Number.isInteger(value) && value >= 0 && value < BOARD_SIZE;
}

function validateFleet(inputShips) {
  if (!Array.isArray(inputShips) || inputShips.length !== SHIP_DEFINITIONS.length) {
    return { valid: false, error: 'Place all five ships before readying up.' };
  }

  const normalizedShips = [];
  const usedIds = new Set();
  const occupiedCells = new Set();

  for (const definition of SHIP_DEFINITIONS) {
    const ship = inputShips.find((candidate) => candidate && candidate.id === definition.id);

    if (!ship || usedIds.has(ship.id)) {
      return { valid: false, error: `The ${definition.name} is missing.` };
    }

    usedIds.add(ship.id);

    if (ship.length !== definition.length || !Array.isArray(ship.cells) || ship.cells.length !== definition.length) {
      return { valid: false, error: `The ${definition.name} must occupy ${definition.length} cells.` };
    }

    const cells = [];
    const localCells = new Set();

    for (const cell of ship.cells) {
      if (!cell || !isCoordinate(cell.x) || !isCoordinate(cell.y)) {
        return { valid: false, error: `${definition.name} is outside the board.` };
      }

      const key = `${cell.x},${cell.y}`;

      if (localCells.has(key) || occupiedCells.has(key)) {
        return { valid: false, error: 'Ships cannot overlap.' };
      }

      localCells.add(key);
      occupiedCells.add(key);
      cells.push({ x: cell.x, y: cell.y });
    }

    const sameRow = cells.every((cell) => cell.y === cells[0].y);
    const sameColumn = cells.every((cell) => cell.x === cells[0].x);

    if (!sameRow && !sameColumn) {
      return { valid: false, error: `${definition.name} must be placed in a straight line.` };
    }

    const varyingCoordinates = cells
      .map((cell) => (sameRow ? cell.x : cell.y))
      .sort((a, b) => a - b);

    for (let index = 1; index < varyingCoordinates.length; index += 1) {
      if (varyingCoordinates[index] !== varyingCoordinates[index - 1] + 1) {
        return { valid: false, error: `${definition.name} cannot have gaps.` };
      }
    }

    normalizedShips.push({
      id: definition.id,
      name: definition.name,
      length: definition.length,
      cells,
    });
  }

  return { valid: true, ships: normalizedShips };
}

module.exports = {
  BOARD_SIZE,
  SHIP_DEFINITIONS,
  validateFleet,
};
