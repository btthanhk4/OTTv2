import { playhtml } from 'https://unpkg.com/playhtml';

const SIZE = 8;
const SYMBOL = { rock: '✊', paper: '✋', scissors: '✌️' };
const TYPE_NAME = { rock: 'Đấm', paper: 'Lá', scissors: 'Kéo' };
const BEATS = { rock: 'scissors', scissors: 'paper', paper: 'rock' };
const SIDE_NAME = { p1: 'Xanh', p2: 'Đỏ' };
const START_P1 = [
  [4, 4, 'rock'], [4, 5, 'scissors'], [5, 3, 'paper'],
  [5, 4, 'rock'], [5, 5, 'paper'], [6, 3, 'scissors'],
  [6, 4, 'rock'],
];

const els = {
  board: document.querySelector('#board'),
  roomCode: document.querySelector('#room-code'),
  copyLink: document.querySelector('#copy-link'),
  connection: document.querySelector('#connection'),
  statusTitle: document.querySelector('#status-title'),
  statusDetail: document.querySelector('#status-detail'),
  turnBadge: document.querySelector('#turn-badge'),
  myRole: document.querySelector('#my-role'),
  p1Seat: document.querySelector('#p1-seat'),
  p2Seat: document.querySelector('#p2-seat'),
  joinP1: document.querySelector('#join-p1'),
  joinP2: document.querySelector('#join-p2'),
  leaveSeat: document.querySelector('#leave-seat'),
  reset: document.querySelector('#reset'),
  toast: document.querySelector('#toast'),
};

function randomId() {
  return globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

const params = new URLSearchParams(location.search);
let roomCode = params.get('room')?.toUpperCase() ?? '';
if (!/^[A-Z0-9-]{4,20}$/.test(roomCode)) {
  roomCode = randomId().replaceAll('-', '').slice(0, 6).toUpperCase();
  params.set('room', roomCode);
  history.replaceState(null, '', `${location.pathname}?${params}${location.hash}`);
}
els.roomCode.textContent = roomCode;

// PlayHTML gán một publicKey bền vững cho mỗi hồ sơ trình duyệt.
let clientId = null;

function createBoard() {
  const board = Array.from({ length: SIZE }, () => Array(SIZE).fill(null));
  for (const [row, col, type] of START_P1) {
    board[row][col] = { owner: 'p1', type };
    // Phản xạ chính xác qua đường chéo phụ h1–a8.
    board[7 - col][7 - row] = { owner: 'p2', type };
  }
  return board;
}

function initialGame() {
  return {
    board: createBoard(),
    turn: 'p1',
    winner: null,
    lastMove: null,
    moveNumber: 0,
  };
}

let channel = null;
const seatChannels = { p1: null, p2: null };
const seats = { p1: null, p2: null };
let game = null;
let selected = null;
let optedOut = false;
let claimTimer = null;
let toastTimer = null;
let lastSnapshot = '';

function mySide() {
  if (!game) return null;
  if (seats.p1 === clientId) return 'p1';
  if (seats.p2 === clientId) return 'p2';
  return null;
}

function onlineTokens() {
  if (!channel) return new Set();
  return new Set(
    [...playhtml.presence.getPresences().values()]
      .map((person) => person.rpsSeat?.token)
      .filter(Boolean),
  );
}

function notify(message) {
  els.toast.textContent = message;
  els.toast.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => els.toast.classList.remove('show'), 3200);
}

function coordinate(row, col) {
  return `${'abcdefgh'[col]}${8 - row}`;
}

function getLegalMoves(board, row, col) {
  const piece = board[row]?.[col];
  const moves = new Map();
  if (!piece) return moves;

  for (let dr = -1; dr <= 1; dr += 1) {
    for (let dc = -1; dc <= 1; dc += 1) {
      if (dr === 0 && dc === 0) continue;
      const nr = row + dr;
      const nc = col + dc;
      if (nr < 0 || nr >= SIZE || nc < 0 || nc >= SIZE) continue;
      const occupant = board[nr][nc];
      if (!occupant) moves.set(`${nr},${nc}`, 'move');
      else if (occupant.owner !== piece.owner && BEATS[piece.type] === occupant.type) {
        moves.set(`${nr},${nc}`, 'capture');
      }
    }
  }
  return moves;
}

