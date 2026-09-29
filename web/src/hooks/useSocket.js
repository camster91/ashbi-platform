import { useEffect, useState, useCallback, useRef } from 'react';
import { io } from 'socket.io-client';
import { useAuth } from './useAuth';
import { useQueryClient } from '@tanstack/react-query';

// Same origin in every mode: in dev the Vite proxy forwards /socket.io to the API.
const SOCKET_URL = window.location.origin;

let sharedSocket = null;
let sharedUserId = null;
let subscriberCount = 0;

function attachSocketHandlers(socket, queryClient, setNotifications) {
  socket.on('notification', (data) => {
    setNotifications((prev) => [data, ...prev].slice(0, 50));
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

export function useSocket() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [isConnected, setIsConnected] = useState(false);
  const [notifications, setNotifications] = useState([]);
  const socketRef = useRef(null);

  useEffect(() => {
    if (!user) return undefined;

    subscriberCount += 1;

    if (!sharedSocket || sharedUserId !== user.id) {
      sharedSocket?.disconnect();
      const socket = io(SOCKET_URL, {
        withCredentials: true,
        transports: ['websocket', 'polling'],
      });
      sharedSocket = socket;
      sharedUserId = user.id;

      sharedSocket.on('connect', () => {
        setIsConnected(true);
        sharedSocket.emit('join', user.id);
      });

      sharedSocket.on('disconnect', (reason) => {
        setIsConnected(false);
        // The server drops a user's sockets when their identity changes (a
        // support view starts). Socket.IO does not retry a server-side
        // disconnect, so reconnect; the handshake decides who may.
        if (reason === 'io server disconnect' && sharedSocket === socket) socket.connect();
      });

      attachSocketHandlers(sharedSocket, queryClient, setNotifications);
    } else {
      setIsConnected(sharedSocket.connected);
    }

    socketRef.current = sharedSocket;

    return () => {
      subscriberCount -= 1;
      if (subscriberCount <= 0) {
        sharedSocket?.disconnect();
        sharedSocket = null;
        sharedUserId = null;
        subscriberCount = 0;
      }
    };
  }, [user, queryClient]);

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
    socket: socketRef.current,
  };
}

export default useSocket;
