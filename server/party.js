import { applyMove, newGame } from '../rules.js';

const REJOIN_GRACE_MS = 90_000;
const TOKEN_PATTERN = /^[a-zA-Z0-9-]{16,80}$/;

function freshMatch() {
  return {
    game: newGame(),
    seats: { p1: null, p2: null },
    rematchVotes: [],
    round: 1,
  };
}

export default class GameRoom {
  constructor(room) {
    this.room = room;
    this.match = freshMatch();
    this.clients = new Map();
    this.queue = Promise.resolve();
  }

  async onStart() {
    this.match = (await this.room.storage.get('match')) || freshMatch();
    // Sau khi worker khởi động lại, các kết nối cũ đều đã mất.
    for (const side of ['p1', 'p2']) {
      if (this.match.seats[side]) this.match.seats[side].disconnectedAt ??= Date.now();
    }
  }

  onConnect(connection) {
    connection.send(JSON.stringify({ type: 'hello-required' }));
  }

  onMessage(raw, sender) {
    this.queue = this.queue.then(() => this.handle(raw, sender)).catch((error) => {
      console.error('OTTv2 room error', error);
      this.send(sender, { type: 'error', message: 'Máy chủ gặp lỗi. Hãy thử lại.' });
    });
    return this.queue;
  }

  onClose(connection) {
    this.queue = this.queue.then(async () => {
      const client = this.clients.get(connection.id);
      this.clients.delete(connection.id);
      if (!client) return;
      let changed = false;
      for (const side of ['p1', 'p2']) {
        const seat = this.match.seats[side];
        if (seat?.token === client.token && !this.isOnline(client.token)) {
          seat.disconnectedAt = Date.now();
          changed = true;
        }
      }
      if (changed) await this.persist();
      this.broadcastState();
    }).catch((error) => console.error('OTTv2 close error', error));
    return this.queue;
  }

  async onRequest() {
    return Response.json({ name: 'OTTv2', room: this.room.id, status: 'ready' });
  }

  send(connection, data) {
    try { connection.send(JSON.stringify(data)); } catch { /* connection closed */ }
  }

  roleFor(token) {
    if (!token) return null;
    if (this.match.seats.p1?.token === token) return 'p1';
    if (this.match.seats.p2?.token === token) return 'p2';
    return null;
  }

  isOnline(token) {
    for (const client of this.clients.values()) {
      if (client.token === token) return true;
    }
    return false;
  }

  seatAvailable(side) {
    const seat = this.match.seats[side];
    if (!seat) return true;
    return !this.isOnline(seat.token) &&
      Date.now() - (seat.disconnectedAt ?? Date.now()) > REJOIN_GRACE_MS;
  }

  sendState(connection) {
    const client = this.clients.get(connection.id);
    if (!client) return;
    const seats = Object.fromEntries(['p1', 'p2'].map((side) => {
      const seat = this.match.seats[side];
      return [side, seat ? {
        name: seat.name,
        online: this.isOnline(seat.token),
        available: this.seatAvailable(side),
      } : null];
    }));
    this.send(connection, {
      type: 'state',
      game: this.match.game,
      seats,
      role: client.spectatorOnly ? null : this.roleFor(client.token),
      round: this.match.round,
      rematchVotes: this.match.rematchVotes,
      spectators: [...this.clients.values()].filter((person) => person.spectatorOnly || !this.roleFor(person.token)).length,
    });
  }

  broadcastState() {
    for (const connection of this.room.getConnections()) this.sendState(connection);
  }

  async persist() {
    await this.room.storage.put('match', this.match);
  }

  assignSeat(side, token, name) {
    if (!this.seatAvailable(side)) return false;
    if (this.match.seats[side] && this.match.game.revision > 0) {
      this.match.game = newGame();
      this.match.round += 1;
    }
    this.match.seats[side] = { token, name, disconnectedAt: null };
    this.match.rematchVotes = [];
    return true;
  }

  async handle(raw, sender) {
    if (typeof raw !== 'string' || raw.length > 2048) return;
    let message;
    try { message = JSON.parse(raw); } catch { return; }
    if (!message || typeof message !== 'object') return;

    if (message.type === 'hello') {
      if (typeof message.token !== 'string' || !TOKEN_PATTERN.test(message.token)) {
        this.send(sender, { type: 'error', message: 'Phiên chơi không hợp lệ.' });
        return;
      }
      const token = message.token;
      const name = typeof message.name === 'string'
        ? message.name.trim().slice(0, 18) || 'Người chơi'
        : 'Người chơi';
      const spectatorOnly = message.spectatorOnly === true;
      this.clients.set(sender.id, { token, name, spectatorOnly });
      const role = spectatorOnly ? null : this.roleFor(token);
      if (role) {
        this.match.seats[role].name = name;
        this.match.seats[role].disconnectedAt = null;
      } else if (!spectatorOnly && this.seatAvailable('p1')) this.assignSeat('p1', token, name);
      else if (!spectatorOnly && this.seatAvailable('p2')) this.assignSeat('p2', token, name);
      await this.persist();
      this.broadcastState();
      return;
    }

    const client = this.clients.get(sender.id);
    if (!client) return;
    const side = client.spectatorOnly ? null : this.roleFor(client.token);

    if (message.type === 'claim') {
      if (client.spectatorOnly || side || !['p1', 'p2'].includes(message.side) ||
          !this.assignSeat(message.side, client.token, client.name)) {
        this.send(sender, { type: 'error', message: 'Ghế này chưa trống.' });
        return;
      }
      await this.persist();
      this.broadcastState();
      return;
    }

    if (message.type === 'leave') {
      if (!side) return;
      this.match.seats[side] = null;
      this.match.game = newGame();
      this.match.rematchVotes = [];
      this.match.round += 1;
      await this.persist();
      this.broadcastState();
      return;
    }

    if (message.type === 'move') {
      if (!side || !this.match.seats.p1 || !this.match.seats.p2 ||
          !this.isOnline(this.match.seats.p1.token) ||
          !this.isOnline(this.match.seats.p2.token)) {
        this.send(sender, { type: 'error', message: 'Đang chờ đủ hai người chơi.' });
        return;
      }
      if (message.revision !== this.match.game.revision) {
        this.send(sender, { type: 'error', message: 'Bàn cờ đã đổi. Hãy chọn lại quân.' });
        this.sendState(sender);
        return;
      }
      const result = applyMove(this.match.game, side, message.from, message.to);
      if (!result.ok) {
        this.send(sender, { type: 'error', message: result.error });
        return;
      }
      this.match.game = result.state;
      await this.persist();
      this.broadcastState();
      return;
    }

    if (message.type === 'rematch') {
      if (!side || !this.match.game.winner) return;
      if (!this.match.rematchVotes.includes(side)) this.match.rematchVotes.push(side);
      if (this.match.rematchVotes.length === 2) {
        this.match.game = newGame();
        this.match.rematchVotes = [];
        this.match.round += 1;
      }
      await this.persist();
      this.broadcastState();
    }
  }
}