function renderBoard() {
  if (!game) return;
  const side = mySide();
  const canPlay = side === game.turn && !game.winner;
  const moves = selected && canPlay
    ? getLegalMoves(game.board, selected.row, selected.col)
    : new Map();
  const fragment = document.createDocumentFragment();

  for (let row = 0; row < SIZE; row += 1) {
    for (let col = 0; col < SIZE; col += 1) {
      const square = document.createElement('button');
      const piece = game.board[row][col];
      const key = `${row},${col}`;
      const move = moves.get(key);
      const coord = coordinate(row, col);
      square.type = 'button';
      square.dataset.row = String(row);
      square.dataset.col = String(col);
      square.className = `square ${(row + col) % 2 ? 'dark' : 'light'}`;
      square.setAttribute('role', 'gridcell');
      square.setAttribute('aria-label', `${coord}${piece ? `, ${TYPE_NAME[piece.type]} phe ${SIDE_NAME[piece.owner]}` : ', trống'}${move ? move === 'capture' ? ', có thể ăn' : ', có thể đi' : ''}`);

      if (row === 7 && col === 0) square.classList.add('goal-red');
      if (row === 0 && col === 7) square.classList.add('goal-blue');
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
        const token = document.createElement('span');
        token.className = `piece ${piece.owner}`;
        token.textContent = SYMBOL[piece.type];
        token.setAttribute('aria-hidden', 'true');
        square.append(token);
      }
      fragment.append(square);
    }
  }
  els.board.replaceChildren(fragment);
}

function renderSeats() {
  if (!game) return;
  const online = onlineTokens();
  const side = mySide();
  for (const role of ['p1', 'p2']) {
    const node = role === 'p1' ? els.p1Seat : els.p2Seat;
    const holder = seats[role];
    node.className = 'seat-state';
    if (!holder) node.textContent = 'Trống';
    else if (holder === clientId) {
      node.textContent = 'Bạn';
      node.classList.add('you');
    } else if (online.has(holder)) node.textContent = 'Đang chơi';
    else {
      node.textContent = 'Vắng mặt';
      node.classList.add('away');
    }
  }

  els.myRole.textContent = side ? `Bạn: phe ${SIDE_NAME[side]}` : 'Khán giả';
  els.joinP1.disabled = Boolean(side || (seats.p1 && online.has(seats.p1)));
  els.joinP2.disabled = Boolean(side || (seats.p2 && online.has(seats.p2)));
  els.joinP1.textContent = seats.p1 ? 'Nhận ghế Xanh' : 'Nhận phe Xanh';
  els.joinP2.textContent = seats.p2 ? 'Nhận ghế Đỏ' : 'Nhận phe Đỏ';
  els.leaveSeat.hidden = !side;
  els.reset.disabled = !side;
}

function renderStatus() {
  if (!game) return;
  const side = mySide();
  if (game.winner) {
    els.statusTitle.textContent = `Phe ${SIDE_NAME[game.winner]} chiến thắng!`;
    els.statusDetail.textContent = game.winner === side
      ? 'Chúc mừng! Nhấn Chơi lại để bắt đầu ván mới.'
      : 'Ván đấu đã kết thúc. Nhấn Chơi lại để đấu tiếp.';
    els.turnBadge.textContent = 'Ván đấu kết thúc';
    els.turnBadge.className = `turn-badge ${game.winner}`;
    return;
  }

  els.statusTitle.textContent = `Lượt của phe ${SIDE_NAME[game.turn]}`;
  els.turnBadge.textContent = game.turn === side ? 'ĐẾN LƯỢT BẠN' : `LƯỢT ${SIDE_NAME[game.turn].toUpperCase()}`;
  els.turnBadge.className = `turn-badge ${game.turn}`;
  if (!side) els.statusDetail.textContent = 'Bạn đang xem trận đấu. Nhận một ghế trống để chơi.';
  else if (game.turn === side) els.statusDetail.textContent = 'Chọn một quân của bạn, sau đó chọn ô được tô sáng.';
  else els.statusDetail.textContent = 'Đang chờ đối thủ thực hiện nước đi.';
}

