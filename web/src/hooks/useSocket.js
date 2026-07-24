import { useEffect, useState, useCallback, useRef } from 'react';
import { io } from 'socket.io-client';
import { useAuth } from './useAuth';
import { useQueryClient } from '@tanstack/react-query';

const SOCKET_URL = import.meta.env.PROD ? window.location.origin : 'http://localhost:3000';

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
      sharedSocket = io(SOCKET_URL, {
        withCredentials: true,
        transports: ['websocket', 'polling'],
      });
      sharedUserId = user.id;

      sharedSocket.on('connect', () => {
        setIsConnected(true);
        sharedSocket.emit('join', user.id);
      });

      sharedSocket.on('disconnect', () => {
        setIsConnected(false);
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
