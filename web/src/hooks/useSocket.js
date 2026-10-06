import { useEffect, useState, useCallback } from 'react';
import { io } from 'socket.io-client';
import { useAuth } from './useAuth';
import { useQueryClient } from '@tanstack/react-query';

// Same origin in every mode: in dev the Vite proxy forwards /socket.io to the API.
const SOCKET_URL = window.location.origin;

let sharedSocket = null;
let sharedUserId = null;
let subscriberCount = 0;
let teardownTimer = null;

// How long the shared socket outlives its last subscriber. React StrictMode
// (dev) mounts, unmounts and remounts every component at once, and the shell
// remounts between some routes; closing the socket in that gap, while it was
// still handshaking, opened a second connection and logged "WebSocket is
// closed before the connection is established" on every staff page.
const TEARDOWN_DELAY_MS = 1000;

function attachSocketHandlers(socket, queryClient) {
  socket.on('notification', (data) => {
    switch (data.type) {
      case 'THREAD_ASSIGNED':
        queryClient.invalidateQueries(['inbox']);
        queryClient.invalidateQueries(['thread', data.data?.threadId]);
        break;
      case 'RESPONSE_APPROVED':
      case 'RESPONSE_REJECTED':
        queryClient.invalidateQueries(['responses']);
        queryClient.invalidateQueries(['thread', data.data?.threadId]);
        break;
      case 'CLIENT_REPLIED':
        queryClient.invalidateQueries(['inbox']);
        queryClient.invalidateQueries(['thread', data.data?.threadId]);
        break;
      case 'PROJECT_HEALTH_CHANGED':
        queryClient.invalidateQueries(['projects']);
        queryClient.invalidateQueries(['project', data.data?.projectId]);
        break;
      case 'SLA_WARNING':
      case 'SLA_BREACH':
        queryClient.invalidateQueries(['inbox']);
        break;
      default:
        queryClient.invalidateQueries(['inbox-stats']);
    }
  });

  socket.on('thread:updated', (data) => {
    queryClient.invalidateQueries(['thread', data.threadId]);
    queryClient.invalidateQueries(['inbox']);
  });

  socket.on('message:new', (data) => {
    queryClient.invalidateQueries(['thread', data.threadId]);
    queryClient.invalidateQueries(['inbox']);
  });

  socket.on('project:updated', (data) => {
    queryClient.invalidateQueries(['project', data.projectId]);
    queryClient.invalidateQueries(['projects']);
  });
}

function createSharedSocket(userId, queryClient) {
  const socket = io(SOCKET_URL, {
    withCredentials: true,
    transports: ['websocket', 'polling'],
  });
  socket.on('connect', () => {
    socket.emit('join', userId);
  });
  socket.on('disconnect', (reason) => {
    // The server drops a user's sockets when their identity changes (a
    // support view starts). Socket.IO does not retry a server-side
    // disconnect, so reconnect; the handshake decides who may.
    if (reason === 'io server disconnect' && sharedSocket === socket) socket.connect();
  });
  attachSocketHandlers(socket, queryClient);
  return socket;
}

/** For tests: forget the shared socket. */
export function resetSharedSocketForTests() {
  if (teardownTimer) clearTimeout(teardownTimer);
  teardownTimer = null;
  sharedSocket?.disconnect();
  sharedSocket = null;
  sharedUserId = null;
  subscriberCount = 0;
}

export function useSocket() {
  const { user } = useAuth();
  const userId = user?.id ?? null;
  const queryClient = useQueryClient();
  const [isConnected, setIsConnected] = useState(false);
  const [notifications, setNotifications] = useState([]);
  const [socket, setSocket] = useState(null);

  useEffect(() => {
    // No socket before sign-in, and none on public pages (no user there).
    if (!userId) return undefined;

    if (teardownTimer) {
      clearTimeout(teardownTimer);
      teardownTimer = null;
    }
    subscriberCount += 1;

    if (!sharedSocket || sharedUserId !== userId) {
      sharedSocket?.disconnect();
      sharedSocket = createSharedSocket(userId, queryClient);
      sharedUserId = userId;
    }

    const current = sharedSocket;
    // Each subscriber tracks the connection and the live notifications itself.
    const handleConnect = () => setIsConnected(true);
    const handleDisconnect = () => setIsConnected(false);
    const handleNotification = (data) => setNotifications((prev) => [data, ...prev].slice(0, 50));
    current.on('connect', handleConnect);
    current.on('disconnect', handleDisconnect);
    current.on('notification', handleNotification);
    setIsConnected(current.connected);
    setSocket(current);

    return () => {
      current.off('connect', handleConnect);
      current.off('disconnect', handleDisconnect);
      current.off('notification', handleNotification);
      subscriberCount = Math.max(0, subscriberCount - 1);
      if (subscriberCount === 0) {
        if (teardownTimer) clearTimeout(teardownTimer);
        teardownTimer = setTimeout(() => {
          teardownTimer = null;
          if (subscriberCount === 0 && sharedSocket === current) {
            current.disconnect();
            sharedSocket = null;
            sharedUserId = null;
          }
        }, TEARDOWN_DELAY_MS);
      }
    };
  }, [userId, queryClient]);

  const clearNotifications = useCallback(() => {
    setNotifications([]);
  }, []);

  const removeNotification = useCallback((id) => {
    setNotifications((prev) => prev.filter((n) => n.id !== id));
  }, []);

  return {
    isConnected,
    notifications,
    clearNotifications,
    removeNotification,
    socket,
  };
}

export default useSocket;
