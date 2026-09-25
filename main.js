import { applyMove, BOARD_SIZE, legalMoves, newGame, pieceCounts, SIDE_LABEL, squareName, TYPE_LABEL, TYPES } from './rules.js';
import { OnlineSession, joinPlayhtmlPresence } from './online.js';
import { PlayhtmlSession } from './playhtml-session.js';
import { createLobbyAnnouncer, findOpenRoom, LOBBY_PRESENCE_ROOM, waitingPlayers } from './lobby-presence.js';

const $ = (selector) => document.querySelector(selector);
const els = {
  home: $('#home-view'), gameView: $('#game-view'), board: $('#board'),
  startPanel: $('.start-panel'), quickWait: $('#quick-wait'), quickWaitTitle: $('#quick-wait-title'),
  quickWaitDetail: $('#quick-wait-detail'), cancelQuick: $('#cancel-quick'),
  name: $('#player-name'), roomInput: $('#room-input'), create: $('#create-online'),
  quick: $('#quick-match'), join: $('#join-online'), offline: $('#start-offline'), back: $('#back-home'),
  mode: $('#mode-label'), round: $('#round-label'), connection: $('#connection-label'),
  invite: $('#copy-invite'), blueName: $('#blue-name'), redName: $('#red-name'),
  blueCounts: $('#blue-counts'), redCounts: $('#red-counts'),
  marker: $('#turn-marker'), title: $('#status-title'), detail: $('#status-detail'),
  role: $('#role-label'), claimActions: $('#claim-actions'), claimBlue: $('#claim-blue'),
  claimRed: $('#claim-red'), rematch: $('#rematch'), leave: $('#leave-seat'),
  moveTotal: $('#move-total'), moveList: $('#move-list'), toast: $('#toast'),
};

const LETTER = { rock: 'Đ', paper: 'L', scissors: 'K' };
const ICON = {
  rock: '<path d="M7 12 9 6l6-2 5 5 2 6-5 6H9l-4-5 2-4Z"/><path d="m9 6 4 6m2-8-2 8m7-3-7 3m4 9-4-9"/>',
  paper: '<rect x="7" y="3" width="14" height="20" rx="2"/><path d="M10 8h8M10 12h8M10 16h6"/>',
  scissors: '<circle cx="7" cy="7" r="3"/><circle cx="7" cy="19" r="3"/><path d="m10 9 12 11M10 17 22 4"/>',
};
const pageParams = new URLSearchParams(location.search);
const spectatorOnly = pageParams.get('spectate') === '1';
const embedded = pageParams.get('embed') === '1';
document.body.classList.toggle('is-embed', embedded);
document.body.classList.toggle('is-spectator', spectatorOnly);

let mode = null;
let game = null;
let room = null;
let session = null;
let onlineState = null;
let selected = null;
let pendingMove = false;
let toastTimer = null;
let playhtmlStarted = false;
let presenceRoom = null;
let partyLobbyAnnouncer = null;
let partyPresencePending = false;
let connectionStatus = 'Sẵn sàng';
let offlineRound = 1;
let quickLobby = null;
let quickPoll = null;

function notify(message) {
  els.toast.textContent = message;
  els.toast.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => els.toast.classList.remove('show'), 3600);
}

function savedName() {
  const name = els.name.value.trim().slice(0, 18) || 'Người chơi';
  localStorage.setItem('ottv2-name', name);
  return name;
}

function identityFor(code) {
  const key = `ottv2-token:${code}`;
  let token = localStorage.getItem(key);
  if (!token) {
    token = crypto.randomUUID();
    localStorage.setItem(key, token);
  }
  return token;
}

