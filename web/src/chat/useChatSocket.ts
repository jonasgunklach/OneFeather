import { useEffect, useRef } from 'react';
import { getToken, API_BASE } from '../api';

type Handler = (msg: any) => void;

// Single shared WebSocket to the chat gateway. Components register a handler;
// the hook reconnects automatically and exposes send() for ephemeral signals.
export function useChatSocket(onEvent: Handler) {
  const wsRef = useRef<WebSocket | null>(null);
  const handlerRef = useRef<Handler>(onEvent);
  handlerRef.current = onEvent;

  useEffect(() => {
    let closed = false;
    let retry: any;
    const connect = () => {
      const token = getToken();
      if (!token) return;
      const url = `${API_BASE.replace(/^http/, 'ws')}/chat?token=${token}`;
      const ws = new WebSocket(url);
      wsRef.current = ws;
      ws.onmessage = (e) => { try { handlerRef.current(JSON.parse(e.data)); } catch {} };
      ws.onclose = () => { if (!closed) retry = setTimeout(connect, 1500); };
      ws.onerror = () => { try { ws.close(); } catch {} };
    };
    connect();
    return () => { closed = true; clearTimeout(retry); try { wsRef.current?.close(); } catch {} };
  }, []);

  const send = (obj: any) => { const ws = wsRef.current; if (ws && ws.readyState === 1) ws.send(JSON.stringify(obj)); };
  return send;
}
