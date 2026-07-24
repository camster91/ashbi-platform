import { useState, useEffect, useRef } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api';

export default function TimeTracker({ projectId, taskId }) {
  const queryClient = useQueryClient();
  const [isTracking, setIsTracking] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [showForm, setShowForm] = useState(false);
  const timerIntervalRef = useRef(null);

  useEffect(() => () => {
    if (timerIntervalRef.current) clearInterval(timerIntervalRef.current);
  }, []);

  const startTimer = () => {
    setIsTracking(true);
    const interval = setInterval(() => {
      setElapsed((prev) => prev + 1);
    }, 1000);
    timerIntervalRef.current = interval;
  };

  const stopTimer = () => {
    setIsTracking(false);
    if (timerIntervalRef.current) {
      clearInterval(timerIntervalRef.current);
      timerIntervalRef.current = null;
    }
    setShowForm(true);
    setElapsed(0);
    return Math.ceil(elapsed / 60);
  };
