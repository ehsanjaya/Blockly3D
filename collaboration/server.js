import { createServer } from 'node:http';
import { randomInt, randomUUID } from 'node:crypto';
import { WebSocketServer, WebSocket } from 'ws';

const host = process.env.HOST || '0.0.0.0';
const port = Number(process.env.PORT || 8787);
const maxPayload = 30 * 1024 * 1024;
const maxRoomPeers = 16;
const maxActiveRooms = 1000;
const rooms = new Map();
const connectionAttempts = new Map();
const activityActions = new Set(['drag-start', 'drag-end', 'add', 'delete']);

function json(response, status, body) {
  response.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'access-control-allow-origin': '*',
  });
  response.end(JSON.stringify(body));
}

const httpServer = createServer((request, response) => {
  const path = new URL(request.url || '/', `http://${request.headers.host || 'localhost'}`).pathname;
  if (request.method === 'GET' && path === '/health') {
    json(response, 200, { service: 'Block3D collaboration', rooms: rooms.size });
    return;
  }
  json(response, 404, { error: 'Not found' });
});

const sockets = new WebSocketServer({
  noServer: true,
  maxPayload,
  perMessageDeflate: false,
});

function send(socket, packet) {
  if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(packet));
}

function roomCode() {
  for (let tries = 0; tries < 100; tries++) {
    const code = String(randomInt(1_000_000)).padStart(6, '0');
    if (!rooms.has(code)) return code;
  }
  throw new Error('Could not allocate a room code. Please try again.');
}

function presence(room) {
  const packet = { type: 'presence', count: room.peers.size };
  for (const peer of room.peers) send(peer, packet);
}

function detach(socket) {
  const code = socket.roomCode;
  if (!code) return;
  const room = rooms.get(code);
  socket.roomCode = null;
  if (!room) return;
  room.peers.delete(socket);
  if (room.peers.size === 0) {
    rooms.delete(code);
    return;
  }
  presence(room);
}

function reject(socket, message) {
  send(socket, { type: 'error', message });
  socket.close(1008, message.slice(0, 120));
}

function join(socket, request) {
  const name = typeof request.name === 'string' ? request.name.trim().slice(0, 32) : '';
  let room;
  let isHost = false;
  if (request.type === 'create') {
    if (rooms.size >= maxActiveRooms) {
      reject(socket, 'The collaboration server is full. Please try again later.');
      return;
    }
    const code = roomCode();
    room = { code, peers: new Set(), snapshot: null, createdAt: Date.now() };
    rooms.set(code, room);
    isHost = true;
  } else {
    const code = typeof request.room === 'string' ? request.room : '';
    if (!/^\d{6}$/.test(code)) {
      reject(socket, 'Room codes must contain six digits.');
      return;
    }
    room = rooms.get(code);
    if (!room) {
      reject(socket, 'That room does not exist. Check the code or ask the host to create a new room.');
      return;
    }
  }
  if (room.peers.size >= maxRoomPeers) {
    if (isHost) rooms.delete(room.code);
    reject(socket, `This room is full (maximum ${maxRoomPeers} participants).`);
    return;
  }
  socket.roomCode = room.code;
  socket.clientId = randomUUID();
  socket.displayName = name || 'Guest';
  room.peers.add(socket);
  send(socket, { type: 'joined', room: room.code, peerId: socket.clientId, isHost, count: room.peers.size });
  if (room.snapshot) send(socket, { type: 'state', data: room.snapshot.data, revision: room.snapshot.revision });
  else if (!isHost) send(socket, { type: 'waiting' });
  presence(room);
  console.log(`Room ${isHost ? 'created' : 'joined'} (${room.peers.size} participant${room.peers.size === 1 ? '' : 's'}).`);
}

