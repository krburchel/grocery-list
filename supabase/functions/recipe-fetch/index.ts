// Recipe page fetcher for the grocery-list PWA (krburchel.github.io/grocery-list).
// Fetches a recipe URL server-side and returns ONLY its JSON-LD <script> blocks,
// so it can't be used as a general-purpose open proxy.
// Deployed to the BrainFeed Supabase project (bzvibdjrknqvmurwjroq), verify_jwt=false.

const ALLOWED_ORIGINS = ["https://krburchel.github.io", "http://localhost:8000", "http://127.0.0.1:8000"];
const MAX_BYTES = 5_000_000;
// Honest UA on purpose: spoofing Chrome trips bot detection (TLS fingerprint mismatch) on more sites.
const UA = "Mozilla/5.0 (compatible; RecipeImporter/1.0; +https://krburchel.github.io/grocery-list/)";

function cors(origin: string | null): Record<string, string> {
  const allow = origin && ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];
  return {
    "Access-Control-Allow-Origin": allow,
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Access-Control-Allow-Headers": "content-type",
    "Vary": "Origin",
  };
}

function isBlockedHost(host: string): boolean {
  const h = host.toLowerCase().replace(/^\[|\]$/g, "");
  if (h === "localhost" || h.endsWith(".localhost") || h.endsWith(".internal") || h.endsWith(".local")) return true;
  if (/^\d+\.\d+\.\d+\.\d+$/.test(h)) {
    const [a, b] = h.split(".").map(Number);
    return a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127);
  }
  if (h.includes(":")) return true; // no IPv6 literals
  return false;
}

function checkUrl(raw: string): URL {
  const u = new URL(raw);
  if (u.protocol !== "https:" && u.protocol !== "http:") throw new Error("bad protocol");
  if (isBlockedHost(u.hostname)) throw new Error("blocked host");
  return u;
}

Deno.serve(async (req) => {
  const origin = req.headers.get("origin");
  const headers = cors(origin);
  if (req.method === "OPTIONS") return new Response(null, { headers });
  if (origin && !ALLOWED_ORIGINS.includes(origin)) return new Response("forbidden", { status: 403, headers });

  const target = new URL(req.url).searchParams.get("url");
  if (!target) return new Response("missing url", { status: 400, headers });

  try {
    let url = checkUrl(target);
    let res: Response | null = null;
    for (let i = 0; i < 5; i++) {
      res = await fetch(url, {
        redirect: "manual",
        headers: { "User-Agent": UA, "Accept": "text/html,application/xhtml+xml", "Accept-Language": "en-US,en;q=0.9" },
        signal: AbortSignal.timeout(15000),
      });
      const loc = res.headers.get("location");
      if (res.status >= 300 && res.status < 400 && loc) {
        url = checkUrl(new URL(loc, url).toString());
        continue;
      }
      break;
    }
    if (!res || !res.ok) {
      return new Response(`upstream ${res?.status ?? "error"}`, { status: 502, headers });
    }
    const buf = await res.arrayBuffer();
    if (buf.byteLength > MAX_BYTES) return new Response("too large", { status: 413, headers });
    const html = new TextDecoder().decode(buf);
    const blocks = html.match(/<script[^>]+type=["']application\/ld\+json["'][^>]*>[\s\S]*?<\/script>/gi) || [];
    const body = `<!-- recipe-fetch: ${blocks.length} ld+json block(s) from ${url.hostname} -->\n` + blocks.join("\n");
    return new Response(body, { headers: { ...headers, "Content-Type": "text/html; charset=utf-8" } });
  } catch (e) {
    return new Response(`fetch failed: ${(e as Error).message}`, { status: 502, headers });
  }
});
