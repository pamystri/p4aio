'use client';

import { useEffect, useState } from 'react';
import { apiFetch } from './client';
import { useLive } from '@/core/live/live-context';

export function useApi<T>(path: string | null) {
  const { generation } = useLive();
  const requestKey = path === null ? null : `${generation}:${path}`;
  const [result, setResult] = useState<{ requestKey: string | null; path: string | null; data: T | null; error: string | null }>({ requestKey: null, path: null, data: null, error: null });
  useEffect(() => {
    if (!path || !requestKey) return;
    const controller = new AbortController();
    void apiFetch<T>(path, controller.signal)
      .then((data) => { if (!controller.signal.aborted) setResult({ requestKey, path, data, error: null }); })
      .catch((reason: unknown) => {
        if (!controller.signal.aborted) setResult((previous) => ({
          requestKey,
          path,
          data: previous.path === path ? previous.data : null,
          error: reason instanceof Error ? reason.message : 'Unable to load data',
        }));
      });
    return () => controller.abort();
  }, [path, requestKey]);
  const data = result.path === path ? result.data : null;
  const settled = requestKey !== null && result.requestKey === requestKey;
  return {
    data,
    error: settled ? result.error : null,
    loading: requestKey !== null && data === null && !settled,
    refreshing: requestKey !== null && data !== null && !settled,
  };
}
