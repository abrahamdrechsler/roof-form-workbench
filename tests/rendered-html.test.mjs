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

test("room-owned ceiling keeps outside framing and inside finish as clipped solids", async () => {
  const page = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");

  assert.match(page, /roomId: PRIMARY_ROOM\.id/);
  assert.match(page, /interiorWallFacePolygon/);
  assert.match(page, /CEILING_FRAMING_THICKNESS_INCHES = 3\.5/);
  assert.match(page, /CEILING_FINISH_THICKNESS_INCHES = 0\.5/);
  assert.match(page, /Bottom of ceiling framing/);
  assert.match(page, /clipPlanPolygonAboveRoofPlanes/);
  assert.match(page, /footprint: structuralFootprint/);
  assert.match(page, /topAt: \(\) => framingBottom \+ framingThickness/);
  assert.match(page, /bottomAt: \(\) => framingBottom/);
  assert.match(page, /footprint: roomInteriorPoints/);
  assert.match(page, /ceiling-\$\{ceiling\.id\}-framing/);
  assert.match(page, /ceiling-\$\{ceiling\.id\}-finish/);
  assert.match(page, /points: \[\.\.\.bottomFace\]\.reverse\(\)/);
  assert.match(page, /pointInPlanPolygon\(cellCenter, footprint\)/);
  assert.match(page, /Math\.min\(framingBottom, roofUndersideAt\(point\)/);
  assert.match(page, /clipPlanPolygonByHeight/);
  assert.match(page, /heightAt: roofUndersideAt/);
  assert.match(page, /height: framingBottom/);
  assert.match(page, /structuralUndersideHeightAt/);
  assert.match(
    page,
    /addCeilingSurfaces\(\s*structuralUndersideHeightAt/,
  );
  assert.match(page, /finishThicknessInches\.toFixed\(1\)/);
  assert.match(page, /depthAtScreenPoint/);
  assert.match(page, /formPickRegions\.current/);
  assert.match(page, /depth >= frontmost\.depth - 0\.025/);
  assert.match(page, /Drag to change ceiling bottom-of-framing height/);
  assert.match(page, /ceilingHeightDrag\.current/);
});

test("roof thickness is owned once by the roof and extruded normal to solved faces", async () => {
  const page = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");

  assert.match(page, /DEFAULT_ROOF_ASSEMBLY/);
  assert.match(page, /structuralDepthInches: 5\.5/);
  assert.match(page, /buildUpThicknessInches: 0\.6/);
  assert.match(page, /Shared rafter depth/);
  assert.match(page, /Shared roof build-up/);
  assert.match(page, /roofFaceNormal/);
  assert.match(page, /offsetRoofFace/);
  assert.match(page, /offsetRoofFacesWatertight/);
  assert.match(page, /offset\.total \/ offset\.count/);
  assert.match(page, /boundaryVerticalOffset/);
  assert.match(page, /roofBoundaryPoints/);
  assert.match(page, /boundaryKeys\.has\(key\)/);
  assert.match(page, /const facets: \{ index: number; points: Point3\[\] \}\[\] = \[\]/);
  assert.match(page, /index: previous\.edge\.index/);
  assert.match(page, /index: definition\.edge\.index/);
  assert.match(page, /index: next\.edge\.index/);
  assert.match(page, /const roofFacets = faces\.flatMap/);
  assert.match(page, /if \(surface\.outline === false\) return/);
  assert.match(page, /outline: false/);
  assert.match(page, /const facetEdges = new Map/);
  assert.match(page, /occurrences < 2 \|\| owners\.size < 2/);
  assert.match(page, /distanceFeet \/ Math\.max\(0\.05, normal\.y\)/);
  assert.match(page, /roofingTopByPoint/);
  assert.match(page, /structuralUndersideByPoint/);
  assert.match(page, /roofPoints\.forEach\(\(corner\)/);
  assert.match(page, /solidId: "roof-assembly"/);
  assert.match(page, /-roofAssembly\.structuralDepthInches \/ 12/);
  assert.match(page, /roofAssembly\.buildUpThicknessInches \/ 12/);
  assert.match(page, /elevationOffset < -0\.0001/);
  assert.match(page, /y: eaveElevation/);
  assert.match(page, /needsTriangulation/);
  assert.match(page, /neighboring side eaves jog down/);
  assert.match(page, /transitionSlopeAtLoweredCorner/);
  assert.match(page, /roofBase \+ rise - elevation/);
  assert.match(page, /updateRoofAssembly/);
  assert.match(page, /rafterDepth: changes\.structuralDepthInches/);
});