sockets.on('connection', socket => {
  socket.roomCode = null;
  socket.clientId = null;
  socket.lastSnapshotAt = 0;
  socket.on('message', raw => {
    let packet;
    try {
      packet = JSON.parse(raw.toString());
    } catch {
      reject(socket, 'Messages must be valid JSON.');
      return;
    }
    if (!packet || typeof packet !== 'object' || Array.isArray(packet)) {
      reject(socket, 'The collaboration message is invalid.');
      return;
    }
    if (!socket.roomCode) {
      if (packet.type !== 'create' && packet.type !== 'join') {
        reject(socket, 'Create or join a room before sending edits.');
        return;
      }
      try {
        join(socket, packet);
      } catch (error) {
        reject(socket, error.message);
      }
      return;
    }
    if (packet.type === 'leave') {
      detach(socket);
      socket.close(1000, 'left room');
      return;
    }
    if (packet.type === 'activity') {
      if (!activityActions.has(packet.action)) {
        reject(socket, 'The collaboration activity is invalid.');
        return;
      }
      const now = Date.now();
      if (packet.action === 'add' || packet.action === 'delete') {
        if (now - socket.lastActivityAt < 30) return;
        socket.lastActivityAt = now;
      }
      const room = rooms.get(socket.roomCode);
      if (!room) {
        reject(socket, 'The room has closed.');
        return;
      }
      const message = {
        type: 'activity',
        peerId: socket.clientId,
        name: socket.displayName,
        action: packet.action,
        block: typeof packet.block === 'string' ? packet.block.slice(0, 80) : 'block',
      };
      for (const peer of room.peers) {
        if (peer !== socket && peer.readyState === WebSocket.OPEN) send(peer, message);
      }
      return;
    }
    if (packet.type !== 'snapshot' || !packet.data || packet.data.format !== 'Block3D' || packet.data.version !== 1 || !Array.isArray(packet.data.sprites)) {
      reject(socket, 'The shared project snapshot is invalid.');
      return;
    }
    const now = Date.now();
    if (now - socket.lastSnapshotAt < 50) {
      send(socket, { type: 'error', message: 'Updates are arriving too quickly. Please wait a moment and try again.' });
      return;
    }
    socket.lastSnapshotAt = now;
    const room = rooms.get(socket.roomCode);
    if (!room) {
      reject(socket, 'The room has closed.');
      return;
    }
    const snapshot = { data: packet.data, revision: Number.isSafeInteger(packet.revision) ? packet.revision : 0 };
    const message = JSON.stringify({ type: 'state', data: snapshot.data, revision: snapshot.revision });
    if (Buffer.byteLength(message) > maxPayload) {
      send(socket, { type: 'error', message: 'This project is too large to share in a live room.' });
      return;
    }
    room.snapshot = snapshot;
    for (const peer of room.peers) {
      if (peer !== socket && peer.readyState === WebSocket.OPEN) peer.send(message);
    }
  });
  socket.on('close', () => detach(socket));
  socket.on('error', error => console.warn('WebSocket client error:', error.message));
});

httpServer.on('upgrade', (request, socket, head) => {
  const pathname = new URL(request.url || '/', `http://${request.headers.host || 'localhost'}`).pathname;
  if (pathname !== '/collaboration') {
    socket.write('HTTP/1.1 404 Not Found\r\nConnection: close\r\n\r\n');
    socket.destroy();
    return;
  }
  const ip = request.socket.remoteAddress || 'unknown';
  const now = Date.now();
  const recent = (connectionAttempts.get(ip) || []).filter(timestamp => now - timestamp < 60_000);
  if (recent.length >= 40) {
    socket.write('HTTP/1.1 429 Too Many Requests\r\nConnection: close\r\n\r\n');
    socket.destroy();
    return;
  }
  recent.push(now);
  connectionAttempts.set(ip, recent);
  sockets.handleUpgrade(request, socket, head, client => sockets.emit('connection', client, request));
});

const cleanup = setInterval(() => {
  const now = Date.now();
  for (const [ip, attempts] of connectionAttempts) {
    const active = attempts.filter(timestamp => now - timestamp < 60_000);
    if (active.length) connectionAttempts.set(ip, active);
    else connectionAttempts.delete(ip);
  }
}, 60_000);
cleanup.unref();

httpServer.listen(port, host, () => {
  console.log(`Block3D collaboration server listening on http://${host}:${port}`);
  console.log(`Local WebSocket URL: ws://127.0.0.1:${port}/collaboration`);
  console.log('For internet access, put this service behind HTTPS/WSS and use the resulting wss:// URL.');
});

function shutdown() {
  clearInterval(cleanup);
  for (const client of sockets.clients) client.close(1001, 'server shutting down');
  sockets.close();
  httpServer.close(() => process.exit(0));
  setTimeout(() => process.exit(1), 5_000).unref();
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
