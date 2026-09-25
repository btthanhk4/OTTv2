import test from 'node:test';
import assert from 'node:assert/strict';
import { applyMove, legalMoves, makeBoard, newGame, pieceCounts } from '../rules.js';

test('đội hình 9×9 đối xứng và có ba quân mỗi loại', () => {
  const board = makeBoard();
  assert.equal(board.length, 9);
  for (let row = 0; row < 9; row += 1) {
    assert.equal(board[row].length, 9);
    for (let col = 0; col < 9; col += 1) {
      const here = board[row][col];
      const mirrored = board[8 - row][8 - col];
      if (here) {
        assert.equal(mirrored?.type, here.type);
        assert.notEqual(mirrored.owner, here.owner);
      }
    }
  }
  const counts = pieceCounts(board);
  assert.deepEqual(counts.p1, { rock: 3, paper: 3, scissors: 3 });
  assert.deepEqual(counts.p2, { rock: 3, paper: 3, scissors: 3 });
  assert.equal(board[0][8], null);
  assert.equal(board[8][0], null);
});

test('di chuyển tám hướng, quân cùng loại chặn nhau', () => {
  const board = Array.from({ length: 9 }, () => Array(9).fill(null));
  board[4][4] = { owner: 'p1', type: 'rock' };
  board[3][4] = { owner: 'p2', type: 'rock' };
  board[3][5] = { owner: 'p2', type: 'scissors' };
  board[4][5] = { owner: 'p2', type: 'paper' };
  board[5][4] = { owner: 'p1', type: 'paper' };
  const moves = legalMoves(board, 4, 4);
  assert.equal(moves.length, 5);
  assert.deepEqual(moves.find((move) => move.row === 3 && move.col === 5)?.kind, 'capture');
  assert.equal(moves.some((move) => move.row === 3 && move.col === 4), false);
  assert.equal(moves.some((move) => move.row === 4 && move.col === 5), false);
  assert.equal(moves.some((move) => move.row === 5 && move.col === 4), false);
});

test('chỉ đúng phe ở đúng lượt được đi', () => {
  const game = newGame();
  assert.equal(applyMove(game, 'p2', [0, 6], [1, 5]).ok, false);
  assert.equal(applyMove(game, 'p1', [7, 0], [6, 1]).ok, false);
  const result = applyMove(game, 'p1', [6, 0], [5, 0]);
  assert.equal(result.ok, true);
  assert.equal(result.state.turn, 'p2');
  assert.equal(result.state.revision, 1);
  assert.equal(game.revision, 0);
});

test('ăn quân cuối cùng của một loại sẽ thắng', () => {
  const game = newGame();
  game.board = Array.from({ length: 9 }, () => Array(9).fill(null));
  game.board[4][4] = { owner: 'p1', type: 'rock' };
  game.board[3][5] = { owner: 'p2', type: 'scissors' };
  game.board[0][0] = { owner: 'p2', type: 'paper' };
  const result = applyMove(game, 'p1', [4, 4], [3, 5]);
  assert.equal(result.ok, true);
  assert.equal(result.state.winner, 'p1');
  assert.equal(result.state.winReason, 'eliminate:scissors');
});

test('đi tới ô đích i9 hoặc a1 sẽ thắng', () => {
  for (const [side, from, to] of [
    ['p1', [1, 7], [0, 8]],
    ['p2', [7, 1], [8, 0]],
  ]) {
    const game = newGame();
    game.board = Array.from({ length: 9 }, () => Array(9).fill(null));
    game.board[from[0]][from[1]] = { owner: side, type: 'paper' };
    game.turn = side;
    const result = applyMove(game, side, from, to);
    assert.equal(result.ok, true);
    assert.equal(result.state.winner, side);
    assert.equal(result.state.winReason, 'goal');
  }
});
