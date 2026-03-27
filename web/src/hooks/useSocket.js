import { useEffect, useState, useCallback, useRef } from 'react';
import { io } from 'socket.io-client';
import { useAuth } from './useAuth';
import { useQueryClient } from '@tanstack/react-query';

const SOCKET_URL = import.meta.env.PROD ? window.location.origin : 'http://localhost:3000';

export function useSocket() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [isConnected, setIsConnected] = useState(false);
  const [notifications, setNotifications] = useState([]);
  const socketRef = useRef(null);

  useEffect(() => {
    if (!user) return;

    // Create socket connection
    const socket = io(SOCKET_URL, {
      withCredentials: true,
      transports: ['websocket', 'polling'],
    });

    socketRef.current = socket;

    socket.on('connect', () => {
      console.log('Socket connected');
      setIsConnected(true);
      // Join user's room for personal notifications
      socket.emit('join', user.id);
    });

    socket.on('disconnect', () => {
      console.log('Socket disconnected');
      setIsConnected(false);
    });

    // Handle incoming notifications
    socket.on('notification', (data) => {
      console.log('Received notification:', data);
      setNotifications((prev) => [data, ...prev].slice(0, 50));

      // Invalidate relevant queries based on notification type
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
          // General refresh
          queryClient.invalidateQueries(['inbox-stats']);
      }
    });

    // Handle thread updates
    socket.on('thread:updated', (data) => {
      queryClient.invalidateQueries(['thread', data.threadId]);
      queryClient.invalidateQueries(['inbox']);
    });

    // Handle new messages
    socket.on('message:new', (data) => {
      queryClient.invalidateQueries(['thread', data.threadId]);
      queryClient.invalidateQueries(['inbox']);
    });

    // Handle project updates
    socket.on('project:updated', (data) => {
      queryClient.invalidateQueries(['project', data.projectId]);
      queryClient.invalidateQueries(['projects']);
    });

    return () => {
      socket.disconnect();
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
