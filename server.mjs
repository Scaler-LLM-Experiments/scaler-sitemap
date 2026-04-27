import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { extname, join, normalize, resolve } from "node:path";

const PORT = Number(process.env.PORT) || 3000;
const ROOT = resolve(process.cwd());

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".xml": "application/xml; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
};

async function resolvePath(urlPath) {
  let safe = normalize(decodeURIComponent(urlPath.split("?")[0]));
  if (safe === "/" || safe === "") safe = "/index.html";
  const filePath = join(ROOT, safe);
  if (!filePath.startsWith(ROOT)) return null;
  try {
    const s = await stat(filePath);
    if (s.isDirectory()) return join(filePath, "index.html");
    return filePath;
  } catch {
    return null;
  }
}

const server = createServer(async (req, res) => {
  const filePath = await resolvePath(req.url || "/");
  if (!filePath) {
    res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("Not found");
    return;
  }
  try {
    const data = await readFile(filePath);
    const type = MIME[extname(filePath).toLowerCase()] || "application/octet-stream";
    res.writeHead(200, {
      "Content-Type": type,
      "Cache-Control": "public, max-age=300",
    });
    res.end(data);
  } catch {
    res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("Not found");
  }
});

server.listen(PORT, () => {
  console.log(`Serving ${ROOT} on port ${PORT}`);
});
