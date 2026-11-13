# Lazy Lighting Web

Turn any surface into a projection-mapped canvas — an original web
implementation inspired by **Lazy Lighting** (iOS, Audity Apps, App Store id
6751762579). Not affiliated with or endorsed by Audity Apps.

Map shapes onto real surfaces, fill them with live generative visuals, photos,
video or a camera feed, build multi-scene shows on a timeline, react to audio
or MIDI, send a clean output to a second display, and record the result as
video. Everything runs in the browser; there is no server, no account, and no
cloud sync (see [Local-first, no accounts](#local-first-no-accounts)).

## How to run

```bash
npm install
npm run dev     # http://localhost:3000 — development server
npm run build   # production build (type-checks + bundles)
npm run start   # serve the production build
npm test        # unit tests (vitest) — see Testing below
npm run lint    # eslint
```

**No environment variables required.** There is no `.env` file, no secret, no
API key, and nothing to configure before running. The only network fetches the
app ever makes are optional, user-triggered downloads: MediaPipe tracking
models and the FFmpeg.wasm encoder for MP4 conversion (see Known
limitations).

## Tech stack

| Layer | Choice |
| --- | --- |
| Framework | Next.js 16 (App Router, Turbopack), React 19, TypeScript (strict) |
| Styling | Tailwind CSS 4, hand-rolled shadcn-style UI primitives in `src/components/ui/` |
| 3D / rendering | three.js + @react-three/fiber v9 (WebGL2 stage, true per-vertex homography warp); legacy Canvas 2D renderer in `src/lib/render.ts` |
| State | Zustand (`src/lib/store.ts`) — single source of truth, bounded undo/redo (50 snapshots), debounced 1.5 s autosave |
| Persistence | IndexedDB (`src/lib/db.ts`, raw API, no dependency) for projects + media blobs; localStorage for settings and output-window sync |
| Validation | Zod v3 — versioned project format (`src/lib/schema.ts`) |
| Animation | GSAP (timeline/scene transitions), custom LFO/envelope engine |
| Audio | Web Audio API (`AnalyserNode`, `src/lib/audio.ts`) |
| Tracking | MediaPipe tasks-vision, lazy-loaded only when enabled |
| Export | `canvas.captureStream` + `MediaRecorder`; optional FFmpeg.wasm MP4 transcode (CDN, lazy) |
| Tests | Vitest 3 (`npm test`) |

## Features by area

### Mapping

- Surface shapes: rect, square, circle, ellipse, rounded-rect, polygon,
  freeform, text, silhouette, cube/box, curved, freehand — created from the
  shape toolbar (polygon: click vertices, Enter to finish; freehand: drag an
  outline).
- Drag all four corner handles on the stage; the content is warped with a true
  homography (`src/lib/homography.ts`, unit-tested). Edge handles bend edges
  (curve −1…1). Grid + snap, rotate, z-order, opacity, visibility, lock.
- Multiple surfaces at once, each with its own content, effects and mask.
- Masks: none / circle / rounded / cutout (+ polygon, freehand, text). Image
  masks are recognised and stored but not yet applied by the renderer (see
  Known limitations).
- Blend modes: normal, additive, multiply, subtract (screen / overlay /
  difference fall back to normal — see Known limitations).
- Mapping templates (`/templates`): Single Wall, Two Walls / Corner, Window
  Display, Stage Cube.

### Content

- **64 classic procedural Canvas 2D visuals** (`src/lib/visuals.ts`:
  Gradient, Tunnel, Neon, Generative, VJ, Depth) plus a **GLSL shader visual
  library** (`src/lib/shaders.ts`) — no image assets. Includes 11 Halloween
  and 14 Christmas visuals.
- **Images**: JPG / PNG / WebP / GIF / SVG upload. Images ≤ 2 MB are embedded
  as data URLs and survive a reload; larger images are session-only (see
  Known limitations).
- **Video**: MP4 / WebM / MOV upload, looped playback. Videos are session-only
  object URLs and do not survive a reload. Video elements are **muted** so
  autoplay is not blocked by the browser.
- **Camera**: live `getUserMedia` feed as a surface source.
- **Drawing**: pointer drawing onto a surface's stroke layer (brush
  color/size, clear, "animate wobble").
- **Depth mode**: upload a photo, set a surface to Depth, use the Depth slider.
  The depth map is **estimated from brightness, not AI depth estimation** (the
  UI says so); you can also import a real grayscale depth map instead. Seven
  presets: depth waves, displacement, pulse, neon contours, particles,
  animated lighting, depth color.

### Effects

Per-surface live effects: blur, brightness, contrast, saturate, hue, invert,
grayscale, zoom, rotate, kaleidoscope segments, tile X/Y, slide speed, color
cycle — all live. Effect pipeline in `src/lib/effectPipeline.ts` /
`src/lib/effects.ts`.

### Scenes, timeline, show playback

- Scenes are snapshots of all surfaces (add / duplicate / delete / rename /
  reorder). Switching scenes snapshots the outgoing scene first, so edits made
  while a scene is active are not lost.
- Transitions: cut / fade / dissolve / crossfade, with duration. They are
  linear opacity ramps — dissolve also crossfades; there is no dither pattern
  (see Known limitations).
- Timeline (`/studio` timeline editor): tracks (video / image / audio /
  animation / effect), clips (add / duplicate / split / move), keyframes with
  linear interpolation (`src/lib/timeline.ts`, unit-tested), BPM, loop,
  BPM-sync. Play Show auto-advances scene clips; the render loop samples the
  timeline every frame (`activeSceneClipAt`, `sampleKeyframes`).
- Project audio track: upload with trim start/end, volume, play/pause; it can
  be mixed into exports.

### Audio-reactive, LFO, MIDI

- Microphone (Web Audio `AnalyserNode`) or an audio file / project track drives
  levels: amplitude, bass / mid / high bands, beat detection (bass-energy
  flux). Bands map onto scale / rotation / brightness / particles / opacity /
  speed (`src/lib/audio.ts`, unit-tested).
- LFO / envelope modulation engine (`src/lib/modulation.ts`, unit-tested):
  sine / triangle / square / sawtooth / ADSR-style envelope, BPM sync
  (frequency = BPM / 60 / beats-per-cycle), depth, phase, offset.
- MIDI via `navigator.requestMIDIAccess` (Chromium only): CC mappings to
  parameters, note mappings to scenes. Status is shown; other browsers get a
  graceful "not available" message.
- Performance mode: a distraction-free stage (handles + interaction hidden).

### Tracking

- Hand / face tracking via MediaPipe tasks-vision, loaded **only** when the
  user enables it (dynamic `import()`, never in the initial bundle). Models
  (`hand_landmarker.task`, `face_landmarker.task`) download from Google's
  MediaPipe model storage and the WASM runtime from jsDelivr at enable time.
- If MediaPipe cannot load, the app falls back to **camera motion tracking**
  (frame differencing → motion centroid), labelled everywhere as "Motion
  tracking (no hand/face model)". Tracking is never claimed when it is not
  running. Headless verification was not possible — see Known limitations.

### Output window

- **Open Output Window** opens `/output`: a full-screen, read-only stage
  synced live from the studio via `BroadcastChannel`
  (`lazy-lighting-output`) + `localStorage` (`lazy-lighting-output-state`).
  **Copy Link URL** copies the `/output` URL; **Present** fullscreen-toggles
  the stage. A test-pattern mode and ProjectorSetup are available on the
  output page. Sync works in the same browser only.

### Export

- Record the real render loop: the export stage is a live `ProjectionCanvas`
  whose WebGL backing store is resized to the export resolution while the
  playhead runs from t = 0, so scene switches, transitions and keyframes happen
  inside the recording.
- Resolutions 720p / 1080p / 4K, 24 / 30 / 60 fps, full-timeline or custom
  length (1–600 s), bitrate 8 / 16 / 32 Mbps, optional project-audio mix-in.
- Format is **WebM** (`MediaRecorder`) everywhere. **MP4** is offered only when
  the browser can record it directly (Safari), or via an optional in-browser
  FFmpeg.wasm transcode after the WebM export (downloads the encoder, ~31 MB,
  from unpkg on first use). See Known limitations.
- Exports can be saved into the media library (IndexedDB).

## Routes

| Route | What it is |
| --- | --- |
| `/` | Dashboard — recent projects (IndexedDB), New / Rename / Duplicate / Delete |
| `/studio` | Editor (demo project if none exists) |
| `/studio/[projectId]` | Editor for a saved project (falls back to demo + notice if missing) |
| `/library` | Media blobs (upload / delete) + the visual library, searchable |
| `/templates` | Mapping templates — creates a project and opens it in the studio |
| `/settings` | Quality, grid/snap, shortcuts reference, local data management (storage usage, JSON export/import, clear local data) |
| `/export/[projectId]` | Video export workspace (live stage + record controls) |
| `/output` | Clean full-screen output view (BroadcastChannel sync) |

## Project format + persistence

- **Format**: versioned JSON, current version **v1**, Zod-validated
  (`src/lib/schema.ts`). `migrateProject()` upgrades v0 localStorage-shaped
  projects and never throws on bad input — unrecognised input returns the demo
  project. JSON import/export is available from the dashboard and settings.
- **Persistence**: projects and media blobs live in this browser's IndexedDB
  database `lazy-lighting-db` (stores `projects` and `media`). Settings live
  in localStorage. Autosave runs 1.5 s after the last edit; there is also a
  manual save (Ctrl/Cmd+S) and a save-state indicator.
- **Undo/redo**: 50 project snapshots in the Zustand store.
- **Keyboard shortcuts**: save, undo, redo, duplicate, delete, play/pause,
  fullscreen, grid, Esc (`src/lib/shortcuts.ts`; full list in Settings).

### Local-first, no accounts

Projects and media live in this browser's IndexedDB — nothing leaves the
device. There are **no accounts, logins, passwords, or cloud sync: no
Supabase, no auth, no user handling of any kind**. This is a deliberate
product decision, not a missing feature. Clearing the browser's site data
deletes projects unless you exported them as JSON first.

## Browser compatibility

| Feature | Chrome / Edge | Firefox | Safari |
| --- | --- | --- | --- |
| App + WebGL2 stage | ✅ | ✅ | ✅ (15+) |
| IndexedDB persistence | ✅ | ✅ | ✅ |
| MediaRecorder export (WebM) | ✅ | ✅ | ✅ (14.1+) |
| Direct MP4 recording | ❌ (WebM only) | ❌ (WebM only) | ✅ (MP4 mime supported) |
| FFmpeg.wasm MP4 conversion | ✅ (needs network to unpkg.com) | ✅ | ✅ |
| Camera / microphone (`getUserMedia`) | ✅ | ✅ | ✅ (permission per session; HTTPS or localhost) |
| Web MIDI | ✅ | ❌ (no Web MIDI API) | ❌ (no Web MIDI API) |
| MediaPipe hand/face tracking | ✅ | ✅ | ✅ (needs network to Google storage + jsDelivr on first enable) |
| Motion-tracking fallback | ✅ | ✅ | ✅ |
| Output window (`BroadcastChannel`) | ✅ | ✅ | ✅ (15.4+) |
| `canvas.captureStream` export | ✅ | ✅ | ✅ (15+) |

When an API is missing the app degrades gracefully with an on-screen message
instead of failing silently (e.g. "MIDI not available in this browser",
"Microphone permission was denied"). Full per-feature matrix + fallbacks:
[`docs/browser-compatibility.md`](docs/browser-compatibility.md).

## Testing

```bash
npm test        # vitest run — 80 unit tests, all hardware-free (Node)
```

Coverage (all under `src/lib/__tests__/`):

| File | What it covers |
| --- | --- |
| `homography.test.ts` | 4-corner exact mapping, centre mapping, inverse round-trip, degenerate quad → null, identity, point-in-quad, bounds |
| `schema.test.ts` | v0 → v1 migration, garbage input never throws, v1 passthrough, demo fallback |
| `timeline.test.ts` | active scene/audio clips, keyframe linear interpolation + clamping, total duration |
| `modulation.test.ts` | sine/triangle/square/sawtooth values, BPM-sync frequency, envelope attack/decay/release |
| `audio.test.ts` | `mapBandToParam` clamping/scaling/sensitivity, `getAudioModulations` incl. first-mapping-wins |
| `store.test.ts` | real Zustand store (IndexedDB mocked): add/duplicate/remove surface, undo/redo, scene-switch snapshot restore |
| `depth.test.ts` | pure depth parts: `coerceDepthParams` clamping/defaults, preset catalogue, honest estimate label |

Anything needing a browser, camera, MIDI controller, external display or GPU
is **not** covered by `npm test` — use the manual checklist:
[`docs/manual-testing-checklist.md`](docs/manual-testing-checklist.md).

## Known limitations

Consolidated from the build phases and verified against the current code.
Nothing here is hidden; each item names the file or behaviour behind it.

1. **WebM-only export by default.** `MediaRecorder` records WebM everywhere
   except Safari, which can record MP4 directly (`src/lib/exportEngine.ts`).
   The MP4 fallback is an optional in-browser FFmpeg.wasm transcode
   (`src/lib/mp4Convert.ts`) that downloads the encoder (~31 MB) and script
   from the unpkg CDN on first use — it needs network access to unpkg.com.
2. **Export is real-time and needs a visible tab.** A 60 s export takes 60 s;
   the render loop pauses when the tab is hidden, so keep the tab visible
   until the recording finishes. 60 fps capture depends on the display and
   encoder and may fall back to the display refresh rate. 4K recording is
   heavy and may drop frames on slower machines.
3. **Video is muted for autoplay.** Uploaded videos and the camera preview play
   muted (`Studio.tsx`: `v.muted = true`); unmuting a video is a manual,
   per-video action, and project audio is mixed into exports separately.
4. **Shader visuals: static check ≠ GPU compile.** `validateShaderSource`
   (no GPU) only checks that the fragment defines `main()` and every uniform;
   the shader is then really compiled on the GPU at runtime
   (`compileShader`, `src/lib/shaders.ts`). A shader can pass the static check
   and still fail on a particular GPU/driver, in which case that visual fails
   at runtime with a surfaced error.
5. **Hand/face tracking is unverified in a headless environment.** MediaPipe
   tracking (`src/lib/tracking.ts`) was implemented with lazy loading and a
   motion-tracking fallback, but no live hand/face run was ever observed in
   this environment — no camera, no headless MediaPipe run. Treat it as
   "implemented, needs a live-browser check" (see the manual checklist).
   First enable also downloads models from Google storage and WASM from
   jsDelivr, so it needs network.
6. **Depth is estimated, not measured.** The depth map is computed from photo
   brightness (luminance + edges, `src/lib/depth.ts`) — a heuristic, not AI
   depth estimation. The UI labels it as such. Importing a real grayscale
   depth map uses that map instead.
7. **Transitions are opacity ramps.** Cut / fade / dissolve / crossfade all
   ramp opacity linearly (`src/lib/sceneTransition.ts`); dissolve also
   crossfades. There is no dither pattern or per-pixel dissolve.
8. **Blend-mode fallbacks.** Only add, multiply and subtract map to real
   three.js blending (`blendModeToThree`, `src/lib/engine/masks.ts`); screen,
   overlay and difference fall back to normal rather than silently doing the
   wrong thing.
9. **Image masks are stored, not rendered.** The `image` mask kind is a
   recognised kind in `src/lib/maskTools.ts`, but the renderer does not apply
   image masks yet.
10. **The 2 MB image rule still applies.** Images ≤ 2 MB are embedded as data
    URLs on the surface and survive a reload; larger images use a session-only
    blob object URL and must be re-picked after reopening the project
    (`IMAGE_DATA_URL_MAX_BYTES`, `src/lib/media.ts`). Videos are always
    session-only object URLs and never survive a reload. (The planned
    engine-side media resolver that would remove this rule is not built.)
11. **Legacy warp approximation.** The WebGL engine warps with a true
    per-vertex homography, but the legacy Canvas 2D renderer
    (`src/lib/render.ts`, used by the v1 studio) still uses a 32-strip
    horizontal-slice perspective approximation.
12. **Output sync is same-browser only.** The output window syncs via
    `BroadcastChannel` + `localStorage`; it must be opened from the same
    browser (same profile) as the studio.
13. **Audio needs a gesture + permission.** The `AudioContext` is created only
    on user action; the mic needs permission. Beat detection is a bass-energy
    flux heuristic, not beat tracking.
14. **Web MIDI is Chromium-only.** Firefox and Safari have no Web MIDI API;
    the app shows a "not available" state there.
15. **Degenerate quads are refused, not fixed.** If corner dragging makes three
    corners collinear, `computeHomography` returns null and the engine leaves
    that surface's geometry as-is until the corners form a real quad again
    (Phase 7 fix — previously the solver could return a matrix sending a
    corner to infinity).
16. **No cloud backup.** Local-first means clearing browser site data deletes
    projects. Export JSON regularly from Settings or the dashboard.

## Architecture (file map)

- `src/app/page.tsx` — dashboard; `src/app/studio/` — editor;
  `src/app/output/page.tsx` — output window; `src/app/export/[projectId]/` —
  export workspace; `src/app/library/`, `src/app/templates/`,
  `src/app/settings/` — supporting pages
- `src/components/Studio.tsx` — v1 studio; `src/components/StudioEditor.tsx`
  — v2 editor shell; `src/components/ProjectionCanvas.tsx` — WebGL stage +
  interaction overlay; `src/components/ExportWorkspace.tsx` — export UI
- `src/lib/engine/` — WebGL renderer (surfaces, masks, camera bus, renderer)
- `src/lib/visuals.ts` — procedural visuals; `src/lib/shaders.ts` — GLSL
  visuals; `src/lib/warp.ts` — point-in-quad, shape clipping;
  `src/lib/render.ts` — legacy Canvas 2D renderer
- `src/lib/schema.ts` — project format; `src/lib/db.ts` — IndexedDB;
  `src/lib/store.ts` — Zustand store; `src/lib/templates.ts` — mapping
  templates; `src/lib/projects.ts` — localStorage v0 projects + demo seed

## Origin

An unofficial web recreation of Lazy Lighting (iOS, Audity Apps). All visuals
are generated procedurally in code; no assets from the iOS app are used.
