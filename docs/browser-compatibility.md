# Browser compatibility

Detailed per-feature support matrix for Lazy Lighting Web. All features are
client-side; the app feature-detects each API and degrades with an on-screen
message rather than failing silently. Version numbers are approximate (the
minimum version where the underlying web API became available); the app itself
does not sniff user-agent strings — it checks for the API at runtime.

## How to read this

- ✅ — supported
- ⚠️ — supported with a caveat (see note)
- ❌ — not supported; the app shows a graceful message / fallback
- "Needs network" means a first-use download from a third-party CDN (no
  account, no data leaves the device beyond fetching the file).

## Matrix

| Feature | API used | Chrome / Edge | Firefox | Safari |
| --- | --- | --- | --- | --- |
| App shell, dashboard, editor | ES2020+, CSS | ✅ (100+) | ✅ (100+) | ✅ (15+) |
| WebGL2 stage (three.js r187) | WebGL2 | ✅ | ✅ | ✅ (15+) |
| Project + media persistence | IndexedDB | ✅ | ✅ | ✅ |
| Settings / output sync | localStorage | ✅ | ✅ | ✅ |
| Live output window | `BroadcastChannel` (+ `storage` event fallback) | ✅ | ✅ | ✅ (15.4+) |
| Video export (WebM) | `canvas.captureStream` + `MediaRecorder` | ✅ | ✅ | ✅ (14.1+ MediaRecorder; 15+ `captureStream`) |
| Direct MP4 recording | `MediaRecorder.isTypeSupported('video/mp4')` | ❌ — WebM only | ❌ — WebM only | ✅ — MP4 offered when supported |
| MP4 conversion after export | FFmpeg.wasm (UMD via `<script>`) | ✅ | ✅ | ✅ |
| Camera as a surface source | `getUserMedia` (video) | ✅ | ✅ | ✅ — permission each session |
| Microphone audio-reactive | `getUserMedia` (audio) + Web Audio `AnalyserNode` | ✅ | ✅ | ✅ — permission each session |
| Audio file / project track | `<audio>` + `MediaElementAudioSourceNode` | ✅ | ✅ | ✅ |
| Web MIDI control | `navigator.requestMIDIAccess` | ✅ | ❌ — no Web MIDI API | ❌ — no Web MIDI API |
| MediaPipe hand/face tracking | tasks-vision (WASM + GPU delegate) | ✅ | ✅ | ✅ |
| Motion-tracking fallback | Canvas 2D frame differencing | ✅ | ✅ | ✅ |
| Depth presets | Canvas 2D | ✅ | ✅ | ✅ |
| Fullscreen present mode | Fullscreen API | ✅ | ✅ | ✅ |
| Clipboard (Copy Link URL) | `navigator.clipboard` | ✅ | ✅ | ✅ (needs user gesture) |
| File upload / download | `<input type=file>`, blob URLs | ✅ | ✅ | ✅ |

## Per-feature fallbacks

### Export

- `MediaRecorder` picks the first MIME type the browser reports as supported
  (`src/lib/exportEngine.ts`); if none is supported, export is disabled with
  an error message.
- If `canvas.captureStream` is missing, export throws a clear error ("This
  browser does not support canvas.captureStream").
- MP4: offered as a direct recording format only when
  `MediaRecorder.isTypeSupported` says so (Safari). Otherwise the only MP4
  path is the post-export FFmpeg.wasm transcode, which downloads the encoder
  (~31 MB) and the FFmpeg script from `unpkg.com` on first use. Offline, that
  button fails with a download error and WebM remains available.
- Real-time constraint (all browsers): the render loop pauses when the tab is
  hidden, so the tab must stay visible. 60 fps capture depends on the display
  and encoder and may fall back to the display refresh rate; 4K may drop
  frames on slower machines.

### Camera / microphone

- Requires a secure context (HTTPS or `localhost`). On plain `http://` on a
  LAN address, `getUserMedia` is unavailable and the app reports
  "not supported".
- Denied permission surfaces a specific error ("Microphone permission was
  denied. Allow microphone access in the browser site settings…").
- No camera/mic hardware → "device-unavailable" error.
- Video elements play **muted** so autoplay is not blocked; the camera preview
  is muted too.

### MIDI

- Chromium only. Firefox and Safari have no Web MIDI API; the MIDI panel
  reports "not available" and MIDI mappings simply never fire.
- No sysex is requested (`{ sysex: false }`).

### Tracking

- MediaPipe is lazy-loaded: nothing is downloaded until the user enables
  tracking. First enable fetches the WASM runtime from
  `cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@1.2.3/wasm` and the model
  files from `storage.googleapis.com/mediapipe-models/...`. Offline or
  blocked CDN access → model download failure → the app falls back to motion
  tracking and says so.
- Motion tracking (frame differencing on the camera image) works wherever the
  camera works, including Firefox and Safari. It is labelled "Motion tracking
  (no hand/face model)" everywhere — never presented as hand/face tracking.
- Tracking has not been verified in a headless environment; see
  `docs/manual-testing-checklist.md`.

### Output window

- `BroadcastChannel` sync requires the output window and the studio to be in
  the same browser (same profile). Opening `/output` in a different browser
  or on another device shows the last state from `localStorage` if any, or
  the test pattern — it will not live-sync.
- Safari 15.3 and older have no `BroadcastChannel`; the `storage` event
  fallback still syncs on `localStorage` writes.

### Shader visuals

- Static validation (`validateShaderSource`) runs without a GPU; the real
  compile happens on the device GPU at runtime (`compileShader`). A shader
  can pass the static check and fail on a specific GPU/driver; that visual
  then fails at runtime with a surfaced error instead of silently rendering
  black.

### Blend modes

- three.js core exposes additive, multiply and subtract blending; screen,
  overlay and difference have no three.js constants and fall back to normal
  blending (`blendModeToThree`, `src/lib/engine/masks.ts`). This is the same
  on every browser — it is a renderer limitation, not a browser one.

## Known browser-specific quirks

- **Safari**: video files must be MP4 (H.264) or MOV for the `<video>` element
  in some versions; WebM video upload is accepted by the app's validator but
  may not play in Safari's `<video>` element. Safari also requires a user
  gesture before an `AudioContext` can start (the app only creates it on
  user action, so this is handled).
- **Firefox**: no Web MIDI; `MediaRecorder` WebM output is VP8/VP9 depending
  on build.
- **Chrome/Edge**: full feature set; the reference browsers for development.
- **iOS Safari / Android Chrome**: the app loads and the stage renders, but
  projection mapping is designed for a desktop + projector workflow; touch
  corner-dragging works via pointer events, camera/mic need permission, and
  Web MIDI is unavailable. Not formally tested — see the manual checklist.
