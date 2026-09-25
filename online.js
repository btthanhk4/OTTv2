const DEFAULT_HOST = 'ottv2.btthanhk4.partykit.dev';

function socketUrl(room) {
  const override = new URLSearchParams(location.search).get('server');
  const host = override || (location.hostname === 'localhost' || location.hostname === '127.0.0.1'
    ? 'localhost:1999'
    : DEFAULT_HOST);
  const protocol = host.startsWith('localhost') || host.startsWith('127.0.0.1') ? 'ws:' : 'wss:';
  return `${protocol}//${host}/parties/main/${encodeURIComponent(room)}`;
}

export class OnlineSession {
  constructor({ room, name, token, onState, onStatus, onError }) {
    Object.assign(this, { room, name, token, onState, onStatus, onError });
    this.closed = false;
    this.attempts = 0;
    this.socket = null;
    this.retryTimer = null;
  }

  connect() {
    if (this.closed) return;
    this.onStatus('Đang kết nối');
    let socket;
    try { socket = new WebSocket(socketUrl(this.room)); }
    catch {
      this.scheduleRetry();
      return;
    }
    this.socket = socket;
    socket.addEventListener('open', () => {
      if (this.closed || socket !== this.socket) return;
      this.attempts = 0;
      this.onStatus('Đã kết nối');
      this.send({ type: 'hello', token: this.token, name: this.name });
    });
    socket.addEventListener('message', (event) => {
      if (socket !== this.socket) return;
      let message;
      try { message = JSON.parse(event.data); } catch { return; }
      if (message.type === 'state') this.onState(message);
      if (message.type === 'error') this.onError(message.message);
    });
    socket.addEventListener('close', () => {
      if (socket !== this.socket || this.closed) return;
      this.onStatus('Mất kết nối');
      this.scheduleRetry();
    });
    socket.addEventListener('error', () => {
      if (socket === this.socket) this.onStatus('Mất kết nối');
    });
  }

  scheduleRetry() {
    if (this.closed) return;
    const delay = Math.min(1000 * 2 ** this.attempts, 12000);
    this.attempts += 1;
    this.retryTimer = setTimeout(() => this.connect(), delay);
  }

  send(message) {
    if (this.socket?.readyState !== WebSocket.OPEN) return false;
    this.socket.send(JSON.stringify(message));
    return true;
  }

  close() {
    this.closed = true;
    clearTimeout(this.retryTimer);
    this.socket?.close();
  }
}

// PlayHTML cung cấp presence cho phòng; trạng thái bàn cờ được máy chủ xác nhận.
export async function joinPlayhtmlPresence(room, name) {
  const { playhtml } = await import('https://unpkg.com/playhtml');
  await playhtml.init({ room: `ottv2-${room}` });
  playhtml.presence.setMyPresence('ottv2', { name, joinedAt: Date.now() });
  return playhtml;
}
