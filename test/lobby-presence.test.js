import assert from 'node:assert/strict';
import test from 'node:test';
import { findOpenRoom } from '../lobby-presence.js';

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
