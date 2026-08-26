# Roof and ceiling thickness implementation plan

**Status:** Next independent feature; planning only  
**Scope:** Add explicit ceiling framing and volumetric roof assemblies without changing the shipped prototype in this task.

## Decisions and datums

- A ceiling is owned by a room and is selected/edited through its own inspector.
- `ceiling.bottomOfFramingElevation` is the meaning of “ceiling height.” For a room whose walls share one top-plate elevation, creation defaults this value to that shared elevation.
- `ceiling.assemblyThickness` is independent and grows upward: `topOfFramingElevation = bottomOfFramingElevation + assemblyThickness`.
- A future gypsum/finish layer is a separate object below the framing datum and is not included in `assemblyThickness`.
- The solved roof face remains the top-of-structural-framing datum described by the existing roof proposal. The visible roof volume extends by structural member depth below that face and roof build-up above it, measured normal to the sloped face.
- Roof structural system, pitch, structural member depth, and roof build-up are roof-owned. Eave bearing and finish conditions may vary per edge.

## Proposed model boundary

```ts
type RoofAssembly = {
  systemType: RoofSystemType;
  pitch: number;                    // inches rise per 12 inches run
  structuralMemberDepthInches: number; // rafter or top-chord depth
  buildUpThicknessInches: number;  // sheathing/roof layers above framing
};

type Roof = {
  // existing boundary, form, base elevation, etc.
  assembly: RoofAssembly;
  edges: RoofEdgeRelationship[];
};

type RoofEdgeRelationship = {
  conditionId: string;
  elevationOffsetFeet: number;
};

type EaveCondition = {
  // catalog identity and system compatibility
  id: string;
  name: string;
  systemType: RoofSystemType;
  parameters: {
    // edge-varying bearing/finish inputs only: seat cut, heel height,
    // overhang, fascia, soffit, and other condition-specific values
  };
};

type Ceiling = {
  id: string;
  roomId: string;
  bottomOfFramingElevationFeet: number;
  assemblyThicknessInches: number;
};
```

`rafterDepth` currently lives in `EaveParameters`, and `pitch` is duplicated between the roof and detail. Move authoritative shared values to `RoofAssembly`; use system-specific labels in the UI (“Rafter depth” or “Top-chord depth”) without changing their ownership. The 2D detail editor should receive both a roof-assembly draft and an edge-condition draft so it can render the full section while clearly labeling controls as **Whole roof** or **This eave condition**.

For migration, derive the initial roof member depth from the first compatible assigned detail (falling back to `DEFAULT_EAVE_PARAMETERS`) and record a validation warning if other assigned details disagree. Derive the initial build-up from the current 0.6-inch sheathing constant. After migration, catalog details must not be authoritative for either value.

## Shared-versus-per-edge validation

Use one pure validator at every mutation boundary (detail save, edge assignment, roof-system change, load/migration), not UI-only checks:

```ts
validateRoof(roof, catalog): RoofIssue[]
```

It should verify:

1. Every edge references an existing condition compatible with `roof.assembly.systemType`.
2. All roof-owned dimensions are finite and positive and use one canonical unit internally.
3. No legacy/detail payload claims a pitch, member depth, or build-up that conflicts with the roof assembly (compare integer sub-inch units or a small epsilon during migration).
4. Edge-varying parameters remain locally valid (for example seat cut versus member depth and fascia minimum versus the roof assembly).
5. A ceiling references an existing room, has positive thickness, and has a finite bottom datum.
6. Automatic “shared top plate” initialization is allowed only when all participating room walls have the same plate elevation within tolerance. Otherwise require an explicit bottom datum and surface a non-destructive warning.

Do not silently let the last edited edge overwrite a shared property. Editing a whole-roof field in the detail editor updates `RoofAssembly` once and regenerates every applied edge preview. Assigning a legacy or imported detail with a conflicting shared value is rejected (or requires an explicit “use this value for the whole roof” action), with all conflicting edges named.

## Geometry and interaction work

1. Extract the existing face generation in `app/page.tsx` into a pure roof-geometry function that returns stable face IDs, polygons, and outward unit normals. Keep picking regions associated with the outer/top face and source edge ID.
2. For each solved top-of-framing face, create parallel offsets at `-structuralMemberDepth` and `+buildUpThickness`, measured along its normal. Generate top, underside, eave/rake boundary, ridge/hip, and transition side polygons so the depth buffer receives a closed volume rather than one surface.
3. Resolve adjacent offset-face intersections at ridges, hips, and unequal eave transitions. Avoid independently offsetting polygon vertices without re-intersection; that produces gaps and overlaps. Preserve source face/edge attribution on generated closure faces.
4. Replace the hard-coded `SHEATHING_THICKNESS` in `EaveDetailEditor.tsx` with the roof-owned build-up draft, and drive rafter/top-chord drawing from the same roof-owned structural depth used by 3D.
5. Add roof inspector fields for structural member depth and build-up. In the 2D editor, show the same fields in a “Whole roof” section and keep overhang, seat/heel, fascia, and related controls in “This edge/detail.”
6. Introduce a room/ceiling slice independently of the roof solver. Derive its plan footprint from the owning room, render a framing prism from bottom datum upward, add ceiling selection/picking, and add its inspector controls. Do not model finish gypsum in this feature.

## Verification

- Unit-test ownership/validation: two different edge conditions can coexist; incompatible systems are rejected; conflicting legacy shared values are diagnosed; one whole-roof edit updates every rendered detail without copying values to edges.
- Unit-test ceiling datums: equal-height walls default to their shared top plate; unequal walls require/retain an explicit datum; changing thickness never changes the bottom elevation; changing height translates both framing faces.
- Geometry-test gable, hip, and shed fixtures: normal distance from structural top to underside equals member depth, and to assembly top equals build-up, at both eave and ridge samples.
- Regression-test different per-edge overhangs/elevations with one shared assembly, including raised/lowered transitions, to catch cracks and inverted closure faces.
- UI-test roof and ceiling inspectors, editor scope labels, edge assignment conflict messaging, selection, and a round trip through any future serializer.
- Visual snapshots should compare the 2D eave section and 3D cut/eave silhouette for the same roof values; changing rafter depth or build-up must visibly change both.

## Suggested delivery slices

1. Normalize `RoofAssembly`, add validator/migration, and make the 2D editor scope-aware without changing 3D output.
2. Extract/test the roof geometry solver, then add closed thickness geometry and picking attribution.
3. Add the room-owned ceiling model, defaulting rule, prism rendering, selection, and inspector.
4. Add focused regression fixtures and visual snapshots, then remove compatibility fields/constants after migration coverage is proven.

The ceiling slice is model-independent and can be developed alongside roof extrusion once shared unit and datum helpers are established.