function render() {
  if (!game) return;
  if (selected && (
    game.turn !== mySide() || game.winner ||
    game.board[selected.row]?.[selected.col]?.owner !== mySide()
  )) selected = null;
  renderBoard();
  renderSeats();
  renderStatus();
}

function scheduleAutoClaim(delay = 300) {
  clearTimeout(claimTimer);
  if (optedOut || !game || mySide()) return;
  const role = !seats.p1 ? 'p1' : !seats.p2 ? 'p2' : null;
  if (role) claimTimer = setTimeout(() => claimSeat(role), delay);
}

function claimSeat(role) {
  if (!seatChannels[role]) return;
  const online = onlineTokens();
  const holder = seatChannels[role].getData().holder;
  if (holder && holder !== clientId && online.has(holder)) return;
  const other = role === 'p1' ? 'p2' : 'p1';
  if (seatChannels[other].getData().holder === clientId) {
    seatChannels[other].setData((draft) => { draft.holder = null; });
  }
  seatChannels[role].setData((draft) => { draft.holder = clientId; });
  optedOut = false;
}

function movePiece(from, to) {
  if (!channel) return;
  const side = mySide();
  if (!side) return;
  channel.setData((draft) => {
    if (draft.winner || draft.turn !== side || seatChannels[side].getData().holder !== clientId) return;
    const source = draft.board[from.row]?.[from.col];
    if (!source || source.owner !== side) return;
    const legal = getLegalMoves(draft.board, from.row, from.col);
    if (!legal.has(`${to.row},${to.col}`)) return;
    const movingType = source.type;

    // PlayHTML khuyến nghị splice để cập nhật ô trong mảng đồng bộ.
    draft.board[from.row].splice(from.col, 1, null);
    draft.board[to.row].splice(to.col, 1, { owner: side, type: movingType });
    draft.lastMove = { from: [from.row, from.col], to: [to.row, to.col] };
    draft.moveNumber += 1;

    const reachedGoal = side === 'p1'
      ? to.row === 0 && to.col === 7
      : to.row === 7 && to.col === 0;
    const opponent = side === 'p1' ? 'p2' : 'p1';
    const opponentRemains = draft.board.some((line) => line.some((piece) => piece?.owner === opponent));
    if (reachedGoal || !opponentRemains) draft.winner = side;
    else draft.turn = opponent;
  });
  selected = null;
  render();
}

els.board.addEventListener('click', (event) => {
  const square = event.target.closest('.square');
  if (!square || !game || game.winner) return;
  const side = mySide();
  if (!side || game.turn !== side) return;

  const row = Number(square.dataset.row);
  const col = Number(square.dataset.col);
  if (selected) {
    const legal = getLegalMoves(game.board, selected.row, selected.col);
    if (legal.has(`${row},${col}`)) {
      movePiece(selected, { row, col });
      return;
    }
  }
  selected = game.board[row][col]?.owner === side ? { row, col } : null;
  renderBoard();
});

