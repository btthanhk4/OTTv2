export const LOBBY_PRESENCE_ROOM = 'ottv2-live-tables-v1';

export function createLobbyAnnouncer(playhtml, room, name) {
  const lobby = playhtml.createPresenceRoom(LOBBY_PRESENCE_ROOM);
  let currentSide = null;
  return {
    update(side) {
      const next = side === 'p1' || side === 'p2' ? side : null;
      if (next === currentSide) return;
      currentSide = next;
      lobby.presence.setMyPresence('table', next ? { room, side: next, name } : null);
    },
    close() {
      lobby.presence.setMyPresence('table', null);
      lobby.destroy();
    },
  };
}
