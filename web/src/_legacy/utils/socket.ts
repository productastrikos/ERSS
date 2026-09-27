/**
 * Socket.IO client singleton — connects to the DSO Emergency Response server.
 * Import `getSocket()` wherever you need real-time communication.
 */
import { io, type Socket } from 'socket.io-client';

const SOCKET_URL = 'https://socket-dso.astrikos.xyz:8443';

let _socket: Socket | null = null;

export function getSocket(): Socket {
  if (!_socket) {
    _socket = io(SOCKET_URL, {
      autoConnect:          true,
      reconnection:         true,
      reconnectionAttempts: 10,
      reconnectionDelay:    2000,
    });
  }
  return _socket;
}

export function disconnectSocket(): void {
  if (_socket) {
    _socket.disconnect();
    _socket = null;
  }
}

export interface OnlineUser {
  userId: string;
  name:   string;
  role:   string;
  status: 'available' | 'busy';
}
