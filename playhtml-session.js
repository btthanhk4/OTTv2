import { applyMove, newGame } from './rules.js';
import { createLobbyAnnouncer } from './lobby-presence.js';

function firstMatch() {
  return { game: newGame(), seats: { p1: null, p2: null }, rematchVotes: [], round: 1 };
}

export class PlayhtmlSession {
  constructor({ room, name, token, spectatorOnly = false, onState, onStatus, onError }) {
    Object.assign(this, { room, name, token, spectatorOnly, onState, onStatus, onError });
    this.closed = false;
    this.optedOut = false;
    this.channel = null;
    this.playhtml = null;
    this.unsubscribe = [];
    this.claimTimer = null;
    this.announcer = null;
  }

  async connect() {
    this.onStatus('Đang đồng bộ');
    try {
      const { playhtml } = await import('https://unpkg.com/playhtml');
      await playhtml.init({ room: `ottv2-${this.room}` });
      if (this.closed) return;
      this.playhtml = playhtml;
      if (!this.spectatorOnly) this.announcer = createLobbyAnnouncer(playhtml, this.room, this.name);
      playhtml.presence.setMyPresence('ottv2', {
        token: this.token, name: this.name, joinedAt: Date.now(),
      });
      // Đợi các trình duyệt vừa vào cùng phòng thấy presence của nhau.
      await new Promise((resolve) => setTimeout(resolve, 550));
      if (this.closed) return;
      const arrivals = [...playhtml.presence.getPresences().values()]
        .filter((person) => person.ottv2?.token)
        .sort((a, b) => (a.ottv2.joinedAt - b.ottv2.joinedAt) ||
          a.ottv2.token.localeCompare(b.ottv2.token));
      const rank = arrivals.findIndex((person) => person.ottv2.token === this.token);
      if (rank > 0) await new Promise((resolve) => setTimeout(resolve, rank * 450));
      if (this.closed) return;
      this.channel = playhtml.createPageData('ottv2-match-v3', firstMatch());
      this.unsubscribe.push(this.channel.onUpdate(() => {
        this.publish();
        this.scheduleAutoClaim();
      }));
      this.unsubscribe.push(playhtml.presence.onPresenceChange('ottv2', () => {
        this.publish();
        this.scheduleAutoClaim();
      }));
      this.onStatus('Đã kết nối');
      this.publish();
      this.scheduleAutoClaim();
    } catch (error) {
      if (this.closed) return;
      console.error('PlayHTML:', error);
      this.onStatus('Mất kết nối');
      this.onError('Không thể mở phòng online. Kiểm tra kết nối mạng rồi thử lại.');
    }
  }

  onlineTokens() {
    const tokens = new Set([this.token]);
    if (!this.playhtml) return tokens;
    for (const person of this.playhtml.presence.getPresences().values()) {
      if (person.ottv2?.token) tokens.add(person.ottv2.token);
    }
    return tokens;
  }

  roleFor(match) {
    if (this.spectatorOnly) return null;
    if (match.seats.p1?.token === this.token) return 'p1';
    if (match.seats.p2?.token === this.token) return 'p2';
    return null;
  }

  seatAvailable(match, side, online = this.onlineTokens()) {
    const seat = match.seats[side];
    return !seat || !online.has(seat.token);
  }

  publish() {
    if (!this.channel || this.closed) return;
    const match = this.channel.getData();
    if (!match?.game || !match?.seats) return;
    const online = this.onlineTokens();
    const role = this.roleFor(match);
    this.announcer?.update(role);
    const seats = Object.fromEntries(['p1', 'p2'].map((side) => {
      const seat = match.seats[side];
      return [side, seat ? {
        name: seat.name,
        online: online.has(seat.token),
        available: !online.has(seat.token),
      } : null];
    }));
    this.onState({
      type: 'state',
      game: match.game,
      seats,
      role,
      round: match.round,
      rematchVotes: match.rematchVotes,
      spectators: Math.max(0, online.size - Number(Boolean(seats.p1?.online)) - Number(Boolean(seats.p2?.online))),
    });
  }

  scheduleAutoClaim() {
    clearTimeout(this.claimTimer);
    if (!this.channel || this.closed || this.optedOut || this.spectatorOnly) return;
    const match = this.channel.getData();
    if (this.roleFor(match)) return;
    const side = this.seatAvailable(match, 'p1') ? 'p1'
      : this.seatAvailable(match, 'p2') ? 'p2' : null;
    if (side) this.claimTimer = setTimeout(() => this.claim(side), 300);
  }

  claim(side) {
    if (!this.channel || this.closed || this.spectatorOnly || !['p1', 'p2'].includes(side)) return;
    const online = this.onlineTokens();
    this.channel.setData((draft) => {
      if (this.roleFor(draft) || !this.seatAvailable(draft, side, online)) return;
      if (draft.seats[side] && draft.game.revision > 0) {
        draft.game = newGame();
        draft.round += 1;
      }
      draft.seats[side] = { token: this.token, name: this.name };
      draft.rematchVotes = [];
    });
    this.optedOut = false;
    this.publish();
  }

  send(message) {
    if (!this.channel || this.closed || this.spectatorOnly) return false;
    const match = this.channel.getData();
    const side = this.roleFor(match);
    if (message.type === 'claim') {
      this.claim(message.side);
      return true;
    }
    if (message.type === 'leave') {
      if (!side) return true;
      this.optedOut = true;
      this.channel.setData((draft) => {
        if (draft.seats[side]?.token !== this.token) return;
        draft.seats[side] = null;
        draft.game = newGame();
        draft.rematchVotes = [];
        draft.round += 1;
      });
      this.publish();
      return true;
    }
    if (message.type === 'move') {
      const online = this.onlineTokens();
      if (!side || match.game.revision !== message.revision ||
          !match.seats.p1 || !match.seats.p2 ||
          !online.has(match.seats.p1.token) || !online.has(match.seats.p2.token)) {
        this.onError('Bàn cờ đã đổi hoặc đang chờ đủ hai người chơi.');
        return true;
      }
      const result = applyMove(match.game, side, message.from, message.to);
      if (!result.ok) {
        this.onError(result.error);
        return true;
      }
      this.channel.setData((draft) => {
        if (draft.game.revision !== message.revision || draft.seats[side]?.token !== this.token) return;
        const latest = applyMove(draft.game, side, message.from, message.to);
        // PlayHTML không cho gán lại object đang hiện diện ở nhánh khác của draft.
        if (latest.ok) draft.game = JSON.parse(JSON.stringify(latest.state));
      });
      this.publish();
      return true;
    }
    if (message.type === 'rematch' && side && match.game.winner) {
      this.channel.setData((draft) => {
        if (!draft.game.winner || draft.rematchVotes.includes(side)) return;
        draft.rematchVotes.push(side);
        if (draft.rematchVotes.length === 2) {
          draft.game = newGame();
          draft.rematchVotes = [];
          draft.round += 1;
        }
      });
      this.publish();
      return true;
    }
    return false;
  }

  close() {
    this.closed = true;
    clearTimeout(this.claimTimer);
    for (const unsubscribe of this.unsubscribe) unsubscribe();
    this.channel?.destroy();
    this.announcer?.close();
    this.playhtml?.presence.setMyPresence('ottv2', null);
  }
}
