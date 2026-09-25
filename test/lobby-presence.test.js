import assert from 'node:assert/strict';
import test from 'node:test';
import { findOpenRoom, waitingPlayers } from '../lobby-presence.js';

test('ghép vào phòng còn một ghế, ưu tiên phòng chờ lâu nhất', () => {
  const presences = new Map([
    ['a', { table: { room: 'NEW1', side: 'p1', joinedAt: 200 } }],
    ['b', { table: { room: 'OLD1', side: 'p2', joinedAt: 100 } }],
    ['c', { table: { room: 'FULL', side: 'p1', joinedAt: 50 } }],
    ['d', { table: { room: 'FULL', side: 'p2', joinedAt: 60 } }],
    ['e', { table: { room: 'DONE', side: 'p1', joinedAt: 1, finished: true } }],
  ]);
  assert.equal(findOpenRoom(presences), 'OLD1');
  assert.equal(findOpenRoom(presences, new Set(['OLD1'])), 'NEW1');
  assert.equal(findOpenRoom(presences, new Set(['OLD1', 'NEW1'])), null);
});

test('không ghép vào phòng đã kết thúc dù còn tín hiệu của người chơi khác', () => {
  const presences = new Map([
    ['a', { table: { room: 'DONE', side: 'p1', joinedAt: 1, finished: true } }],
    ['b', { table: { room: 'DONE', side: 'p1', joinedAt: 2 } }],
  ]);
  assert.equal(findOpenRoom(presences), null);
});

test('hàng chờ chỉ chứa người đang tìm trận và xếp theo thời gian vào', () => {
  const presences = new Map([
    ['late', { queue: { token: 'late', joinedAt: 200, state: 'waiting' } }],
    ['busy', { queue: { token: 'busy', joinedAt: 50, state: 'offering' } }],
    ['early', { queue: { token: 'early', joinedAt: 100, state: 'waiting' } }],
  ]);
  assert.deepEqual(waitingPlayers(presences).map(({ token }) => token), ['early', 'late']);
});
