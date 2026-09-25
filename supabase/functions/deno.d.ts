// The slice of Deno's runtime API the Edge Functions use, so `vp check` can
// type-check them without Deno installed. Deno itself brings the real types.
declare namespace Deno {
  export const env: { get(name: string): string | undefined };
  export function serve(handler: (req: Request) => Response | Promise<Response>): unknown;
  export interface Conn {
    read(p: Uint8Array): Promise<number | null>;
    write(p: Uint8Array): Promise<number>;
    close(): void;
  }
  export function connectTls(options: { hostname: string; port: number }): Promise<Conn>;
}
