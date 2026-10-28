import { chromium } from "playwright-core";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { once } from "node:events";
import { randomBytes } from "node:crypto";
const directory = mkdtempSync(join(tmpdir(), "building-browser-v2-")),
  url = "http://127.0.0.1:3317";
const server = spawn(process.execPath, ["server/index.mjs"], {
  env: {
    ...process.env,
    NODE_ENV: "development",
    HOST: "127.0.0.1",
    PORT: "3317",
    DATA_PATH: join(directory, "building.sqlite"),
  },
  stdio: ["ignore", "pipe", "pipe"],
});
let browser;
const errors = [];
const password = randomBytes(24).toString("hex");
server.stderr.on("data", (d) => process.stderr.write(d));
try {
  await new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error("Server startup timed out")),
      10000,
    );
    server.stdout.on("data", (d) => {
      if (d.toString().includes("running")) {
        clearTimeout(timer);
        resolve();
      }
    });
    server.once("exit", () => {
      clearTimeout(timer);
      reject(new Error("Test server exited"));
    });
  });
  browser = await chromium.launch({
    executablePath: process.env.CHROMIUM_PATH || "/usr/bin/chromium",
    headless: true,
    args: ["--no-sandbox"],
  });
  const page = await browser.newPage({
    viewport: { width: 1440, height: 1080 },
    reducedMotion: "reduce",
  });
  page.on("pageerror", (e) => errors.push(e.message));
  const nav = async (name) => {
    if (
      await page
        .getByRole("button", { name: "Open navigation", exact: true })
        .isVisible()
    )
      await page
        .getByRole("button", { name: "Open navigation", exact: true })
        .click();
    await page
      .getByRole("navigation")
      .getByRole("button", { name, exact: true })
      .click();
  };
  const dialog = () => page.getByRole("dialog");
  const save = async (name) => {
    await dialog().getByRole("button", { name, exact: true }).click();
    await dialog().waitFor({ state: "hidden" });
  };
  const state = async () =>
    await (await page.request.get(url + "/api/state")).json();
  const log = (s) => console.log("PASS " + s);
  mkdirSync("test-results", { recursive: true });
  assert.equal((await fetch(url + "/api/state")).status, 401);
  await page.goto(url);
  await page
    .getByLabel("Email address", { exact: true })
    .fill("owner@example.test");
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByLabel("Confirm password", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Create owner account" }).click();
  await page
    .getByRole("heading", { name: "Your building, at a glance." })
    .waitFor();
  await page.screenshot({
    path: "test-results/rebuilt-empty.png",
    fullPage: true,
  });
  log("Private owner setup; truthful empty workspace");
  await nav("Spaces");
  for (const [name, type, floor, area] of [
    ["G01", "Shop", "Ground floor", "85"],
    ["G02", "Shop", "Ground floor", "90"],
    ["O101", "Office", "First floor", "120"],
    ["R01", "Rooftop", "Roof", "240"],
  ]) {
    await page
      .getByRole("button", { name: "Add space", exact: true })
      .first()
      .click();
    await dialog().getByLabel("Space number", { exact: true }).fill(name);
    await dialog().getByLabel("Type", { exact: true }).selectOption(type);
    await dialog().getByLabel("Floor / level", { exact: true }).fill(floor);
    await dialog().getByLabel("Area (m²)", { exact: true }).fill(area);
    await save("Save space");
  }
  await nav("Calls & interest");
  for (const [name, business, spaceLabels, note] of [
    [
      "Sam Rivera",
      "Rivera Coffee",
      ["G01", "G02"],
      "Interested in joining both shops for a café. Discussed a five-year agreement.",
    ],
    [
      "Maya Chen",
      "Green Pharmacy",
      ["G01"],
      "Asked about ground-floor visibility and parking. Call back after discussing the annual rent.",
    ],
    [
      "Alex Morgan",
      "Studio North",
      ["O101"],
      "Office for a small design team. Interested in a three-year agreement.",
    ],
  ]) {
    await page
      .getByRole("button", { name: "Log a call", exact: true })
      .first()
      .click();
    await dialog().getByLabel("Name", { exact: true }).fill(name);
    await dialog().getByLabel("Phone", { exact: true }).fill("+1 555 0100");
    await dialog()
      .getByLabel("Business / activity", { exact: true })
      .fill(business);
    for (const label of spaceLabels)
      await dialog()
        .getByRole("checkbox", { name: new RegExp("^" + label + " ") })
        .check();
    await dialog().getByLabel("Call notes", { exact: true }).fill(note);
    await save("Log call");
  }
  assert.equal((await state()).enquiries.length, 3);
  assert.equal((await state()).agreements.length, 0);
  await page.screenshot({
    path: "test-results/rebuilt-calls.png",
    fullPage: true,
  });
  log("Fast call capture; multiple callers interested in the same space");
  await page
    .locator("article")
    .filter({
      has: page.getByRole("heading", { name: "Sam Rivera", exact: true }),
    })
    .getByRole("button", { name: "Prepare agreement" })
    .click();
  await dialog()
    .getByLabel("Contract length (years)", { exact: true })
    .fill("5");
  await dialog()
    .getByLabel("First annual rent (USD)", { exact: true })
    .fill("12000");
  await dialog()
    .getByRole("button", { name: "Add change", exact: true })
    .click();
  await dialog().getByLabel("Change 1: from year", { exact: true }).fill("3");
  await dialog().getByLabel("Change 1: value", { exact: true }).fill("5");
  await dialog().getByLabel("Repeat yearly", { exact: true }).check();
  await dialog()
    .getByRole("button", { name: "Add change", exact: true })
    .click();
  await dialog().getByLabel("Change 2: from year", { exact: true }).fill("5");
  await dialog()
    .getByLabel("Change 2: method", { exact: true })
    .selectOption("set");
  await dialog().getByLabel("Change 2: value", { exact: true }).fill("20000");
  await dialog().getByText("$13,230", { exact: true }).waitFor();
  await page.screenshot({
    path: "test-results/rebuilt-rent-preview.png",
    fullPage: true,
  });
  await save("Save agreement");
  await page
    .getByRole("heading", { name: "Sam Rivera", exact: true })
    .waitFor();
  let s = await state(),
    a = s.agreements[0];
  assert.deepEqual(
    a.rents.map((r) => r.amount),
    [1200000, 1200000, 1260000, 1323000, 2000000],
  );
  assert.equal(a.space_ids.length, 2);
  assert.equal(a.status, "awaiting-payment");
  log(
    "Combined-space agreement and mixed annual rent changes preview accurately",
  );
  async function pay(amount) {
    await page
      .getByRole("button", { name: "Record payment", exact: true })
      .click();
    await dialog()
      .getByLabel("Amount received (USD)", { exact: true })
      .fill(amount);
    await dialog()
      .getByLabel("Payment method", { exact: true })
      .selectOption("Bank transfer");
    await dialog()
      .getByLabel("Reference (optional)", { exact: true })
      .fill("SAMPLE-TRANSFER");
    await save("Record payment");
  }
  await pay("2000");
  assert.equal((await state()).agreements[0].secured, false);
  await pay("4000");
  assert.equal((await state()).agreements[0].secured, true);
  assert.equal((await state()).agreements[0].effective_start, "");
  await page.reload();
  await page
    .getByRole("heading", { name: "Sam Rivera", exact: true })
    .waitFor();
  assert.ok(page.url().includes("?id="));
  log(
    "Partial payments secure both spaces at the threshold and survive reload",
  );
  const pdf = Buffer.from("%PDF-1.4\nSample signed agreement copy\n%%EOF");
  await page
    .getByLabel("Upload agreement document", { exact: true })
    .setInputFiles({
      name: "Signed agreement.pdf",
      mimeType: "application/pdf",
      buffer: pdf,
    });
  await page.getByRole("link", { name: /Signed agreement.pdf/ }).waitFor();
  const document = (await state()).documents[0];
  assert.equal(
    (await fetch(url + "/api/documents/" + document.id)).status,
    401,
  );
  const downloadEvent = page.waitForEvent("download");
  await page.getByRole("link", { name: /Signed agreement.pdf/ }).click();
  assert.equal(
    (await downloadEvent).suggestedFilename(),
    "Signed agreement.pdf",
  );
  log("Private signed-copy upload and authenticated download");
  await page.screenshot({
    path: "test-results/rebuilt-agreement.png",
    fullPage: true,
  });
  await nav("Overview");
  await page.screenshot({
    path: "test-results/rebuilt-overview.png",
    fullPage: true,
  });
  await nav("Spaces");
  await page.screenshot({
    path: "test-results/rebuilt-spaces.png",
    fullPage: true,
  });
  await nav("Overview");
  await page
    .getByRole("button", { name: "Confirm completion", exact: true })
    .click();
  await save("Confirm completion");
  s = await state();
  a = s.agreements[0];
  assert.equal(a.status, "active");
  assert.equal(a.effective_start, s.today);
  assert.equal(
    s.charges.find((c) => c.kind === "completion").due_date,
    s.today,
  );
  log("Owner-confirmed completion activates leases and dates annual payments");
  await nav("Agreements");
  await page
    .getByRole("button", { name: "View agreement", exact: true })
    .click();
  await pay("1000");
  s = await state();
  assert.equal(s.charges.find((c) => c.kind === "completion").balance, 500000);
  await nav("Payments");
  await page
    .getByRole("button", { name: "All scheduled", exact: true })
    .click();
  const exportEvent = page.waitForEvent("download");
  await page
    .getByRole("button", { name: "Export ledger", exact: true })
    .click();
  assert.match((await exportEvent).suggestedFilename(), /annual-rent-ledger/);
  await page.screenshot({
    path: "test-results/rebuilt-payments.png",
    fullPage: true,
  });
  log(
    "Completion installment accepts partial payment; annual CSV export works",
  );
  await page.setViewportSize({ width: 390, height: 844 });
  await nav("Overview");
  await page.screenshot({
    path: "test-results/rebuilt-mobile.png",
    fullPage: true,
  });
  assert.equal(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
    true,
    "Mobile overview fits",
  );
  await nav("Calls & interest");
  assert.equal(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
    true,
    "Mobile enquiries fit",
  );
  await page
    .getByRole("button", { name: "Log a call", exact: true })
    .first()
    .click();
  assert.equal(
    await page.evaluate(
      () =>
        document.querySelector("[role=dialog]").scrollWidth <=
        document.querySelector("[role=dialog]").clientWidth,
    ),
    true,
    "Mobile form fits",
  );
  await dialog()
    .getByRole("button", { name: "Close dialog", exact: true })
    .click();
  await nav("Agreements");
  await page
    .getByRole("button", { name: "View agreement", exact: true })
    .click();
  assert.equal(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
    true,
    "Mobile agreement fits",
  );
  log(
    "Phone navigation, call form, dashboard, and agreement fit without page overflow",
  );
  await page
    .getByRole("button", { name: "Cancel agreement", exact: true })
    .click();
  await dialog()
    .getByLabel("Agreed amount to keep (USD)", { exact: true })
    .fill("1000");
  await dialog()
    .getByLabel("Reason / settlement notes", { exact: true })
    .fill("Settlement agreed with tenant");
  await save("Cancel agreement");
  assert.equal((await state()).agreements[0].refund_due, 600000);
  await page
    .getByRole("button", { name: "Record refund", exact: true })
    .click();
  await dialog()
    .getByLabel("Amount refunded (USD)", { exact: true })
    .fill("2000");
  await save("Record refund");
  assert.equal((await state()).agreements[0].refund_due, 400000);
  assert.equal(
    (await state()).payments.filter((p) => p.kind === "receipt").length,
    3,
  );
  log("Case-by-case cancellation retains receipts and tracks partial refunds");
  await page
    .getByRole("button", { name: "Open navigation", exact: true })
    .click();
  await page.getByRole("button", { name: "Sign out", exact: true }).click();
  await page
    .getByRole("heading", { name: "Sign in to your building." })
    .waitFor();
  assert.equal((await page.request.get(url + "/api/state")).status(), 401);
  await page.goto(url + "/calls");
  await page
    .getByLabel("Email address", { exact: true })
    .fill("owner@example.test");
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await page
    .getByRole("heading", { name: "Every conversation, remembered." })
    .waitFor();
  await page.reload();
  await page
    .getByRole("heading", { name: "Every conversation, remembered." })
    .waitFor();
  assert.deepEqual(errors, []);
  log(
    "Session protection, direct routes, reload, and no browser runtime errors",
  );
} finally {
  await browser?.close();
  if (server.exitCode === null) {
    const exited = once(server, "exit");
    server.kill("SIGTERM");
    await exited;
  }
  rmSync(directory, { recursive: true, force: true });
}
