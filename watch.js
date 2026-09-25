import { LOBBY_PRESENCE_ROOM } from './lobby-presence.js';

const $ = (selector) => document.querySelector(selector);
const list = $('#room-list');
const gallery = $('#watch-gallery');
const empty = $('#watch-empty');
const liveCount = $('#live-count');
const watchCount = $('#watch-count');
const status = $('#lobby-status');
const toast = $('#toast');
const ROOM_PATTERN = /^[A-Z0-9]{4,12}$/;
const chosen = [...new Set((new URLSearchParams(location.search).get('rooms') || '')
  .split(',').filter((code) => ROOM_PATTERN.test(code)))];
const cards = new Map();
const TYPE_LETTER = { rock: 'Đ', paper: 'L', scissors: 'K' };
let active = new Map();
let lobbyReady = false;
let toastTimer;

function notice(message) {
  toast.textContent = message;
  toast.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove('show'), 3300);
}

function saveSelection() {
  const url = new URL(location.href);
  if (chosen.length) url.searchParams.set('rooms', chosen.join(','));
  else url.searchParams.delete('rooms');
  history.replaceState(null, '', url);
}

function iframeUrl(room) {
  const url = new URL('./', location.href);
  url.searchParams.set('room', room);
  url.searchParams.set('spectate', '1');
  url.searchParams.set('embed', '1');
  const params = new URLSearchParams(location.search);
  for (const key of ['backend', 'server']) {
    if (params.has(key)) url.searchParams.set(key, params.get(key));
  }
  return url.href;
}

function makeCard(room) {
  const card = document.createElement('article');
  card.className = 'watch-card';
  card.dataset.room = room;
  const head = document.createElement('div');
  head.className = 'watch-card-head';
  const code = document.createElement('strong');
  code.textContent = room;
  const meta = document.createElement('span');
  meta.className = 'watch-meta';
  meta.textContent = 'Đang tải bàn cờ…';
  const remove = document.createElement('button');
  remove.type = 'button';
  remove.title = `Bỏ theo dõi phòng ${room}`;
  remove.setAttribute('aria-label', remove.title);
  remove.textContent = '×';
  remove.addEventListener('click', () => unwatch(room));
  head.append(code, meta, remove);
  const iframe = document.createElement('iframe');
  iframe.title = `Bàn cờ phòng ${room}, chỉ xem`;
  iframe.src = iframeUrl(room);
  iframe.loading = 'eager';
  const body = document.createElement('div');
  body.className = 'watch-card-body';
  const board = document.createElement('div');
  board.className = 'mini-board';
  board.setAttribute('role', 'img');
  board.setAttribute('aria-label', `Bàn cờ phòng ${room} đang tải`);
  const facts = document.createElement('div');
  facts.className = 'mini-facts';
  facts.textContent = 'Đang nhận bàn cờ…';
  body.append(board, facts);
  card.append(head, body, iframe);
  return card;
}

function renderMiniBoard(card, state) {
  if (!Array.isArray(state.board) || state.board.length !== 9) return;
  const board = card.querySelector('.mini-board');
  const fragment = document.createDocumentFragment();
  for (let row = 0; row < 9; row += 1) {
    for (let col = 0; col < 9; col += 1) {
      const piece = state.board[row]?.[col];
      const square = document.createElement('span');
      square.className = `mini-square ${(row + col) % 2 ? 'dark' : 'light'}`;
      if (row === 0 && col === 8) square.classList.add('goal-blue');
      if (row === 8 && col === 0) square.classList.add('goal-red');
      if (state.lastMove && (
        (state.lastMove.from[0] === row && state.lastMove.from[1] === col) ||
        (state.lastMove.to[0] === row && state.lastMove.to[1] === col)
      )) square.classList.add('last-move');
      if (piece) {
        const chip = document.createElement('i');
        chip.className = `mini-piece ${piece.owner}`;
        chip.textContent = TYPE_LETTER[piece.type] || '?';
        square.append(chip);
      }
      fragment.append(square);
    }
  }
  board.replaceChildren(fragment);
  board.setAttribute('aria-label', `Bàn cờ phòng ${card.dataset.room}, ${state.revision} nước đã đi`);
  const facts = card.querySelector('.mini-facts');
  facts.replaceChildren();
  for (const [side, label] of [['p2', 'PHE ĐỎ'], ['p1', 'PHE XANH']]) {
    const line = document.createElement('div');
    line.className = `mini-player ${side}`;
    const small = document.createElement('small');
    small.textContent = label;
    const name = document.createElement('strong');
    name.textContent = state.seats?.[side]?.name || 'Chờ người chơi';
    line.append(small, name);
    facts.append(line);
  }
  const result = document.createElement('p');
  result.className = 'mini-result';
  result.textContent = state.winner === 'draw' ? 'Ván đấu hòa'
    : state.winner ? `Phe ${state.winner === 'p1' ? 'Xanh' : 'Đỏ'} chiến thắng`
      : state.seats?.p1?.online && state.seats?.p2?.online
        ? `Lượt phe ${state.turn === 'p1' ? 'Xanh' : 'Đỏ'}` : 'Đang chờ đối thủ';
  facts.append(result);
}

