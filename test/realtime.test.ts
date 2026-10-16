import { it, expect, beforeAll, afterAll } from "vitest";
import { spawn, type ChildProcess } from "node:child_process";
import { createServer, type Server } from "node:http";
import { cpSync, mkdirSync, rmSync, existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join, dirname, normalize, extname } from "node:path";
import { fileURLToPath } from "node:url";
import { SONGS } from "../web/songs.js";

const here = dirname(fileURLToPath(import.meta.url));
const webDir = join(here, "..", "web");
const fixturesSrc = join(here, "fixtures");
const fixturesDst = join(webDir, "fixtures");
const PORT = 8081;
const URL = `http://localhost:${PORT}/verify-realtime.html`;
const TIMEOUT_MS = 600000;

interface VerifySong {
  name: string;
  ok: boolean;
  error?: string;
  maxDiff: number;
  diffCount: number;
  total: number;
}

let server: Server | null = null;
let chromium: ChildProcess | null = null;
let waitResultFn: ((timeoutMs: number) => Promise<string>) | null = null;

function startServer(): Promise<{ port: number; waitResult: (timeoutMs: number) => Promise<string> }> {
  let resolveResult: ((s: string) => void) | null = null;
  const waitResult = (timeoutMs: number): Promise<string> =>
    new Promise((resolve, reject) => {
      resolveResult = resolve;
      setTimeout(() => reject(new Error("result POST timeout")), timeoutMs);
    });

  const srv = createServer(async (req, res) => {
    if (req.method === "POST" && req.url === "/result") {
      let body = "";
      for await (const c of req) body += c;
      resolveResult?.(body);
      res.end("ok");
      return;
    }
    try {
      const urlPath = decodeURIComponent((req.url ?? "/").split("?")[0] ?? "/");
      const filePath = normalize(join(webDir, urlPath));
      if (!filePath.startsWith(normalize(webDir))) {
        res.writeHead(403);
        res.end();
        return;
      }
      const data = await readFile(filePath);
      const ext = extname(filePath);
      const mime =
        ext === ".html" ? "text/html" : ext === ".js" ? "text/javascript" : "application/octet-stream";
      res.writeHead(200, { "content-type": mime });
      res.end(data);
    } catch {
      res.writeHead(404);
      res.end("not found");
    }
  });

  return new Promise((resolve) => {
    srv.listen(PORT, () => resolve({ port: PORT, waitResult }));
    server = srv;
  });
}

beforeAll(async () => {
  // バンドル未生成のまま実行すると結果が POST されず 10 分待ってしまうため、先に確認する
  const missing = ["verify-realtime.js", "player-worklet.js"].filter(
    (name) => !existsSync(join(webDir, name)),
  );
  if (missing.length > 0) {
    throw new Error(
      `web バンドルが見つかりません (${missing.join(", ")})。先に "pnpm build:web" を実行してください。`,
    );
  }
  mkdirSync(fixturesDst, { recursive: true });
  for (const f of SONGS) {
    cpSync(join(fixturesSrc, f), join(fixturesDst, f));
  }
  const { waitResult } = await startServer();
  waitResultFn = waitResult;
}, 20000);

afterAll(() => {
  chromium?.kill();
  server?.close();
  rmSync(fixturesDst, { recursive: true, force: true });
});

it(
  "offline and realtime (AudioWorklet) rendering produce identical output",
  async () => {
    // 絶対パスは存在確認、コマンド名は PATH から解決を試みる
    const chromiumPath = ["/usr/sbin/chromium", "/usr/bin/chromium"].find(existsSync) ?? "chromium";

    chromium = spawn(chromiumPath, ["--headless=new", "--no-sandbox", "--disable-gpu", URL], {
      stdio: "ignore",
    });

    const body = await waitResultFn!(TIMEOUT_MS);
    chromium.kill();
    chromium = null;

    const result = JSON.parse(body) as { done: boolean; songs: VerifySong[] };
    expect(result.done).toBe(true);
    expect(result.songs).toHaveLength(SONGS.length);
    for (const song of result.songs) {
      expect(song.ok, `${song.name}: maxDiff=${song.maxDiff} diffCount=${song.diffCount}/${song.total}`).toBe(true);
      expect(song.maxDiff).toBe(0);
    }
  },
  TIMEOUT_MS,
);
