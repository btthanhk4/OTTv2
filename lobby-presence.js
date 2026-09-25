export const LOBBY_PRESENCE_ROOM = 'ottv2-live-tables-v1';

export function findOpenRoom(presences, excluded = new Set()) {
  const rooms = new Map();
  for (const person of presences.values()) {
    const table = person.table;
    if (!table || !/^[A-Z0-9]{4,12}$/.test(table.room) || excluded.has(table.room) ||
      !['p1', 'p2'].includes(table.side)) continue;
    if (!rooms.has(table.room)) rooms.set(table.room, { sides: new Set(), finished: false, joinedAt: Infinity });
    const entry = rooms.get(table.room);
    entry.sides.add(table.side);
    entry.finished ||= Boolean(table.finished);
    entry.joinedAt = Math.min(entry.joinedAt, Number(table.joinedAt) || Infinity);
  }
  return [...rooms.entries()]
    .filter(([, entry]) => !entry.finished && entry.sides.size === 1)
    .sort((a, b) => a[1].joinedAt - b[1].joinedAt || a[0].localeCompare(b[0]))[0]?.[0] || null;
}

export function createLobbyAnnouncer(playhtml, room, name) {
  const lobby = playhtml.createPresenceRoom(LOBBY_PRESENCE_ROOM);
  let currentSide = null;
  let currentFinished = false;
  const joinedAt = Date.now();
  return {
    update(side, finished = false) {
      const next = side === 'p1' || side === 'p2' ? side : null;
      if (next === currentSide && Boolean(finished) === currentFinished) return;
      currentSide = next;
      currentFinished = Boolean(finished);
      lobby.presence.setMyPresence('table', next ? { room, side: next, name, joinedAt, finished: currentFinished } : null);
    },
    close() {
      lobby.presence.setMyPresence('table', null);
      lobby.destroy();
    },
  };
}
