// Asking maps.app.goo.gl where a short link points (#9), with no
// User-Agent and without following the redirect. fetch() always adds a
// User-Agent of its own, and a browser-like one is served a JavaScript page
// with no Location header, so the request is written by hand over TLS
// (redirectRequest) and only the reply's head is read (readReply).

import {
  readReply,
  redirectRequest,
  type Reply,
} from "../../../apps/web/src/proposals/mapsLink.ts";

/** How long Google gets to answer before there is no answer this time. */
const TIMEOUT_MS = 5000;
/** A redirect's head is well under this; anything longer is not one. */
const MAX_HEAD_BYTES = 32 * 1024;

/**
 * What Google answers about the short link. A timeout, or a connection or
 * TLS failure, is "unavailable", like a 5xx: no answer this time.
 */
export async function askWhereItPoints(link: URL): Promise<Reply> {
  let conn: Deno.Conn | undefined;
  let over = false;
  const close = () => {
    try {
      conn?.close();
    } catch {
      // Already closed.
    }
  };
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timedOut = new Promise<Reply>((resolve) => {
    timer = setTimeout(() => {
      over = true;
      close();
      resolve("unavailable");
    }, TIMEOUT_MS);
  });

  async function ask(): Promise<Reply> {
    conn = await Deno.connectTls({ hostname: link.hostname, port: 443 });
    // A connection that opened only after the time ran out is not used.
    if (over) {
      close();
      return "unavailable";
    }
    const request = new TextEncoder().encode(redirectRequest(link));
    for (let sent = 0; sent < request.length;) {
      sent += await conn.write(request.subarray(sent));
    }
    // Read only as far as the end of the head; the body is never wanted.
    const decoder = new TextDecoder();
    const chunk = new Uint8Array(4096);
    let head = "";
    let received = 0;
    while (!head.includes("\r\n\r\n") && received < MAX_HEAD_BYTES) {
      const read = await conn.read(chunk);
      if (read === null) break;
      received += read;
      head += decoder.decode(chunk.subarray(0, read), { stream: true });
    }
    // A head cut short never reaches its end, and is no answer.
    if (!head.includes("\r\n\r\n")) return "unavailable";
    return readReply(head.split("\r\n\r\n")[0] ?? "");
  }

  try {
    return await Promise.race([ask(), timedOut]);
  } catch {
    return "unavailable";
  } finally {
    over = true;
    clearTimeout(timer);
    close();
  }
}
