/**
 * Heartbeat/reconnect feed adapted from somnia-chain/dreamdex-bot-kit
 * under its MIT-style license.
 */
import WebSocket from "ws";

export class DreamDexWs {
  private socket?: WebSocket;
  private heartbeat?: NodeJS.Timeout;
  private reconnectDelay = 1_000;
  private closed = false;
  lastMessageAt = 0;

  constructor(
    private readonly url: string,
    private readonly symbol: string,
    private readonly onBook: () => void,
  ) {}

  connect(): void {
    this.closed = false;
    const socket = new WebSocket(this.url);
    this.socket = socket;
    socket.on("open", () => {
      this.reconnectDelay = 1_000;
      socket.send(
        JSON.stringify({
          operation: "subscribe",
          channel: "orderbook",
          params: { symbols: [this.symbol] },
        }),
      );
      this.heartbeat = setInterval(() => {
        if (socket.readyState === WebSocket.OPEN) {
          socket.send(JSON.stringify({ operation: "ping" }));
        }
      }, 30_000);
    });
    socket.on("message", (raw) => {
      try {
        const message = JSON.parse(raw.toString()) as Record<string, unknown>;
        if (message.operation === "pong") return;
        this.lastMessageAt = Date.now();
        if (message.channel === "orderbook" || message.type === "orderbook") this.onBook();
      } catch {
        // Ignore malformed frames; staleness protection remains active.
      }
    });
    socket.on("error", () => socket.close());
    socket.on("close", () => this.scheduleReconnect());
  }

  close(): void {
    this.closed = true;
    if (this.heartbeat) clearInterval(this.heartbeat);
    this.socket?.close();
  }

  private scheduleReconnect(): void {
    if (this.heartbeat) clearInterval(this.heartbeat);
    if (this.closed) return;
    const delay = this.reconnectDelay;
    this.reconnectDelay = Math.min(delay * 2, 30_000);
    setTimeout(() => this.connect(), delay);
  }
}
