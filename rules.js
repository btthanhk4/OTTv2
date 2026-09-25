export const BOARD_SIZE = 9;
export const TYPES = ['rock', 'paper', 'scissors'];
export const TYPE_LABEL = { rock: 'Đấm', paper: 'Lá', scissors: 'Kéo' };
export const SIDE_LABEL = { p1: 'Xanh', p2: 'Đỏ' };
export const BEATS = { rock: 'scissors', paper: 'rock', scissors: 'paper' };
export const GOALS = { p1: [0, 8], p2: [8, 0] };

// Quân Xanh xuất phát quanh a1; quân Đỏ quay 180° quanh tâm bàn cờ.
// Mỗi bên có đúng ba quân của từng loại. Hai ô đích lúc đầu để trống.
const FORMATION = [
  [7, 0, 'rock'], [6, 1, 'rock'], [8, 2, 'rock'],
  [8, 1, 'paper'], [7, 2, 'paper'], [7, 3, 'paper'],
  [6, 0, 'scissors'], [7, 1, 'scissors'], [6, 2, 'scissors'],
];

export function squareName(row, col) {
  return `${'abcdefghi'[col]}${BOARD_SIZE - row}`;
}

export function makeBoard() {
  const board = Array.from({ length: BOARD_SIZE }, () => Array(BOARD_SIZE).fill(null));
  for (const [row, col, type] of FORMATION) {
    board[row][col] = { owner: 'p1', type };
    board[8 - row][8 - col] = { owner: 'p2', type };
  }
  return board;
}

function positionKey(board, turn) {
  return `${turn}:${board.map((line) => line.map((piece) =>
    piece ? `${piece.owner}${piece.type[0]}` : '.').join('')).join('/')}`;
}

export function newGame() {
  const board = makeBoard();
  return {
    board,
    turn: 'p1',
    winner: null,
    winReason: null,
    revision: 0,
    lastMove: null,
    history: [],
    quietPly: 0,
    repetitions: { [positionKey(board, 'p1')]: 1 },
  };
}

export function pieceCounts(board) {
  const counts = {
    p1: { rock: 0, paper: 0, scissors: 0 },
    p2: { rock: 0, paper: 0, scissors: 0 },
  };
  for (const line of board) {
    for (const piece of line) {
      if (piece) counts[piece.owner][piece.type] += 1;
    }
  }
  return counts;
}

export function legalMoves(board, row, col) {
  const source = board?.[row]?.[col];
  if (!source) return [];
  const result = [];
  for (let dr = -1; dr <= 1; dr += 1) {
    for (let dc = -1; dc <= 1; dc += 1) {
      if (dr === 0 && dc === 0) continue;
      const r = row + dr;
      const c = col + dc;
      if (r < 0 || r >= BOARD_SIZE || c < 0 || c >= BOARD_SIZE) continue;
      const target = board[r][c];
      if (!target) result.push({ row: r, col: c, kind: 'move' });
      else if (target.owner !== source.owner && BEATS[source.type] === target.type) {
        result.push({ row: r, col: c, kind: 'capture' });
      }
    }
  }
  return result;
}

export function applyMove(game, side, from, to) {
  if (game.winner) return { ok: false, error: 'Ván đấu đã kết thúc.' };
  if (game.turn !== side) return { ok: false, error: 'Chưa tới lượt của bạn.' };
  if (!Array.isArray(from) || !Array.isArray(to) ||
      from.length !== 2 || to.length !== 2 ||
      ![...from, ...to].every(Number.isInteger)) {
    return { ok: false, error: 'Tọa độ không hợp lệ.' };
  }
  const [fromRow, fromCol] = from;
  const [toRow, toCol] = to;
  const source = game.board[fromRow]?.[fromCol];
  if (!source || source.owner !== side) return { ok: false, error: 'Đó không phải quân của bạn.' };
  const legal = legalMoves(game.board, fromRow, fromCol).find((step) =>
    step.row === toRow && step.col === toCol);
  if (!legal) return { ok: false, error: 'Nước đi không hợp lệ.' };

  const captured = game.board[toRow][toCol];
  const board = game.board.map((line) => line.slice());
  board[fromRow][fromCol] = null;
  board[toRow][toCol] = source;
  const opponent = side === 'p1' ? 'p2' : 'p1';
  const counts = pieceCounts(board);
  const reachedGoal = toRow === GOALS[side][0] && toCol === GOALS[side][1];
  let winner = null;
  let winReason = null;
  if (reachedGoal) {
    winner = side;
    winReason = 'goal';
  } else if (captured && counts[opponent][captured.type] === 0) {
    winner = side;
    winReason = `eliminate:${captured.type}`;
  }

  const nextTurn = side === 'p1' ? 'p2' : 'p1';
  const quietPly = captured ? 0 : game.quietPly + 1;
  // Sau khi ăn quân, thế cờ cũ không thể lặp lại với cùng số quân.
  const repetitions = captured ? {} : { ...game.repetitions };
  const key = positionKey(board, nextTurn);
  repetitions[key] = (repetitions[key] || 0) + 1;
  if (!winner && (repetitions[key] >= 3 || quietPly >= 80)) {
    winner = 'draw';
    winReason = repetitions[key] >= 3 ? 'repetition' : 'quiet';
  }

  const lastMove = {
    side, from, to, type: source.type,
    captured: captured?.type ?? null,
    notation: `${squareName(fromRow, fromCol)}${captured ? '×' : '–'}${squareName(toRow, toCol)}`,
  };
  return {
    ok: true,
    state: {
      board,
      turn: winner ? side : nextTurn,
      winner,
      winReason,
      revision: game.revision + 1,
      lastMove,
      history: [...game.history, lastMove].slice(-120),
      quietPly,
      repetitions,
    },
  };
}
