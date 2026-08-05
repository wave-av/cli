/**
 * SSE Client for WAVE CLI
 *
 * Connects to Server-Sent Events endpoints for real-time streaming.
 * Handles auto-reconnect with exponential backoff, clean shutdown,
 * and SSE protocol parsing (data, event, id, retry lines).
 */

export interface SSEEvent {
  id?: string;
  event?: string;
  data: string;
  retry?: number;
}

export interface SSEClientOptions {
  onEvent: (event: SSEEvent) => void;
  onError?: (error: Error) => void;
  onClose?: () => void;
  onConnect?: () => void;
  /** Maximum reconnect attempts before giving up (default: 10) */
  maxReconnectAttempts?: number;
  /** Initial reconnect delay in ms (default: 1000) */
  initialReconnectDelay?: number;
  /** Maximum reconnect delay in ms (default: 30000) */
  maxReconnectDelay?: number;
}

/**
 * Connects to an SSE endpoint and streams events.
 *
 * @param url - The SSE endpoint URL
 * @param apiKey - Bearer token for authentication
 * @param options - Event handlers and configuration
 * @returns AbortController to disconnect the stream
 */
export async function connectSSE(
  url: string,
  apiKey: string,
  options: SSEClientOptions,
): Promise<AbortController> {
  const controller = new AbortController();
  const maxAttempts = options.maxReconnectAttempts ?? 10;
  const initialDelay = options.initialReconnectDelay ?? 1000;
  const maxDelay = options.maxReconnectDelay ?? 30000;
  let reconnectAttempts = 0;
  let lastEventId: string | undefined;

  // Handle process signals for clean shutdown
  const cleanup = () => {
    controller.abort();
  };
  process.on("SIGINT", cleanup);
  process.on("SIGTERM", cleanup);

  async function connect(): Promise<void> {
    if (controller.signal.aborted) return;

    try {
      const headers: Record<string, string> = {
        Accept: "text/event-stream",
        "Cache-Control": "no-cache",
        Authorization: `Bearer ${apiKey}`,
      };

      if (lastEventId) {
        headers["Last-Event-ID"] = lastEventId;
      }

      const response = await fetch(url, {
        headers,
        signal: controller.signal,
      });

      if (!response.ok) {
        throw new Error(`SSE connection failed: ${response.status} ${response.statusText}`);
      }

      if (!response.body) {
        throw new Error("SSE response has no body");
      }

      // Reset reconnect attempts on successful connection
      reconnectAttempts = 0;
      options.onConnect?.();

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      // Current event being assembled
      let currentEvent: Partial<SSEEvent> = {};

      while (!controller.signal.aborted) {
        const { done, value } = await reader.read();
        if (done) {
          throw new Error("SSE connection closed");
        }

        buffer += decoder.decode(value, { stream: true });

        // Process complete lines
        const lines = buffer.split("\n");
        // Keep the last incomplete line in the buffer
        buffer = lines.pop() ?? "";

        for (const line of lines) {
          if (line === "") {
            // Empty line = end of event, dispatch it
            if (currentEvent.data !== undefined) {
              const event: SSEEvent = {
                id: currentEvent.id,
                event: currentEvent.event,
                data: currentEvent.data,
                retry: currentEvent.retry,
              };

              if (event.id) {
                lastEventId = event.id;
              }

              options.onEvent(event);
            }
            currentEvent = {};
          } else if (line.startsWith(":")) {
            // Comment line - ignore (heartbeat)
          } else if (line.startsWith("data:")) {
            const value = line.slice(5).trimStart();
            currentEvent.data =
              currentEvent.data !== undefined ? `${currentEvent.data}\n${value}` : value;
          } else if (line.startsWith("event:")) {
            currentEvent.event = line.slice(6).trimStart();
          } else if (line.startsWith("id:")) {
            currentEvent.id = line.slice(3).trimStart();
          } else if (line.startsWith("retry:")) {
            const retry = parseInt(line.slice(6).trimStart(), 10);
            if (!isNaN(retry)) {
              currentEvent.retry = retry;
            }
          }
        }
      }
    } catch (error: unknown) {
      if (controller.signal.aborted) {
        // Intentional disconnect
        options.onClose?.();
        return;
      }

      const err = error instanceof Error ? error : new Error(String(error));
      options.onError?.(err);

      // Attempt reconnection with exponential backoff
      if (reconnectAttempts < maxAttempts) {
        reconnectAttempts++;
        const delay = Math.min(initialDelay * Math.pow(2, reconnectAttempts - 1), maxDelay);
        await new Promise((resolve) => setTimeout(resolve, delay));

        if (!controller.signal.aborted) {
          return connect();
        }
      } else {
        options.onError?.(new Error(`Max reconnect attempts (${maxAttempts}) exceeded`));
        options.onClose?.();
      }
    }
  }

  // Start connection (non-blocking)
  connect().catch((error: unknown) => {
    const err = error instanceof Error ? error : new Error(String(error));
    options.onError?.(err);
  });

  // Clean up signal handlers when abort is called
  controller.signal.addEventListener("abort", () => {
    process.removeListener("SIGINT", cleanup);
    process.removeListener("SIGTERM", cleanup);
  });

  return controller;
}
