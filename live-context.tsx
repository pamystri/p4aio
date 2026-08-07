'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from 'react';
import { io, type Socket } from 'socket.io-client';
import { apiBaseUrl, apiKey } from '@/core/api/client';

interface LiveState { connected: boolean; lastUpdate: Date | null; generation: number; refresh: () => void; autoRefresh: boolean; setAutoRefresh: (value: boolean) => void }
const LiveContext = createContext<LiveState | null>(null);
const AUTO_REFRESH_EVENT = 'monitor:auto-refresh-change';
const subscribeAutoRefresh = (listener: () => void) => {
  window.addEventListener('storage', listener);
  window.addEventListener(AUTO_REFRESH_EVENT, listener);
  return () => { window.removeEventListener('storage', listener); window.removeEventListener(AUTO_REFRESH_EVENT, listener); };
};
const autoRefreshSnapshot = () => localStorage.getItem('monitor.autoRefresh') !== 'false';
const autoRefreshServerSnapshot = () => true;

export function LiveProvider({ children }: { children: ReactNode }) {
  const [connected, setConnected] = useState(false);
  const [lastUpdate, setLastUpdate] = useState<Date | null>(null);
  const [generation, setGeneration] = useState(0);
  const queuedRefresh = useRef<number | null>(null);
  const autoRefresh = useSyncExternalStore(subscribeAutoRefresh, autoRefreshSnapshot, autoRefreshServerSnapshot);
  const performRefresh = useCallback(() => { setGeneration((value) => value + 1); setLastUpdate(new Date()); }, []);
  const refresh = useCallback(() => {
    if (queuedRefresh.current !== null) window.clearTimeout(queuedRefresh.current);
    queuedRefresh.current = null;
    performRefresh();
  }, [performRefresh]);
  const scheduleRefresh = useCallback(() => {
    if (queuedRefresh.current !== null) return;
    queuedRefresh.current = window.setTimeout(() => {
      queuedRefresh.current = null;
      performRefresh();
    }, 600);
  }, [performRefresh]);
  const setAutoRefresh = useCallback((value: boolean) => { localStorage.setItem('monitor.autoRefresh', String(value)); window.dispatchEvent(new Event(AUTO_REFRESH_EVENT)); }, []);

  useEffect(() => {
    const origin = new URL(apiBaseUrl(), window.location.origin).origin;
    const socket: Socket = io(`${origin}/live`, { transports: ['websocket'], auth: { apiKey: apiKey() }, reconnection: true });
    socket.on('connect', () => { setConnected(true); socket.emit('subscribe', { topics: ['collection.completed', 'metrics.updated', 'alarms.updated', 'locations.updated', 'system.health', 'radio.health', 'ntn.position.updated', 'ntn.pass.updated', 'ntn.ephemeris.updated'] }); });
    socket.on('disconnect', () => setConnected(false));
    for (const topic of ['collection.completed', 'metrics.updated', 'alarms.updated', 'locations.updated', 'ntn.pass.updated', 'ntn.ephemeris.updated']) socket.on(topic, scheduleRefresh);
    socket.on('ntn.position.updated', () => { if (window.location.pathname.startsWith('/map')) scheduleRefresh(); });
    return () => {
      socket.disconnect();
      if (queuedRefresh.current !== null) window.clearTimeout(queuedRefresh.current);
      queuedRefresh.current = null;
    };
  }, [scheduleRefresh]);
  useEffect(() => {
    if (!autoRefresh) return;
    const seconds = Number(process.env.NEXT_PUBLIC_REFRESH_SECONDS ?? 15);
    const timer = window.setInterval(refresh, Math.max(5, seconds) * 1000);
    return () => window.clearInterval(timer);
  }, [autoRefresh, refresh]);

  const value = useMemo(() => ({ connected, lastUpdate, generation, refresh, autoRefresh, setAutoRefresh }), [connected, lastUpdate, generation, refresh, autoRefresh, setAutoRefresh]);
  return <LiveContext.Provider value={value}>{children}</LiveContext.Provider>;
}

export function useLive(): LiveState {
  const value = useContext(LiveContext);
  if (!value) throw new Error('useLive must be used inside LiveProvider');
  return value;
}
