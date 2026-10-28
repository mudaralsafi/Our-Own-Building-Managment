import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { resolve, extname } from "node:path";
import { fileURLToPath } from "node:url";
import { createStore, AppError } from "./store.mjs";
import { createAuth } from "./auth.mjs";
import { configuration } from "./config.mjs";
import { backupDatabases } from "./backup.mjs";

process.umask(0o077);
const root = fileURLToPath(new URL("../", import.meta.url));
const config = configuration(process.env, root);
const store = createStore(config.dataPath);
const auth = createAuth(config.authPath, {
  secure: config.production,
  setupToken: config.setupToken,
});
if (config.production && !auth.configured() && config.setupToken.length < 32) {
  auth.close();
  store.close();
  throw new Error(
    "Before first launch, set a random SETUP_TOKEN of at least 32 characters in the hosting dashboard.",
  );
}
const mime = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".webmanifest": "application/manifest+json",
};
const pages = new Set([
  "/",
  "/login",
  "/overview",
  "/spaces",
  "/renters",
  "/leases",
  "/calls",
  "/agreements",
  "/payments",
  "/settings",
]);

async function body(req) {
  if (!/^application\/json(?:;|$)/i.test(req.headers["content-type"] || ""))
    throw new AppError("Send JSON data.", 415);
  let buffer = "";
  for await (const part of req) {
    buffer += part;
    if (buffer.length > 65536)
      throw new AppError("This request is too large.", 413);
  }
  try {
    const result = JSON.parse(buffer || "{}");
    if (!result || Array.isArray(result) || typeof result !== "object")
      throw Error();
    return result;
  } catch {
    throw new AppError("Send a valid JSON object.");
  }
}

