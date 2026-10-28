import test from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { request as httpRequest } from "node:http";

test("production HTTP gates all records, enforces origin checks, and issues secure sessions", async (t) => {
  const directory = mkdtempSync(join(tmpdir(), "building-http-"));
  const setupToken = randomBytes(32).toString("hex");
  const ownerPassword = randomBytes(24).toString("hex");
  const site = "https://building.example.test";
  const child = spawn(process.execPath, ["server/index.mjs"], {
    env: {
      ...process.env,
      NODE_ENV: "production",
      HOST: "127.0.0.1",
      PORT: "3319",
      PUBLIC_URL: site,
      DATA_PATH: join(directory, "building.sqlite"),
      SETUP_TOKEN: setupToken,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let errorOutput = "";
  child.stderr.on("data", (data) => {
    errorOutput += data;
  });
  t.after(async () => {
    if (child.exitCode === null) {
      const stopped = once(child, "exit");
      child.kill("SIGTERM");
      await stopped;
    }
    rmSync(directory, { recursive: true, force: true });
  });
  await new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error("Production test server startup timed out")),
      10000,
    );
    child.stdout.on("data", (data) => {
      if (data.toString().includes("running")) {
        clearTimeout(timer);
        resolve();
      }
    });
    child.once("exit", () => {
      clearTimeout(timer);
      reject(new Error(errorOutput));
    });
  });
  const send = (path, method = "GET", data, extra = {}) =>
    new Promise((resolve, reject) => {
      const req = httpRequest(
        {
          hostname: "127.0.0.1",
          port: 3319,
          path,
          method,
          headers: {
            Host: "building.example.test",
            Origin: site,
            "Content-Type": "application/json",
            ...extra,
          },
        },
        (response) => {
          let body = "";
          response.on("data", (chunk) => {
            body += chunk;
          });
          response.on("end", () =>
            resolve({
              status: response.statusCode,
              headers: {
                get: (name) => {
                  const value = response.headers[name.toLowerCase()];
                  return Array.isArray(value) ? value.join(";") : value;
                },
              },
              text: async () => body,
            }),
          );
        },
      );
      req.on("error", reject);
      req.end(
        Buffer.isBuffer(data) ? data : data ? JSON.stringify(data) : undefined,
      );
    });
  assert.equal((await send("/api/health")).status, 200);
  assert.equal((await send("/api/state")).status, 401);
  assert.equal(
    (await send("/api/spaces", "POST", { name: "Blocked" })).status,
    401,
  );
  assert.equal(
    (
      await send("/api/auth/setup", "POST", {
        email: "owner@example.test",
        password: ownerPassword,
      })
    ).status,
    403,
  );
  const setup = await send("/api/auth/setup", "POST", {
    email: "owner@example.test",
    password: ownerPassword,
    setup_token: setupToken,
  });
  assert.equal(setup.status, 200);
  assert.match(setup.headers.get("set-cookie"), /; Secure/);
  assert.match(setup.headers.get("strict-transport-security"), /max-age=/);
  const cookie = setup.headers.get("set-cookie").split(";")[0];
  assert.equal(
    (await send("/api/state", "GET", undefined, { Cookie: cookie })).status,
    200,
  );
  assert.equal(
    (
      await send(
        "/api/spaces",
        "POST",
        { name: "Blocked" },
        { Cookie: cookie, Origin: "https://attacker.example" },
      )
    ).status,
    403,
  );
  assert.equal(
    (
      await send(
        "/api/spaces",
        "POST",
        { name: "Blocked" },
        { Cookie: cookie, Origin: "" },
      )
    ).status,
    403,
  );
  assert.equal(
    (
      await send("/api/state", "GET", undefined, {
        Cookie: cookie,
        Host: "attacker.example",
      })
    ).status,
    403,
  );
  for (const route of ["/login", "/spaces", "/payments", "/settings"]) {
    const response = await send(route);
    assert.equal(response.status, 200);
    assert.ok((await response.text()).includes("Our Building"));
  }
  const read = async (response) => JSON.parse(await response.text());
  const space = await read(
    await send(
      "/api/spaces",
      "POST",
      { name: "G01", type: "Shop", floor: "Ground", area: 80 },
      { Cookie: cookie },
    ),
  );
  const person = await read(
    await send(
      "/api/people",
      "POST",
      { name: "Test tenant", phone: "123" },
      { Cookie: cookie },
    ),
  );
  const state = await read(
    await send("/api/state", "GET", undefined, { Cookie: cookie }),
  );
  const agreement = await read(
    await send(
      "/api/agreements",
      "POST",
      {
        person_id: person.id,
        space_ids: [space.id],
        agreed_on: state.today,
        start_mode: "completion",
        annual_rent: "12000",
        years: 2,
      },
      { Cookie: cookie },
    ),
  );
  const file = Buffer.from("%PDF-1.4\nPrivate contract");
  const uploadHeaders = {
    Cookie: cookie,
    "Content-Type": "application/pdf",
    "X-File-Name": encodeURIComponent("Signed contract.pdf"),
  };
  const uploaded = await send(
    "/api/agreements/" + agreement.id + "/documents",
    "POST",
    file,
    uploadHeaders,
  );
  assert.equal(uploaded.status, 201);
  const document = await read(uploaded);
  assert.equal((await send("/api/documents/" + document.id)).status, 401);
  const downloaded = await send(
    "/api/documents/" + document.id,
    "GET",
    undefined,
    { Cookie: cookie },
  );
  assert.equal(downloaded.status, 200);
  assert.equal(await downloaded.text(), file.toString());
  assert.match(downloaded.headers.get("content-disposition"), /^attachment;/);
  assert.equal(downloaded.headers.get("cache-control"), "no-store");
  assert.equal(
    (
      await send(
        "/api/agreements/" + agreement.id + "/documents",
        "POST",
        file,
        { ...uploadHeaders, Origin: "https://attacker.example" },
      )
    ).status,
    403,
  );
  assert.equal(
    (
      await send(
        "/api/agreements/" + agreement.id + "/documents",
        "POST",
        Buffer.from("fake"),
        uploadHeaders,
      )
    ).status,
    400,
  );
  for (const route of ["/calls", "/agreements?id=" + agreement.id])
    assert.equal((await send(route)).status, 200);
  assert.equal(
    (await send("/api/auth/logout", "POST", {}, { Cookie: cookie })).status,
    200,
  );
  assert.equal(
    (await send("/api/state", "GET", undefined, { Cookie: cookie })).status,
    401,
  );
  assert.equal(
    (
      await send("/api/auth/setup", "POST", {
        email: "owner@example.test",
        password: ownerPassword,
        setup_token: setupToken,
      })
    ).status,
    409,
  );
});
