export type WebSocketConnectionState =
  | "disconnected"
  | "connecting"
  | "connected"
  | "reconnecting";

export interface DomainEventEnvelope {
  event: "connected" | "pong" | "domain_event";
  type?: string;
  tenant_id?: string;
  payload?: Record<string, unknown>;
  timestamp?: string;
}

export type RealtimeListener = (message: DomainEventEnvelope) => void;
export type StatusListener = (state: WebSocketConnectionState) => void;

export function buildWebSocketUrl(apiBaseUrl: string, token: string): string {
  const encodedToken = encodeURIComponent(token);
  const trimmed = apiBaseUrl.trim().replace(/\/+$/, "");

  if (trimmed.length > 0) {
    const wsBase = trimmed
      .replace(/^https:\/\//i, "wss://")
      .replace(/^http:\/\//i, "ws://");
    return `${wsBase}/api/v1/ws?token=${encodedToken}`;
  }

  if (typeof window !== "undefined") {
    const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
    return `${proto}//${window.location.host}/api/v1/ws?token=${encodedToken}`;
  }

  return `ws://127.0.0.1:3000/api/v1/ws?token=${encodedToken}`;
}

export class StockAgentRealtimeClient {
  private socket: WebSocket | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private pingTimer: ReturnType<typeof setInterval> | null = null;
  private manuallyClosed = false;
  private retryAttempt = 0;
  private state: WebSocketConnectionState = "disconnected";
  private readonly listeners = new Set<RealtimeListener>();
  private readonly statusListeners = new Set<StatusListener>();
  private token = "";
  private apiBaseUrl = "";

  onEvent(listener: RealtimeListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  onStatusChange(listener: StatusListener): () => void {
    this.statusListeners.add(listener);
    listener(this.state);
    return () => {
      this.statusListeners.delete(listener);
    };
  }

  private setState(next: WebSocketConnectionState): void {
    if (this.state === next) {
      return;
    }
    this.state = next;
    for (const listener of this.statusListeners) {
      listener(next);
    }
  }

  connect(apiBaseUrl: string, token: string): void {
    this.disconnect();
    if (!token || typeof WebSocket === "undefined") {
      return;
    }
    this.token = token;
    this.apiBaseUrl = apiBaseUrl;
    this.manuallyClosed = false;
    this.retryAttempt = 0;
    this.openSocket(false);
  }

  private openSocket(isRetry: boolean): void {
    this.clearTimers();
    this.setState(isRetry ? "reconnecting" : "connecting");

    const url = buildWebSocketUrl(this.apiBaseUrl, this.token);
    const ws = new WebSocket(url);
    this.socket = ws;

    ws.onopen = () => {
      if (this.socket !== ws) return;
      this.retryAttempt = 0;
      this.setState("connected");
      this.pingTimer = setInterval(() => {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: "ping" }));
        }
      }, 25_000);
    };

    ws.onmessage = (event) => {
      if (typeof event.data !== "string") return;
      try {
        const parsed = JSON.parse(event.data) as DomainEventEnvelope;
        for (const listener of this.listeners) {
          listener(parsed);
        }
      } catch {
        // Ignorar frames malformados
      }
    };

    ws.onclose = (event) => {
      if (this.socket === ws) {
        this.socket = null;
      }
      this.clearTimers();
      if (this.manuallyClosed || event.code === 1008) {
        this.setState("disconnected");
        return;
      }
      this.scheduleReconnect();
    };

    ws.onerror = () => {
      // El evento onclose se encargará de reconectar
    };
  }

  private scheduleReconnect(): void {
    const delays = [1000, 2000, 5000, 10000, 20000, 30000];
    const delayMs = delays[Math.min(this.retryAttempt, delays.length - 1)] ?? 30000;
    this.retryAttempt += 1;
    this.setState("reconnecting");
    this.reconnectTimer = setTimeout(() => {
      if (!this.manuallyClosed && this.token) {
        this.openSocket(true);
      }
    }, delayMs);
  }

  private clearTimers(): void {
    if (this.reconnectTimer !== null) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.pingTimer !== null) {
      clearInterval(this.pingTimer);
      this.pingTimer = null;
    }
  }

  disconnect(): void {
    this.manuallyClosed = true;
    this.clearTimers();
    if (this.socket) {
      try {
        this.socket.close(1000, "client_disconnect");
      } catch {
        // noop
      }
      this.socket = null;
    }
    this.setState("disconnected");
  }
}
