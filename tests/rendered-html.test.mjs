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
  assert.match(html, /Create new eave detail/);
  assert.match(html, /4(?:<!-- -->)? saved details/);
});

test("catalog details and edge assignments share a typed compatibility model", async () => {
  const [page, editor] = await Promise.all([
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/EaveDetailEditor.tsx", import.meta.url), "utf8"),
  ]);

  assert.match(page, /condition\.systemType === roofSystemType/);
  assert.match(page, /compatibleEaveDetails\.map/);
  assert.match(page, /shiftRoofEdgesByOverhang/);
  assert.match(page, /replacement\.parameters\.overhang - previous\.parameters\.overhang/);
  assert.doesNotMatch(page, /Independent overhang/);
  assert.match(page, /changeRoofSystem/);
  assert.match(page, /catalog-new-button/);
  assert.match(page, /Edit in 2D detail lab/);
  assert.doesNotMatch(page, /previewInset|previewHeight/);
  assert.match(editor, /role="dialog"/);
  assert.match(editor, /aria-modal="true"/);
  assert.match(editor, /DEFAULT_EAVE_PARAMETERS/);
});

test("room-owned ceiling keeps framing and finish separate and clips to the roof limit", async () => {
  const page = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");

  assert.match(page, /roomId: PRIMARY_ROOM\.id/);
  assert.match(page, /CEILING_FRAMING_THICKNESS_INCHES = 3\.5/);
  assert.match(page, /CEILING_FINISH_THICKNESS_INCHES = 0\.5/);
  assert.match(page, /Bottom of ceiling framing/);
  assert.match(page, /pointInPlanPolygon\(cellCenter, wallPoints\)/);
  assert.match(page, /Math\.min\(framingBottom, roofSurfaceAt\(point\)/);
  assert.match(page, /Math\.min\([\s\S]*framingBottom \+ framingThickness,[\s\S]*roofSurfaceAt\(point\)/);
  assert.match(page, /finishThicknessInches\.toFixed\(1\)/);
});
