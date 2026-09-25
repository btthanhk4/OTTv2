import test from 'node:test';
import assert from 'node:assert/strict';
import GameRoom from '../server/party.js';
import { legalMoves } from '../rules.js';

function harness() {
  let saved;
  const connections = [];
  const storage = { get: async () => saved, put: async (_key, value) => { saved = structuredClone(value); } };
  const room = new GameRoom({ id: 'TEST1', storage, getConnections: () => connections });
  const connect = (id) => {
    const connection = {
      id,
      messages: [],
      send(text) { this.messages.push(JSON.parse(text)); },
      latest(type) { return [...this.messages].reverse().find((message) => message.type === type); },
    };
    connections.push(connection);
    room.onConnect(connection);
    return connection;
  };
  const send = (connection, message) => room.onMessage(JSON.stringify(message), connection);
  return { room, connect, send };
}

test('máy chủ cấp hai ghế, khán giả không thể đi và nước đi được đồng bộ', async () => {
  const { room, connect, send } = harness();
  await room.onStart();
  const a = connect('a');
  const b = connect('b');
  const watcher = connect('watcher');
  await send(a, { type: 'hello', token: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', name: 'An' });
  await send(b, { type: 'hello', token: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', name: 'Bình' });
  await send(watcher, { type: 'hello', token: 'cccccccc-cccc-cccc-cccc-cccccccccccc', name: 'Xem' });
  assert.equal(a.latest('state').role, 'p1');
  assert.equal(b.latest('state').role, 'p2');
  assert.equal(watcher.latest('state').role, null);
  assert.equal(watcher.latest('state').spectators, 1);

  const from = [6, 0];
  const to = legalMoves(a.latest('state').game.board, ...from)[0];
  const move = { type: 'move', from, to: [to.row, to.col], revision: 0 };
  await send(watcher, move);
  assert.equal(a.latest('state').game.revision, 0);
  await send(b, move);
  assert.equal(a.latest('state').game.revision, 0);
  await send(a, move);
  assert.equal(a.latest('state').game.revision, 1);
  assert.equal(b.latest('state').game.revision, 1);
  assert.equal(watcher.latest('state').game.revision, 1);
  await send(a, move);
  assert.equal(a.latest('state').game.revision, 1);
  assert.equal(a.latest('error').message.includes('đã đổi'), true);
});

test('khán giả chỉ xem không tự giữ ghế và không thể nhận ghế', async () => {
  const { room, connect, send } = harness();
  await room.onStart();
  const watcher = connect('watcher');
  await send(watcher, {
    type: 'hello', token: 'dddddddd-dddd-dddd-dddd-dddddddddddd',
    name: 'Khán giả', spectatorOnly: true,
  });
  assert.equal(watcher.latest('state').role, null);
  assert.equal(watcher.latest('state').seats.p1, null);
  await send(watcher, { type: 'claim', side: 'p1' });
  assert.equal(watcher.latest('state').seats.p1, null);
  const player = connect('player');
  await send(player, {
    type: 'hello', token: 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee', name: 'An',
  });
  assert.equal(player.latest('state').role, 'p1');
  assert.equal(watcher.latest('state').role, null);
});
