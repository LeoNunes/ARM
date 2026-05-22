import { createServer } from "node:net";

export async function pickFreePort(start: number): Promise<number> {
  for (let p = start; p < start + 100; p++) {
    if (await isFree(p)) return p;
  }
  throw new Error("no free port found");
}

function isFree(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const s = createServer();
    s.once("error", () => resolve(false));
    s.listen(port, "127.0.0.1", () => {
      s.close(() => resolve(true));
    });
  });
}