function renderGallery() {
  empty.hidden = chosen.length > 0;
  for (const [room, card] of cards) {
    if (!chosen.includes(room)) {
      card.remove();
      cards.delete(room);
    }
  }
  for (const room of chosen) {
    if (!cards.has(room)) cards.set(room, makeCard(room));
    const card = cards.get(room);
    card.classList.toggle('is-inactive', lobbyReady && !active.has(room));
    gallery.append(card);
  }
  watchCount.textContent = `${chosen.length} TRẬN`;
}

function watch(room) {
  if (chosen.includes(room)) return;
  chosen.push(room);
  saveSelection();
  renderGallery();
  renderRooms();
}

function unwatch(room) {
  const index = chosen.indexOf(room);
  if (index < 0) return;
  chosen.splice(index, 1);
  saveSelection();
  renderGallery();
  renderRooms();
}

function renderRooms() {
  const rooms = [...active.entries()].sort((a, b) =>
    Number(Boolean(b[1].p1 && b[1].p2)) - Number(Boolean(a[1].p1 && a[1].p2)) ||
    a[0].localeCompare(b[0]));
  liveCount.textContent = `${rooms.length} PHÒNG`;
  list.replaceChildren();
  if (!rooms.length) {
    const item = document.createElement('div');
    item.className = 'room-list-empty';
    item.textContent = 'Chưa có phòng nào đang có người chơi. Sảnh sẽ tự cập nhật khi một trận bắt đầu.';
    list.append(item);
    return;
  }
  for (const [room, players] of rooms) {
    const item = document.createElement('article');
    item.className = `room-entry ${chosen.includes(room) ? 'is-selected' : ''}`;
    const top = document.createElement('div');
    top.className = 'room-entry-top';
    const code = document.createElement('strong');
    code.className = 'room-code';
    code.textContent = room;
    const live = document.createElement('span');
    live.className = 'room-live';
    live.textContent = players.p1 && players.p2 ? 'ĐANG ĐẤU' : 'CHỜ ĐỐI THỦ';
    top.append(code, live);
    const names = document.createElement('p');
    names.className = 'room-players';
    names.textContent = `Xanh: ${players.p1 || 'Chờ người chơi'} · Đỏ: ${players.p2 || 'Chờ người chơi'}`;
    const button = document.createElement('button');
    button.type = 'button';
    button.className = `button ${chosen.includes(room) ? 'button-outline' : 'button-dark'}`;
    button.textContent = chosen.includes(room) ? 'Đang theo dõi · Bỏ xem' : 'Xem trận →';
    button.addEventListener('click', () => chosen.includes(room) ? unwatch(room) : watch(room));
    item.append(top, names, button);
    list.append(item);
  }
}

function updatePresence(presences) {
  const next = new Map();
  const finished = new Set();
  for (const person of presences.values()) {
    const table = person.table;
    if (!table || !ROOM_PATTERN.test(table.room) || !['p1', 'p2'].includes(table.side)) continue;
    if (table.finished) {
      finished.add(table.room);
      continue;
    }
    if (!next.has(table.room)) next.set(table.room, {});
    next.get(table.room)[table.side] = String(table.name || 'Người chơi').slice(0, 18);
  }
  for (const room of finished) {
    next.delete(room);
    if (chosen.includes(room)) unwatch(room);
  }
  active = next;
  lobbyReady = true;
  for (const [room, card] of cards) {
    const inactive = !active.has(room);
    const wasInactive = card.classList.contains('is-inactive');
    card.classList.toggle('is-inactive', inactive);
    if (inactive) card.querySelector('.watch-meta').textContent = 'Phòng đã trống';
    else if (wasInactive) card.querySelector('.watch-meta').textContent = 'Đang xem trực tiếp';
  }
  status.textContent = 'Danh sách tự cập nhật khi người chơi vào hoặc rời phòng.';
  renderRooms();
}

window.addEventListener('message', (event) => {
  if (event.origin !== location.origin || event.data?.type !== 'ottv2-snapshot') return;
  const { room, revision, winner, seats } = event.data;
  const card = cards.get(room);
  if (!card || !Number.isInteger(revision) || event.source !== card.querySelector('iframe').contentWindow) return;
  if (winner) {
    unwatch(room);
    notice(`Trận ${room} đã kết thúc và được gỡ khỏi khán đài.`);
    return;
  }
  const meta = card.querySelector('.watch-meta');
  meta.textContent = !active.has(room) ? 'Phòng đã trống'
    : winner === 'draw' ? 'Hòa · ' + revision + ' nước'
    : winner ? `Phe ${winner === 'p1' ? 'Xanh' : 'Đỏ'} thắng · ${revision} nước`
      : `${revision} nước · ${seats?.p1?.name || '…'} / ${seats?.p2?.name || '…'}`;
  renderMiniBoard(card, event.data);
});

renderGallery();
renderRooms();

async function connectLobby() {
  try {
    const { playhtml } = await import('https://unpkg.com/playhtml');
    await playhtml.init({ room: 'ottv2-watch-directory-v1' });
    const lobby = playhtml.createPresenceRoom(LOBBY_PRESENCE_ROOM);
    lobby.presence.onPresenceChange('table', updatePresence);
    updatePresence(lobby.presence.getPresences());
  } catch (error) {
    console.error('OTTv2 lobby:', error);
    status.textContent = 'Không thể kết nối sảnh trận. Tải lại trang để thử lần nữa.';
  }
}

connectLobby();