const server = createServer(async (req, res) => {
  const json = (status, data) => {
    res.writeHead(status, {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
    });
    res.end(JSON.stringify(data));
  };
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Referrer-Policy", "same-origin");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader(
    "Permissions-Policy",
    "camera=(), microphone=(), geolocation=()",
  );
  res.setHeader(
    "Content-Security-Policy",
    "default-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; script-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'",
  );
  if (config.production)
    res.setHeader("Strict-Transport-Security", "max-age=31536000");
  try {
    const url = new URL(req.url, "http://localhost");
    // Hosts use this non-sensitive readiness endpoint before routing a domain.
    if (url.pathname === "/api/health" && req.method === "GET")
      return json(200, { ok: true });
    const authority = (req.headers.host || "").toLowerCase();
    const allowedHost = config.production
      ? authority === config.publicUrl.host
      : ["localhost", "127.0.0.1"].includes(authority.split(":")[0]);
    if (!allowedHost) throw new AppError("Unrecognized website address.", 403);
    const origin = req.headers.origin;
    if (origin && !config.origins.includes(origin))
      throw new AppError("Requests must come from this website.", 403);
    if (
      !["GET", "HEAD"].includes(req.method) &&
      !config.origins.includes(origin)
    )
      throw new AppError("Open the website before making changes.", 403);
    if (req.headers["sec-fetch-site"] === "cross-site")
      throw new AppError("Cross-site requests are not allowed.", 403);
    if (url.pathname.startsWith("/api/")) {
      const [, , resource, id, action, extra] = url.pathname.split("/");
      if (resource === "auth") {
        if (req.method === "GET" && id === "status" && !action)
          return json(200, auth.status(req));
        if (
          req.method === "POST" &&
          ["setup", "login", "password"].includes(id) &&
          !action
        ) {
          const handler =
            id === "setup"
              ? auth.setup
              : id === "login"
                ? auth.login
                : auth.changePassword;
          const result = await handler(await body(req), req);
          res.setHeader("Set-Cookie", result.cookie);
          return json(200, { user: result.user });
        }
        if (req.method === "POST" && id === "logout" && !action) {
          res.setHeader("Set-Cookie", auth.logout(req));
          return json(200, { ok: true });
        }
        throw new AppError("This endpoint could not be found.", 404);
      }
      if (!auth.session(req))
        throw new AppError("Please sign in to continue.", 401);
      if (req.method === "GET" && resource === "state" && !id)
        return json(200, store.state());
      if (req.method === "PUT" && resource === "settings" && !id) {
        store.saveSettings(await body(req));
        return json(200, { ok: true });
      }
      if (req.method === "GET" && resource === "legacy" && !id)
        return json(200, store.legacy());
      if (req.method === "POST" && resource === "completion" && !id)
        return json(200, store.completeBuilding(await body(req)));
      if (
        req.method === "POST" &&
        resource === "agreements" &&
        id &&
        action === "cancel" &&
        !extra
      ) {
        store.cancelAgreement(id, await body(req));
        return json(200, { ok: true });
      }
      if (
        req.method === "POST" &&
        resource === "payments" &&
        id &&
        action === "void" &&
        !extra
      ) {
        store.voidPayment(id, await body(req));
        return json(200, { ok: true });
      }
      if (
        req.method === "POST" &&
        resource === "agreements" &&
        id &&
        action === "documents" &&
        !extra
      ) {
        const chunks = [];
        let size = 0;
        for await (const chunk of req) {
          size += chunk.length;
          if (size > 10 * 1024 * 1024)
            throw new AppError("Upload a file up to 10 MB.", 413);
          chunks.push(chunk);
        }
        let name;
        try {
          name = decodeURIComponent(req.headers["x-file-name"] || "");
        } catch {
          throw new AppError("Invalid file name.");
        }
        return json(
          201,
          store.saveDocument(
            id,
            name,
            req.headers["content-type"],
            Buffer.concat(chunks),
          ),
        );
      }
      if (req.method === "GET" && resource === "documents" && id && !action) {
        const file = store.document(id);
        res.writeHead(200, {
          "Content-Type": "application/octet-stream",
          "Content-Disposition": `attachment; filename="document"; filename*=UTF-8''${encodeURIComponent(file.name).replace(/'/g, "%27")}`,
          "Cache-Control": "no-store",
          "Content-Length": file.size,
        });
        return res.end(file.content);
      }
      const handlers = {
        spaces: store.saveSpace,
        people: store.savePerson,
        enquiries: store.saveEnquiry,
        agreements: store.saveAgreement,
      };
      if (
        Object.hasOwn(handlers, resource) &&
        ((req.method === "POST" && !id) ||
          (req.method === "PUT" && id && !action))
      )
        return json(id ? 200 : 201, handlers[resource](await body(req), id));
      if (req.method === "POST" && resource === "payments" && !id)
        return json(201, store.recordPayment(await body(req)));
      if (
        req.method === "DELETE" &&
        ["spaces", "enquiries", "documents"].includes(resource) &&
        id &&
        !action
      ) {
        store.remove(resource, id);
        return json(200, { ok: true });
      }
      throw new AppError("This endpoint could not be found.", 404);
    }
    if (req.method !== "GET" && req.method !== "HEAD")
      throw new AppError("Method not allowed.", 405);
    const requested = decodeURIComponent(url.pathname);
    const path = resolve(root, "dist", "." + requested);
    const dist = resolve(root, "dist");
    if (path !== dist && !path.startsWith(dist + "/"))
      throw new AppError("Invalid path.", 400);
    let content,
      extension = extname(path);
    try {
      content = await readFile(path);
    } catch {
      if (!pages.has(requested)) throw new AppError("Page not found.", 404);
      try {
        content = await readFile(resolve(dist, "index.html"));
        extension = ".html";
      } catch {
        throw new AppError(
          "Build the app with npm run build, or use npm run dev.",
          503,
        );
      }
    }
    res.writeHead(200, {
      "Content-Type": mime[extension] || "application/octet-stream",
      "Cache-Control":
        extension === ".html"
          ? "no-store"
          : requested.startsWith("/assets/")
            ? "public, max-age=31536000, immutable"
            : "public, max-age=3600",
    });
    res.end(req.method === "HEAD" ? undefined : content);
  } catch (error) {
    if (!(error instanceof AppError))
      console.error("Request failed:", error.message);
    if (error.status === 429) res.setHeader("Retry-After", "900");
    json(error.status || 500, {
      error:
        error instanceof AppError
          ? error.message
          : "Something went wrong. Please try again.",
    });
  }
});
server.requestTimeout = 30000;
server.headersTimeout = 15000;
server.listen(config.port, config.host, () =>
  console.log(
    `Our Building is running on port ${config.port}. Owner sign-in is required.`,
  ),
);

let backingUp = false;
async function runBackup() {
  if (backingUp) return;
  backingUp = true;
  try {
    await backupDatabases(config);
    console.log("Scheduled database backup completed.");
  } catch (error) {
    console.error("Database backup failed:", error.message);
  } finally {
    backingUp = false;
  }
}
let initialBackup, dailyBackup;
if (config.production) {
  initialBackup = setTimeout(runBackup, 60 * 1000);
  initialBackup.unref();
  dailyBackup = setInterval(runBackup, 24 * 60 * 60 * 1000);
  dailyBackup.unref();
}
for (const signal of ["SIGINT", "SIGTERM"])
  process.on(signal, () => {
    clearTimeout(initialBackup);
    clearInterval(dailyBackup);
    server.close(() => {
      auth.close();
      store.close();
      process.exit(0);
    });
  });
