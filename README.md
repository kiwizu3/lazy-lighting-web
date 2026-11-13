# Lazy Lighting Web

Turn any surface into a projection-mapped canvas — an unofficial web recreation of **Lazy Lighting** (iOS, Audity Apps, App Store id 6751762579). Not affiliated with or endorsed by Audity Apps.

## Run it

```bash
npm install
npm run build
npm run start   # http://localhost:3000
```

No extra dependencies, no external images or fonts.

## How it maps to the iOS app

| iOS app feature | Web recreation |
| --- | --- |
| Map any surface (squares, circles, text, cubes, silhouettes, hand-drawn outlines) | Shapes tab: rect / circle / text / cube / silhouette / freehand surfaces; drag corner handles on the stage, cyan mid-edge handles bend edges (curve −1…1); masks (none / circle / rounded / cutout); several surfaces at once, per-surface content, opacity, z-order |
| Live visuals (visualizers, VJ loops, generative shaders, gradients, tunnels, neon) | 64 procedural Canvas 2D visuals in `src/lib/visuals.ts` (Gradient, Tunnel, Neon, Generative, VJ, Depth) — no assets |
| Import videos & photos; live camera feed | Media tab: image upload (compressed dataURL, persists in the project), video upload (session-only object URL), camera via `getUserMedia` as a surface source |
| Draw & animate original visuals | Draw tab: pointer drawing onto a surface's stroke layer, brush color/size, clear, "animate wobble" toggle |
| Real-time effects: kaleidoscope, tile, slide, rotate, zoom, blur, monochrome, invert, color cycle | Right panel: blur, brightness, contrast, saturate, hue, invert, grayscale, zoom, rotate, kaleidoscope segments, tile X/Y, slide speed, color cycle — all live |
| Audio-reactive visuals, BPM-synced LFO, MIDI control | Mic toggle (Web Audio AnalyserNode drives a global audio level), BPM slider 60–180 with LFO target (opacity / zoom / hue) + depth, MIDI via `navigator.requestMIDIAccess` (CC 1 → opacity, CC 7 → zoom, CC 74 → hue); status shown, graceful "not available" message |
| Hand/face tracking | **Not implemented as real tracking.** Implemented honestly as camera *motion tracking*: the stage reacts to mouse movement (parallax) and mic level. The UI labels this as motion tracking, not hand/face tracking. |
| Build a show: scenes, switch live, timeline, audio track, transitions | Scenes are snapshots of all surfaces (add / duplicate / delete, rename via the scene buttons); fade / dissolve / cut transitions with duration; timeline bar with per-scene durations and Play Show auto-advance; audio track upload with trim start/end, volume, play/pause |
| Export 720p / 1080p / 4K with audio | Record button uses `stageCanvas.captureStream(30)` + `MediaRecorder` (WebM download). Audio is mixed in via `AudioContext` when an audio track is attached; otherwise the UI says video-only. |
| External display output / "play without your phone" | **Open Output Window** opens `/output` (full-screen read-only stage, synced live via `BroadcastChannel` + `localStorage`); **Copy Link URL** copies the `/output` URL; **Present** fullscreen-toggles the stage |
| Depth Mode (photo → depth-aware shape) | Upload a photo, set a surface to Depth, use the Depth slider: layered parallax slices offset by depth + mouse parallax on the stage |
| 50+ Halloween & Christmas visuals | 11 Halloween visuals (pumpkin, ghost, bats, spiderweb, haunted fog, candy corn, jack-o'-lantern glow, eerie green, witch hat, cauldron, full moon) and 14 Christmas visuals (snowfall, tree, fairy lights, candy cane, fireplace, snow aurora, ornaments, reindeer, gift boxes, candle, sleigh, mistletoe, snowman) — 64 visuals total |

## Architecture

- `src/app/page.tsx` — single-page studio (client component)
- `src/components/Studio.tsx` — studio UI: top bar, sidebar tabs, stage with corner/edge handles, right effects panel, scenes + timeline + export
- `src/app/output/page.tsx` — clean full-screen output view (`BroadcastChannel` `lazy-lighting-output` + `localStorage`)
- `src/lib/visuals.ts` — procedural visuals (`VISUALS`, 64 entries)
- `src/lib/types.ts` — shared types + surface/project factories
- `src/lib/warp.ts` — point-in-quad hit test, 32-strip perspective warp, shape clipping
- `src/lib/render.ts` — shared stage renderer (per-surface offscreen canvas → effects → warp; cube isometric faces; depth slices)
- `src/lib/projects.ts` — localStorage save/load + demo project seed (3 surfaces, 2 scenes)

## Notes & limits

- Rendering is a 32-strip horizontal-slice perspective approximation, not a true homography — good enough for live alignment, and it keeps the warp fast in Canvas 2D.
- Videos are object URLs and do not survive a reload; images are stored compressed (max 1280px, JPEG 0.8) so projects persist.
- Export is WebM (MediaRecorder), not MP4; 4K recording depends on the machine's canvas performance.
- Cross-tab output sync works in the same browser (BroadcastChannel + storage events).
