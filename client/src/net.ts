import { useStore } from './store';
import type { ServerEvent } from '../../shared/types';

let retry = 0;

export function connect() {
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  const ws = new WebSocket(`${proto}://${location.host}/ws`);
  ws.onopen = () => {
    retry = 0;
    useStore.getState().setConnected(true);
  };
  ws.onmessage = (e) => {
    try {
      useStore.getState().apply(JSON.parse(e.data) as ServerEvent);
    } catch (err) {
      console.error('bad server event', err);
    }
  };
  ws.onclose = () => {
    useStore.getState().setConnected(false);
    setTimeout(connect, Math.min(8000, 500 * 2 ** retry++));
  };
}