function roomCode() {
  const bytes = new Uint8Array(5);
  crypto.getRandomValues(bytes);
  return [...bytes].map((byte) => 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'[byte % 32]).join('');
}

function mySide() {
  return mode === 'offline' ? game?.turn : onlineState?.role;
}

function canAct() {
  if (!game || game.winner || pendingMove || spectatorOnly) return false;
  if (mode === 'offline') return true;
  const seats = onlineState?.seats;
  return connectionStatus === 'Đã kết nối' && onlineState?.role === game.turn &&
    Boolean(seats?.p1?.online && seats?.p2?.online);
}

function showGame() {
  els.home.hidden = true;
  els.gameView.hidden = false;
  window.scrollTo({ top: 0, behavior: 'instant' });
}

function showHome() {
  if (spectatorOnly) {
    location.assign('./');
    return;
  }
  session?.close();
  partyLobbyAnnouncer?.close();
  partyLobbyAnnouncer = null;
  session = null;
  mode = null;
  game = null;
  room = null;
  onlineState = null;
  selected = null;
  pendingMove = false;
  els.gameView.hidden = true;
  els.home.hidden = false;
  const url = new URL(location.href);
  url.searchParams.delete('room');
  url.searchParams.delete('quick');
  url.searchParams.delete('skip');
  history.replaceState(null, '', url);
}

function quickMatch() {
  savedName();
  const url = new URL(location.href);
  url.searchParams.delete('room');
  url.searchParams.delete('skip');
  url.searchParams.set('quick', '1');
  location.assign(url.href);
}

function stopQuickMatch() {
  clearInterval(quickPoll);
  quickPoll = null;
  if (quickLobby) {
    quickLobby.presence.setMyPresence('queue', null);
    quickLobby.destroy();
    quickLobby = null;
  }
}

function cancelQuickMatch() {
  stopQuickMatch();
  const url = new URL(location.href);
  url.searchParams.delete('room');
  url.searchParams.delete('quick');
  url.searchParams.delete('skip');
  location.assign(url.href);
}

async function findQuickMatch() {
  els.startPanel.classList.add('is-quick-waiting');
  els.quickWait.hidden = false;
  els.quickWaitTitle.textContent = 'Đang tìm phòng còn ghế';
  els.quickWaitDetail.textContent = 'Bạn đang ở sảnh chờ. Trò chơi sẽ tự ghép khi có đối thủ.';
  try {
    const { playhtml } = await import('https://unpkg.com/playhtml');
    await playhtml.init({ room: 'ottv2-matchmaker-v1' });
    playhtmlStarted = true;
    presenceRoom = 'ottv2-matchmaker-v1';
    const lobby = playhtml.createPresenceRoom(LOBBY_PRESENCE_ROOM);
    quickLobby = lobby;
    const token = crypto.randomUUID();
    const excluded = new Set((pageParams.get('skip') || '').split(',').filter(Boolean));
    let queue = { token, joinedAt: Date.now(), state: 'waiting' };
    let navigating = false;

    function publish(next) {
      queue = next;
      lobby.presence.setMyPresence('queue', queue);
    }

    function enterRoom(code) {
      if (navigating) return;
      navigating = true;
      stopQuickMatch();
      const url = new URL(location.href);
      url.searchParams.set('room', code);
      location.assign(url.href);
    }

    function checkLobby() {
      if (navigating || quickLobby !== lobby) return;
      const presences = lobby.presence.getPresences();
      const entries = [...presences.values()];
      const now = Date.now();
      if (queue.state === 'waiting') {
        const openRoom = findOpenRoom(presences, excluded);
        if (openRoom) return enterRoom(openRoom);
        const offer = entries.map((person) => person.queue)
          .find((candidate) => candidate?.state === 'offering' && candidate.partner === token &&
            now - candidate.since < 20000);
        if (offer) {
          publish({ ...queue, state: 'accepted', partner: offer.token, room: offer.room, since: now });
          els.quickWaitTitle.textContent = 'Đã tìm thấy đối thủ';
          els.quickWaitDetail.textContent = 'Đối thủ đang mở bàn cờ. Bạn sẽ tự vào khi ghế đã sẵn sàng.';
          return;
        }
        const waiters = waitingPlayers(presences);
        if (waiters.length >= 2 && waiters[0].token === token) {
          publish({ ...queue, state: 'offering', partner: waiters[1].token, room: roomCode(), since: now });
          els.quickWaitTitle.textContent = 'Đã tìm thấy đối thủ';
          els.quickWaitDetail.textContent = 'Đang xác nhận cặp ghép và chuẩn bị bàn cờ.';
        }
      } else if (queue.state === 'offering') {
        const partner = entries.map((person) => person.queue)
          .find((candidate) => candidate?.token === queue.partner);
        if (partner?.state === 'accepted' && partner.partner === token && partner.room === queue.room) {
          return enterRoom(queue.room);
        }
        if (now - queue.since > 20000) {
          publish({ token, joinedAt: now, state: 'waiting' });
          els.quickWaitTitle.textContent = 'Đang tìm phòng còn ghế';
          els.quickWaitDetail.textContent = 'Đối thủ trước đã rời sảnh. Trò chơi đang tiếp tục tìm trận.';
        }
      } else if (queue.state === 'accepted') {
        const target = new Map([...presences].filter(([, person]) => person.table?.room === queue.room));
        if (findOpenRoom(target, excluded) === queue.room) return enterRoom(queue.room);
        if (now - queue.since > 20000) {
          publish({ token, joinedAt: now, state: 'waiting' });
          els.quickWaitTitle.textContent = 'Đang tìm phòng còn ghế';
          els.quickWaitDetail.textContent = 'Bàn cờ chưa sẵn sàng. Trò chơi đang tìm đối thủ khác.';
        }
      }
    }

    lobby.presence.onPresenceChange('table', checkLobby);
    lobby.presence.onPresenceChange('queue', checkLobby);
    publish(queue);
    quickPoll = setInterval(checkLobby, 700);
    setTimeout(checkLobby, 800);
  } catch (error) {
    console.error('Ghép trận nhanh:', error);
    stopQuickMatch();
    els.quickWaitTitle.textContent = 'Không thể kết nối sảnh';
    els.quickWaitDetail.textContent = 'Kiểm tra kết nối mạng rồi hủy để thử lại.';
  }
}

function retryQuickMatch(code) {
  const url = new URL(location.href);
  const excluded = new Set((url.searchParams.get('skip') || '').split(',').filter(Boolean));
  excluded.add(code);
  url.searchParams.set('skip', [...excluded].join(','));
  url.searchParams.delete('room');
  location.assign(url.href);
}

function startOffline() {
  session?.close();
  partyLobbyAnnouncer?.close();
  partyLobbyAnnouncer = null;
  session = null;
  mode = 'offline';
  room = null;
  onlineState = null;
  game = newGame();
  offlineRound = 1;
  selected = null;
  pendingMove = false;
  connectionStatus = 'Cùng một máy';
  showGame();
  render();
}

function startOnline(code) {
  if (!/^[A-Z0-9]{4,12}$/.test(code)) {
    notify('Mã phòng cần có 4–12 chữ hoặc số.');
    return;
  }
  const name = spectatorOnly ? 'Khán giả' : savedName();
  const params = new URLSearchParams(location.search);
  const usePartyKit = params.has('server') ||
    (params.get('backend') !== 'playhtml' &&
      (location.hostname === 'localhost' || location.hostname === '127.0.0.1'));
  if (playhtmlStarted && presenceRoom && presenceRoom !== code) {
    const next = new URL(location.href);
    next.searchParams.set('room', code);
    location.assign(next.href);
    return;
  }
  session?.close();
  partyLobbyAnnouncer?.close();
  partyLobbyAnnouncer = null;
  mode = 'online';
  room = code;
  game = null;
  onlineState = null;
  selected = null;
  pendingMove = false;
  connectionStatus = 'Đang kết nối';
  const url = new URL(location.href);
  url.searchParams.set('room', code);
  history.replaceState(null, '', url);
  showGame();
  render();
  const Session = usePartyKit ? OnlineSession : PlayhtmlSession;
  session = new Session({
    room: code,
    name,
    token: spectatorOnly ? crypto.randomUUID() : identityFor(code),
    spectatorOnly,
    onState: (state) => {
      const revisionChanged = game?.revision !== state.game.revision || onlineState?.round !== state.round;
      onlineState = state;
      game = state.game;
      if (pageParams.get('quick') === '1' && !spectatorOnly) {
        if (state.role) {
          const cleanUrl = new URL(location.href);
          cleanUrl.searchParams.delete('quick');
          cleanUrl.searchParams.delete('skip');
          history.replaceState(null, '', cleanUrl);
          pageParams.delete('quick');
        } else if (game.winner || (state.seats?.p1?.online && state.seats?.p2?.online)) {
          retryQuickMatch(code);
          return;
        }
      }
      if (revisionChanged) selected = null;
      pendingMove = false;
      render();
      if (embedded) parent.postMessage({
        type: 'ottv2-snapshot', room: code, revision: game.revision,
        winner: game.winner, turn: game.turn, board: game.board,
        lastMove: game.lastMove, seats: state.seats,
      }, location.origin);
      if (usePartyKit && !spectatorOnly) {
        if (!partyLobbyAnnouncer && !partyPresencePending) {
          partyPresencePending = true;
          playhtmlStarted = true;
          presenceRoom = code;
          joinPlayhtmlPresence(code, name).then((playhtml) => {
            partyPresencePending = false;
            if (mode !== 'online' || room !== code) return;
            partyLobbyAnnouncer = createLobbyAnnouncer(playhtml, code, name);
            partyLobbyAnnouncer.update(onlineState?.role, Boolean(game?.winner));
          }).catch((error) => {
            partyPresencePending = false;
            console.warn('PlayHTML presence:', error);
          });
        } else partyLobbyAnnouncer?.update(state.role, Boolean(state.game.winner));
      } else if (!usePartyKit) {
        playhtmlStarted = true;
        presenceRoom = code;
      }
    },
    onStatus: (status) => {
      connectionStatus = status;
      if (status !== 'Đã kết nối') pendingMove = false;
      render();
    },
    onError: (message) => {
      pendingMove = false;
      selected = null;
      notify(message);
      render();
    },
  });
  session.connect();
}

function countMarkup(side) {
  const counts = pieceCounts(game.board)[side];
  return TYPES.map((type) => `<span class="piece-count ${counts[type] ? '' : 'zero'}">${LETTER[type]} × ${counts[type]}<span>${TYPE_LABEL[type]}</span></span>`).join('');
}

function renderBoard() {
  if (!game) {
    els.board.replaceChildren();
    return;
  }
  const legal = selected && canAct()
    ? new Map(legalMoves(game.board, selected.row, selected.col).map((move) => [`${move.row},${move.col}`, move.kind]))
    : new Map();
  const fragment = document.createDocumentFragment();
  for (let row = 0; row < BOARD_SIZE; row += 1) {
    for (let col = 0; col < BOARD_SIZE; col += 1) {
      const piece = game.board[row][col];
      const square = document.createElement('button');
      const move = legal.get(`${row},${col}`);
      square.type = 'button';
      square.dataset.row = row;
      square.dataset.col = col;
      square.className = `square ${(row + col) % 2 ? 'dark' : 'light'}`;
      square.setAttribute('role', 'gridcell');
      square.setAttribute('aria-label', `${squareName(row, col)}${piece ? `, ${TYPE_LABEL[piece.type]} phe ${SIDE_LABEL[piece.owner]}` : ', ô trống'}${move === 'capture' ? ', có thể ăn' : move ? ', có thể đi' : ''}`);
      if (row === 0 && col === 8) square.classList.add('goal-blue');
      if (row === 8 && col === 0) square.classList.add('goal-red');
      if (game.lastMove && (
        (game.lastMove.from[0] === row && game.lastMove.from[1] === col) ||
        (game.lastMove.to[0] === row && game.lastMove.to[1] === col)
      )) square.classList.add('last-move');
      if (selected?.row === row && selected?.col === col) {
        square.classList.add('selected');
        square.setAttribute('aria-selected', 'true');
      }
      if (move) square.classList.add(`legal-${move}`);
      if (piece) {
        square.classList.add('has-piece');
        const chip = document.createElement('span');
        chip.className = `piece ${piece.owner}`;
        chip.setAttribute('aria-hidden', 'true');
        chip.innerHTML = `<svg viewBox="0 0 28 28" aria-hidden="true">${ICON[piece.type]}</svg><span class="type-letter">${LETTER[piece.type]}</span>`;
        square.append(chip);
      }
      fragment.append(square);
    }
  }
  els.board.replaceChildren(fragment);
}

function winDetail() {
  if (game.winReason === 'goal') return `Đã đưa quân tới ô ${game.winner === 'p1' ? 'i9' : 'a1'}.`;
  if (game.winReason?.startsWith('eliminate:')) {
    return `Đã ăn hết quân ${TYPE_LABEL[game.winReason.split(':')[1]]} của đối thủ.`;
  }
  if (game.winReason === 'repetition') return 'Thế cờ lặp lại ba lần.';
  return '80 lượt đi liên tiếp không có quân bị ăn.';
}

function renderStatus() {
  els.marker.className = `turn-marker ${game?.winner === 'draw' ? 'draw' : game?.turn === 'p2' ? 'red' : ''}`;
  if (!game) {
    els.title.textContent = connectionStatus === 'Mất kết nối' ? 'Không thể mở phòng' : 'Đang mở phòng…';
    els.detail.textContent = connectionStatus === 'Mất kết nối'
      ? 'Kiểm tra mạng rồi tải lại trang để thử lại.'
      : 'Kết nối tới máy chủ để nhận bàn cờ và ghế chơi.';
    els.role.textContent = 'ĐANG KẾT NỐI';
    els.claimActions.hidden = true;
    els.rematch.hidden = true;
    els.leave.hidden = true;
    return;
  }
  if (game.winner) {
    els.title.textContent = game.winner === 'draw' ? 'Ván đấu hòa.' : `Phe ${SIDE_LABEL[game.winner]} chiến thắng!`;
    els.detail.textContent = winDetail();
  } else if (mode === 'online' && (!onlineState?.seats?.p1?.online || !onlineState?.seats?.p2?.online)) {
    els.title.textContent = 'Đang chờ đối thủ';
    els.detail.textContent = 'Gửi liên kết phòng cho bạn bè. Hai ghế cần có người trước khi đi quân.';
  } else {
    els.title.textContent = `Lượt phe ${SIDE_LABEL[game.turn]}`;
    els.detail.textContent = canAct()
      ? 'Chọn quân của mình, rồi chọn ô xanh để đi hoặc ô đỏ để ăn.'
      : mode === 'online' && !onlineState?.role
        ? 'Bạn đang xem trận đấu. Ghế trống có thể nhận sau khi người chơi rời phòng.'
        : 'Đang chờ nước đi của đối thủ.';
  }
  els.role.textContent = mode === 'offline' ? 'CHẾ ĐỘ OFFLINE · CÙNG MỘT MÁY'
    : onlineState?.role ? `BẠN CẦM PHE ${SIDE_LABEL[onlineState.role].toUpperCase()}`
      : `KHÁN GIẢ · ${onlineState?.spectators ?? 0} NGƯỜI XEM`;
  els.claimActions.hidden = spectatorOnly || mode !== 'online' || Boolean(onlineState?.role);
  els.claimBlue.hidden = !(onlineState?.seats?.p1?.available ?? true);
  els.claimRed.hidden = !(onlineState?.seats?.p2?.available ?? true);
  els.rematch.hidden = spectatorOnly || (mode === 'online' && !onlineState?.role);
  els.rematch.textContent = game.winner
    ? mode === 'online' && onlineState?.rematchVotes?.includes(onlineState.role)
      ? 'Đã đề nghị · chờ đối thủ' : 'Chơi ván mới'
    : mode === 'offline' ? 'Bắt đầu lại' : 'Chơi ván mới';
  els.rematch.disabled = mode === 'online' && (!game.winner || onlineState?.rematchVotes?.includes(onlineState.role));
  els.leave.hidden = spectatorOnly || mode !== 'online' || !onlineState?.role;
}

function renderLog() {
  if (!game) {
    els.moveTotal.textContent = '00 NƯỚC';
    els.moveList.innerHTML = '<li class="empty-log">Đang chờ bàn cờ…</li>';
    return;
  }
  els.moveTotal.textContent = `${String(game.revision).padStart(2, '0')} NƯỚC`;
  els.moveList.replaceChildren();
  if (!game.history.length) {
    const empty = document.createElement('li');
    empty.className = 'empty-log';
    empty.textContent = 'Nước đầu tiên đang chờ được đi.';
    els.moveList.append(empty);
    return;
  }
  for (const move of [...game.history].reverse()) {
    const item = document.createElement('li');
    const side = document.createElement('span');
    side.className = 'move-side';
    side.textContent = `${move.side === 'p1' ? 'Xanh' : 'Đỏ'} · ${TYPE_LABEL[move.type]}`;
    const notation = document.createElement('span');
    notation.textContent = move.notation;
    if (move.captured) notation.className = 'capture-mark';
    item.append(side, notation);
    els.moveList.append(item);
  }
}

function render() {
  els.mode.textContent = mode === 'online' ? `ONLINE / ${room}` : 'OFFLINE';
  els.round.textContent = `VÁN ${String(mode === 'online' ? onlineState?.round || 1 : offlineRound).padStart(2, '0')}`;
  els.connection.textContent = connectionStatus;
  els.connection.classList.toggle('offline', mode === 'online' && connectionStatus !== 'Đã kết nối');
  els.invite.hidden = mode !== 'online';
  if (game) {
    els.blueName.textContent = mode === 'online'
      ? onlineState?.seats?.p1?.name || 'Chờ người chơi'
      : 'Người chơi 1';
    els.redName.textContent = mode === 'online'
      ? onlineState?.seats?.p2?.name || 'Chờ người chơi'
      : 'Người chơi 2';
    els.blueCounts.innerHTML = countMarkup('p1');
    els.redCounts.innerHTML = countMarkup('p2');
  } else {
    els.blueName.textContent = 'Chờ người chơi';
    els.redName.textContent = 'Chờ người chơi';
    els.blueCounts.replaceChildren();
    els.redCounts.replaceChildren();
  }
  if (selected && (!canAct() || game?.board[selected.row]?.[selected.col]?.owner !== mySide())) selected = null;
  renderBoard();
  renderStatus();
  renderLog();
}

els.board.addEventListener('click', (event) => {
  const square = event.target.closest('.square');
  if (!square || !canAct()) return;
  const row = Number(square.dataset.row);
  const col = Number(square.dataset.col);
  if (selected) {
    const legal = legalMoves(game.board, selected.row, selected.col)
      .some((move) => move.row === row && move.col === col);
    if (legal) {
      const from = [selected.row, selected.col];
      const to = [row, col];
      selected = null;
      if (mode === 'offline') {
        const result = applyMove(game, game.turn, from, to);
        if (result.ok) game = result.state;
        else notify(result.error);
      } else {
        pendingMove = true;
        if (!session.send({ type: 'move', from, to, revision: game.revision })) {
          pendingMove = false;
          notify('Mất kết nối. Hãy chờ kết nối lại.');
        }
      }
      render();
      return;
    }
  }
  selected = game.board[row][col]?.owner === mySide() ? { row, col } : null;
  renderBoard();
});

els.quick.addEventListener('click', quickMatch);
els.cancelQuick.addEventListener('click', cancelQuickMatch);
els.create.addEventListener('click', () => startOnline(roomCode()));
els.join.addEventListener('click', () => startOnline(els.roomInput.value.trim().toUpperCase()));
els.roomInput.addEventListener('keydown', (event) => {
  if (event.key === 'Enter') startOnline(els.roomInput.value.trim().toUpperCase());
});
els.offline.addEventListener('click', startOffline);
els.back.addEventListener('click', showHome);
els.invite.addEventListener('click', async () => {
  const url = new URL(location.href);
  try { await navigator.clipboard.writeText(url.href); notify('Đã sao chép liên kết phòng.'); }
  catch { notify(`Liên kết phòng: ${url.href}`); }
});
els.rematch.addEventListener('click', () => {
  if (mode === 'offline') {
    game = newGame();
    offlineRound += 1;
    selected = null;
    render();
  } else if (game?.winner && onlineState?.role) {
    session.send({ type: 'rematch' });
  }
});
els.leave.addEventListener('click', () => {
  if (onlineState?.role) session.send({ type: 'leave' });
});
els.claimBlue.addEventListener('click', () => session?.send({ type: 'claim', side: 'p1' }));
els.claimRed.addEventListener('click', () => session?.send({ type: 'claim', side: 'p2' }));

els.name.value = localStorage.getItem('ottv2-name') || '';
const initialRoom = new URLSearchParams(location.search).get('room')?.toUpperCase();
if (initialRoom) startOnline(initialRoom);
else if (pageParams.get('quick') === '1') findQuickMatch();
