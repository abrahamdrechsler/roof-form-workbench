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

test("roof system activates compatible details while edge assignments persist", async () => {
  const [page, editor] = await Promise.all([
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/EaveDetailEditor.tsx", import.meta.url), "utf8"),
  ]);

  assert.match(page, /conditionIds: string\[\]/);
  assert.match(page, /defaultConditionIdsBySystem/);
  assert.match(page, /activeConditionForRelationship/);
  assert.match(page, /condition\?\.systemType === systemType/);
  assert.match(page, /assignConditionToEdge/);
  assert.match(page, /conditionIds: \[\.\.\.conditionIds, nextCondition\.id\]/);
  assert.match(page, /shiftRoofEdgesByOverhang/);
  assert.match(page, /nextDetail\.parameters\.overhang - currentDetail\.parameters\.overhang/);
  assert.doesNotMatch(page, /Independent overhang/);
  assert.match(page, /changeRoofSystem/);
  assert.match(page, /Overall roof structural system/);
  assert.match(page, /This system governs the whole selected roof/);
  assert.match(page, /Assigned · inactive/);
  assert.match(page, /Active · applied/);
  assert.match(page, /catalog-new-button/);
  assert.match(page, /Edit in 2D detail lab/);
  assert.doesNotMatch(page, /previewInset|previewHeight/);
  assert.match(editor, /role="dialog"/);
  assert.match(editor, /aria-modal="true"/);
  assert.match(editor, /DEFAULT_EAVE_PARAMETERS/);
  assert.doesNotMatch(editor, /label="Roof slope"/);
  assert.match(editor, /const fixedPitch = DEFAULT_EAVE_PARAMETERS\.pitch/);
  assert.match(page, /pitch: DEFAULT_EAVE_PARAMETERS\.pitch/);

  const leftEntitySection = page.slice(
    page.indexOf('<ControlHeading number="02" title="File entities"'),
    page.indexOf('<ControlHeading number="03" title="Eave detail catalog"'),
  );
  const roofInspector = page.slice(
    page.indexOf(') : selection?.kind === "roof" ? ('),
    page.indexOf(') : selection?.kind === "roof-edge" ? ('),
  );
  assert.match(leftEntitySection, /Select an entity type to edit its properties in the inspector/);
  assert.doesNotMatch(leftEntitySection, /Overall roof structural system/);
  assert.doesNotMatch(leftEntitySection, /Shared bearing elevation/);
  assert.doesNotMatch(leftEntitySection, /Roof pitch/);
  assert.match(roofInspector, /Overall roof structural system/);
  assert.match(roofInspector, /Roof form/);
  assert.match(roofInspector, /Shared bearing elevation/);
  assert.match(roofInspector, /Roof pitch/);
  assert.match(roofInspector, /Shared structural depth/);
  assert.match(page, /aria-label="Model visibility"/);
});

