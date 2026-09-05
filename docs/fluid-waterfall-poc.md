# FluidRenderer waterfall POC

This POC replaces the two legacy waterfall ribbons with a hybrid waterfall: a
single translucent sheet provides the continuous body of water and
FluidRenderer particles add volume and breakup over it. The hybrid waterfall is
75% of the legacy width. Its source now sits on the upper terrain lip and joins
a short, double-sided feeder stream, so it remains connected when viewed from
above or from underwater.

The lagoon `WaterMaterial`, underwater effect, impact foam, splash, droplet
bursts, mist, lights, audio position and gameplay remain on their existing
paths. If FluidRenderer cannot initialize, `TerminalLandmark` keeps the original
two-ribbon waterfall as a fallback.

## Activation

- Legacy (default): omit `fluidWaterfall`, or use `?fluidWaterfall=0`.
- FluidRenderer: `?fluidWaterfall=1`.
- Development-only debug geometry and metrics:
  `?fluidWaterfall=1&fluidWaterfallDebug=1`.
- Density preset: append `&fluidWaterfallPreset=low`, `medium`, or `high`.

The debug view shows the rectangular emitter plus active/configured particle
counts, emit rate, FPS, frame time, calculated positions and trajectory
constants. It intentionally has no visible impact marker. In development, the
same snapshot is available from
`globalThis.__bosqueFluidWaterfallDebug.getSnapshot()`; neither the view nor the
debug global is exposed by production builds.

## Initial tuning

| Preset | Particle capacity | Fluid target size | Intended use |
| --- | ---: | ---: | --- |
| LOW | 300 | 320 | Low-cost comparison |
| MEDIUM | 600 | 512 | POC default |
| HIGH | 1000 | 768 | Upper-bound benchmark |

All presets use a box emitter covering the central 82% of the backing sheet,
`9.81` world-units/s² gravity and `0.20` world-units/s initial downward speed.
The outward speed is derived from the distance to the validated lagoon impact
point. Lifetime is calculated with the constant-acceleration fall equation from
the emitter Y to `TerminalLandmarkConfig.waterLevel + 0.08`; particles therefore
expire at the lagoon surface without per-particle mesh intersections. A small
seeded X/Z jitter breaks up the edges, while a weak X convergence avoids a
perfectly uniform sheet.

The impact point is found by walking inward from the rock lip and sampling the
complete waterfall width against the same irregular-lagoon containment function
used by the mesh, terrain and gameplay. The accepted footprint is additionally
contracted by 1.25 world units, so the fall and its contact effects land safely
inside the water rather than on the bank.

## World integration

The lagoon's shared procedural outline includes a narrow rear cove that reaches
under the waterfall. This removes the dry terrain strip between the rendered
lake and the calculated impact. The terrain modifier also carves a dedicated
plunge pool there, keeping even the coarse terrain-grid triangles below the
water surface. The rendered water intentionally continues beyond the gameplay
shoreline and underneath the opaque terrain, so its outer mesh edge remains
hidden instead of ending as a visible flat plate.

The nominal lagoon depth is now 16 world units (previously 8.5), with an
approximately 18-unit-deep plunge pool under the fall. Both shapes blend into
the broader central basin rather than forming a separate water volume.

The avatar is included only in the lagoon refraction pass. WaterMaterial clips
that pass at the surface, tinting and distorting the submerged body without
duplicating the portion above water in the reflection. The water is also
double-sided for underwater views. A final terrain-height guard is applied to
every third-person camera result so the camera cannot expose the underside of
the map at steep banks.

The isometric view is now disabled from the front approach to the house through
the terminal lagoon. This avoids rendering the expensive distant lake view and
keeps the close camera needed for future underwater objectives.

Full emission is used within 74 world units of the player, then fades to 30%
before the system is stopped, cleared and detached from FluidRenderer at 138
units. It is registered again only when the player returns inside that radius.

## Rendering pipeline audit

The scene currently has no PrePassRenderer, GeometryBufferRenderer, SSAO/SSAO2,
DefaultRenderingPipeline or GlowLayer. It does use:

- scene EXP2 fog;
- a camera-attached vintage-film post-process;
- a camera-attached underwater post-process that is added/removed at the
  lagoon surface;
- `WaterMaterial` reflection/refraction render lists;
- transparent waterfall/contact effects in rendering groups 0 and 1, with
  group 1 preserving the opaque depth buffer.

Babylon.js 9.23 FluidRenderer is registered once on the existing scene and
creates its own depth/thickness targets and camera post-process. Its output is
therefore composed before the existing film and conditional underwater passes.
The POC does not enable or disable any global renderer, post-process, fog or
image-processing setting. The fluid object is not added to the lagoon
WaterMaterial render lists because it is reconstructed after the normal mesh
pass, while the disabled legacy ribbons may safely remain in those lists.

The controller reuses an existing scene FluidRenderer when present. On explicit
disposal it removes only its render object and particle system; it disables the
renderer only when it created it and no other fluid objects remain.

## Measurement status

Build/type validation can be automated from the repository, but meaningful FPS
and visual-quality numbers require a real browser/GPU run at the waterfall.
Record LOW/MEDIUM/HIGH results with the debug panel before promoting a preset;
no synthetic CLI result should be treated as a rendering benchmark.

Known POC limitations: this is screen-space reconstruction over conventional
CPU particles, not SPH; it has no rock collision; and the authored fluid
colour/density may still need device-specific visual tuning after in-game
captures on more than one GPU.