els.joinP1.addEventListener('click', () => claimSeat('p1'));
els.joinP2.addEventListener('click', () => claimSeat('p2'));
els.leaveSeat.addEventListener('click', () => {
  const side = mySide();
  if (!side || !seatChannels[side]) return;
  optedOut = true;
  selected = null;
  if (seatChannels[side].getData().holder === clientId) {
    seatChannels[side].setData((draft) => { draft.holder = null; });
  }
});
els.reset.addEventListener('click', () => {
  if (!channel || !mySide()) return;
  selected = null;
  channel.setData((draft) => {
    draft.board = createBoard();
    draft.turn = 'p1';
    draft.winner = null;
    draft.lastMove = null;
    draft.moveNumber = 0;
  });
});
els.copyLink.addEventListener('click', async () => {
  try {
    await navigator.clipboard.writeText(location.href);
    notify('Đã sao chép liên kết phòng.');
  } catch {
    notify(`Liên kết phòng: ${location.href}`);
  }
});

async function start() {
  try {
    await playhtml.init({ room: `rps-${roomCode}` });
    clientId = playhtml.presence.getMyIdentity().publicKey;
    const joinedAt = Date.now();
    playhtml.presence.setMyPresence('rpsSeat', { token: clientId, joinedAt });
    // Hai máy cùng mở phòng cần tạo kênh theo thứ tự để PlayHTML không
    // khởi tạo hai bản mặc định cho cùng một kênh trong cùng thời điểm.
    await new Promise((resolve) => setTimeout(resolve, 1000));
    const arrivals = [...playhtml.presence.getPresences().values()]
      .filter((person) => person.rpsSeat?.token)
      .sort((a, b) =>
        (a.rpsSeat.joinedAt - b.rpsSeat.joinedAt) ||
        a.rpsSeat.token.localeCompare(b.rpsSeat.token),
      );
    const rank = Math.max(0, arrivals.findIndex((person) => person.rpsSeat.token === clientId));
    if (rank) await new Promise((resolve) => setTimeout(resolve, rank * 1400));
    channel = playhtml.createPageData('rps-game-v2', initialGame());
    seatChannels.p1 = playhtml.createPageData('rps-seat-p1-v2', { holder: null });
    seatChannels.p2 = playhtml.createPageData('rps-seat-p2-v2', { holder: null });
    game = channel.getData();
    seats.p1 = seatChannels.p1.getData().holder;
    seats.p2 = seatChannels.p2.getData().holder;
    lastSnapshot = JSON.stringify({ game, seats });
    channel.onUpdate((nextGame) => {
      game = nextGame;
      lastSnapshot = JSON.stringify({ game, seats });
      render();
      scheduleAutoClaim();
    });
    for (const role of ['p1', 'p2']) {
      seatChannels[role].onUpdate((record) => {
        seats[role] = record.holder;
        lastSnapshot = JSON.stringify({ game, seats });
        render();
        scheduleAutoClaim();
      });
    }
    // Sau hai lượt ghi gần như đồng thời, getData() có thể cập nhật trước
    // callback. Đối chiếu bản mới để ghế và lượt luôn hội tụ trên mọi máy.
    setInterval(() => {
      const latest = channel.getData();
      const latestSeats = {
        p1: seatChannels.p1.getData().holder,
        p2: seatChannels.p2.getData().holder,
      };
      const snapshot = JSON.stringify({ game: latest, seats: latestSeats });
      if (snapshot === lastSnapshot) return;
      game = latest;
      seats.p1 = latestSeats.p1;
      seats.p2 = latestSeats.p2;
      lastSnapshot = snapshot;
      render();
      scheduleAutoClaim();
    }, 250);
    playhtml.presence.onPresenceChange('rpsSeat', () => {
      renderSeats();
      scheduleAutoClaim();
    });
    els.connection.textContent = 'Đã đồng bộ';
    els.connection.className = 'connection online';
    render();
    scheduleAutoClaim(700);
  } catch (error) {
    console.error('Không thể kết nối PlayHTML:', error);
    els.connection.textContent = 'Mất kết nối';
    els.connection.className = 'connection offline';
    els.statusTitle.textContent = 'Không thể mở phòng';
    els.statusDetail.textContent = 'Kiểm tra kết nối mạng rồi tải lại trang. Hãy chạy trang qua một máy chủ HTTP.';
  }
}

start();