test("room-owned ceiling keeps outside framing and inside finish as clipped solids", async () => {
  const page = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");

  assert.match(page, /roomId: PRIMARY_ROOM\.id/);
  assert.match(page, /interiorWallFacePolygon/);
  assert.match(page, /CEILING_FRAMING_THICKNESS_INCHES = 3\.5/);
  assert.match(page, /CEILING_FINISH_THICKNESS_INCHES = 0\.5/);
  assert.match(page, /Bottom of ceiling framing/);
  assert.match(page, /clipPlanPolygonToConvexBoundary/);
  assert.match(page, /const structuralCeilingFootprint = useMemo/);
  assert.match(page, /const finishCeilingFootprint = useMemo/);
  assert.match(page, /const ceilingFramingTopAt =/);
  assert.match(page, /footprint: structuralCeilingFootprint/);
  assert.match(page, /topAt: ceilingFramingTopAt/);
  assert.match(page, /Math\.max\(\s*framingBottom,\s*Math\.min\(/);
  assert.match(page, /roofFinishUndersideAt\(point\)/);
  assert.match(page, /const roofFinishUndersideHeightAt =/);
  assert.match(page, /roofHeightFromFaces\(point, structuralTops\)/);
  assert.match(page, /Plan clipped to roof/);
  assert.match(page, /bottomAt: \(\) => framingBottom/);
  assert.match(page, /footprint: finishCeilingFootprint/);
  assert.match(page, /let boundedCell = clipPlanPolygonToConvexBoundary/);
  assert.match(page, /limitAt\.heightAt/);
  assert.match(page, /minimum: framingBottom \+ 0\.01/);
  assert.match(page, /roofFinishUndersideAt\(point\) \?\? framingBottom/);
  assert.match(page, /triangulateDepthPolygon\(planPatch\)/);
  assert.match(page, /const limitedBoundaryEdges = new Map/);
  assert.match(page, /count: \(existing\?\.count \?\? 0\) \+ 1/);
  assert.match(page, /if \(count !== 1\) return/);
  assert.match(page, /ceilingOutline = \[\]/);
  assert.match(page, /ceiling-\$\{ceiling\.id\}-framing/);
  assert.match(page, /ceiling-\$\{ceiling\.id\}-finish/);
  assert.match(page, /\.map\(\(index\) => bottomFace\[index\]\)\s*\.reverse\(\)/);
  assert.match(page, /boundedCell\.length < 3/);
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

test("truss systems use a guarded closed envelope and a roof-driven finish-only ceiling", async () => {
  const page = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");

  assert.match(page, /const isTrussRoof = roofSystemType !== "rafter"/);
  assert.match(page, /const trussEnvelopeIssue =/);
  assert.match(page, /supports the Gable roof form only/);
  assert.match(page, /requires equal bearing elevations on every roof edge/);
  assert.match(page, /solidId: "truss-envelope"/);
  assert.match(page, /const trussEnvelopeFaces =/);
  assert.match(page, /Closed triangular prism/);
  assert.match(page, /if \(isTrussRoof\) \{/);
  assert.match(page, /ceiling-\$\{ceiling\.id\}-truss-finish/);
  assert.match(page, /Integrated truss bottom chord · separate layer disabled/);
  assert.match(page, /stored rafter ceiling height and framing depth remain untouched/);
  assert.match(page, /\{!isTrussRoof && \(/);
  assert.match(page, /Experimental limitation/);
});

test("higher roof bearings create separate derived wall supports", async () => {
  const page = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");

  assert.match(page, /wallUnderRoofEdge/);
  assert.match(page, /const derivedSupportForWall = useCallback/);
  assert.match(page, /bearingElevation <= authoredTop \+ 0\.001/);
  assert.match(page, /addDerivedRoofSupportSurfaces/);
  assert.match(page, /roofUndersideAt\(point\) \?\? support\.bearingElevation/);
  assert.match(page, /solidId: `derived-roof-support-\$\{wall\.index\}`/);
  assert.match(page, /Derived roof support/);
  assert.match(page, /does not rewrite this wall/);
});

test("roof thickness grows upward from fixed wall-bearing geometry", async () => {
  const page = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");

  assert.match(page, /DEFAULT_ROOF_ASSEMBLY/);
  assert.match(page, /structuralDepthInches: 5\.5/);
  assert.match(page, /buildUpThicknessInches: 0\.6/);
  assert.match(page, /Shared structural depth/);
  assert.match(page, /Shared roof build-up/);
  assert.match(page, /roofFaceNormal/);
  assert.match(page, /offsetRoofFace/);
  assert.match(page, /offsetRoofFacesWatertight/);
  assert.match(page, /offset\.total \/ offset\.count/);
  assert.match(page, /boundaryVerticalOffset/);
  assert.match(page, /roofBoundaryPoints/);
  assert.match(page, /boundaryKeys\.has\(key\)/);
  assert.match(page, /Shared bearing elevation/);
  assert.match(page, /DEFAULT_BEARING_ELEVATION_FEET = 9/);
  assert.match(page, /setRoofBase\(DEFAULT_BEARING_ELEVATION_FEET\)/);
  assert.match(page, /bearingRunForEdge/);
  assert.match(page, /const bearingDatumPoints/);
  assert.match(page, /wallsClosed && wallPoints\.length >= 3 \? wallPoints : roofPoints/);
  assert.match(page, /const ridgeElevation = roofBase \+ rise/);
  assert.match(page, /const eaveElevations = new Map/);
  assert.match(page, /structuralUndersideElevationForEdge/);
  assert.match(page, /one continuous surface/);
  assert.match(page, /const roofSurfaces = faces\.map/);
  assert.doesNotMatch(page, /const roofFacets = faces\.flatMap/);
  assert.match(page, /roofSurfaces\.map\(\(surface\) => surface\.points\)/);
  assert.match(page, /if \(surface\.outline === false\) return/);
  assert.match(page, /outline: false/);
  assert.match(page, /const facetEdges = new Map/);
  assert.match(page, /edge\.normals\.push\(roofFaceNormal\(surface\.points\)\)/);
  assert.match(page, /const hasSurfaceChange = normals\.slice\(1\)\.some/);
  assert.match(page, /points: \[undersideStart, undersideEnd\]/);
  assert.match(page, /const roofSurfaceEdgeStroke = "#171512"/);
  assert.match(page, /const roofSurfaceEdgeWidth = 1\.35/);
  assert.match(page, /fill: selectedEdge \? "#c77a45" : "#c98451",\s+stroke: roofSurfaceEdgeStroke,\s+lineWidth: roofSurfaceEdgeWidth,\s+outline: false/);
  assert.match(page, /distanceFeet \/ Math\.max\(0\.05, normal\.y\)/);
  assert.match(page, /roofingTopByPoint/);
  assert.match(page, /structuralUndersideByPoint/);
  assert.match(page, /roofPoints\.forEach\(\(corner\)/);
  assert.match(page, /solidId: "roof-assembly"/);
  assert.match(page, /const structuralTops = offsetRoofFacesWatertight/);
  assert.match(page, /roofAssembly\.structuralDepthInches \/ 12/);
  assert.match(page, /roofAssembly\.structuralDepthInches \+/);
  assert.match(page, /roofAssembly\.buildUpThicknessInches/);
  assert.match(page, /const hasTransitions =/);
  assert.match(page, /startElevation < eaveElevation - 0\.0001/);
  assert.match(page, /y: eaveElevation/);
  assert.doesNotMatch(page, /needsTriangulation/);
  assert.match(page, /neighboring side eaves jog/);
  assert.match(page, /transitionSlopeAtLoweredCorner/);
  assert.match(page, /ridgeElevation - elevation/);
  assert.match(page, /updateRoofAssembly/);
  assert.match(page, /rafterDepth: changes\.structuralDepthInches/);
});
