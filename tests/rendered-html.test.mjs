import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

async function render() {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);

  return worker.fetch(
    new Request("http://localhost/", { headers: { accept: "text/html" } }),
    { ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) } },
    { waitUntil() {}, passThroughOnException() {} },
  );
}

test("server-renders the Roof Form Workbench and its structural systems", async () => {
  const response = await render();
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);

  const html = await response.text();
  assert.match(html, /<title>Roof Form Workbench<\/title>/i);
  assert.match(html, /Eave detail catalog/);
  assert.match(html, /Rafter/);
  assert.match(html, /Raised heel truss/);
  assert.match(html, /Cantilevered raised-heel truss/);
  assert.match(html, /Common truss/);
  assert.match(html, /New eave detail/);
});

test("catalog details and edge assignments share a typed compatibility model", async () => {
  const [page, editor] = await Promise.all([
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/EaveDetailEditor.tsx", import.meta.url), "utf8"),
  ]);

  assert.match(page, /condition\.systemType === roofSystemType/);
  assert.match(page, /compatibleEaveDetails\.map/);
  assert.match(page, /changeRoofSystem/);
  assert.match(page, /Edit in 2D detail lab/);
  assert.match(editor, /role="dialog"/);
  assert.match(editor, /aria-modal="true"/);
  assert.match(editor, /DEFAULT_EAVE_PARAMETERS/);
});
