# Manual testing checklist

Features that cannot be verified by `npm test` (they need a real browser, a
camera, a MIDI controller, an external display, or a GPU). Work through this
in Chrome (reference browser) first, then spot-check Safari and Firefox where
noted. Tick each item only after observing the behaviour yourself.

## Setup

- [ ] `npm install && npm run build && npm run start`, open
      `http://localhost:3000` — dashboard loads, "Lazy Lighting Web" heading
      visible, no console errors.
- [ ] Open DevTools → Console, keep it open for the whole session; note any
      errors at the end.

## 1. Projects (dashboard + persistence)

- [ ] Create a new project from the dashboard; it opens in the studio.
- [ ] Rename it from the top toolbar; reload the page — the name persists.
- [ ] Duplicate it from the dashboard; delete the copy; confirm both actions.
- [ ] Export the project as JSON (dashboard or Settings); import it back via
      Settings → the project appears with its surfaces intact.
- [ ] Reload the page with no project open — the demo project seeds ("Demo —
      Halloween Night", 3 surfaces, 2 scenes).

## 2. Surfaces — create, drag, warp

- [ ] Add a rect surface; drag each of the 4 corner handles — the content
      warps live and follows the corners (skew the quad hard: top edge much
      shorter than the bottom).
- [ ] Drag a corner until three corners are (nearly) collinear — the surface
      must not explode to infinity / NaN; it should hold its last good shape.
- [ ] Drag a mid-edge handle — the edge bends (curve −1…1).
- [ ] Add a second surface overlapping the first; change z-order; confirm the
      top one draws on top.
- [ ] Select a surface, change its content to a different visual — only that
      surface changes.
- [ ] Duplicate a surface; delete the original; undo (Ctrl/Cmd+Z) restores it;
      redo re-deletes it.

## 3. Shapes

- [ ] Create each shape from the toolbar: rect, circle, text (type text),
      cube, silhouette, polygon (click vertices, Enter to finish), freehand
      (drag an outline).
- [ ] The polygon/freehand surface clips its content to the drawn outline.
- [ ] Text surface shows the typed text.

## 4. Media — image, video, camera

- [ ] Import a small image (≤ 2 MB) onto a surface; reload the page — the
      image is still there.
- [ ] Import a large image (> 2 MB) onto a surface; reload the page — the
      image is gone and the surface reports it needs re-picking (known
      limitation, not a bug).
- [ ] Import a video (MP4) onto a surface; it loops and plays (muted).
      Reload — the video is gone (session-only, known limitation).
- [ ] Set a surface source to Camera; grant permission — the live camera feed
      fills the warped surface. Deny permission once and confirm the error
      message is human-readable.
- [ ] Import an unsupported file (e.g. `.txt`) — the validator rejects it
      with a clear reason.

## 5. Effects + masks + drawing

- [ ] Apply blur, hue shift, kaleidoscope (segments 6), tile 2×2 — each is
      visible live; set kaleidoscope back to 0/off.
- [ ] Apply a circle mask, then rounded, then cutout — the surface clips
      accordingly.
- [ ] Choose the Image mask kind — confirm it is stored but visibly NOT
      applied (known limitation).
- [ ] Draw tab: draw strokes on a surface, change brush color/size, clear,
      toggle "animate wobble".
- [ ] Blend modes: set additive, multiply, subtract — each changes the look;
      set screen — it falls back to normal (known limitation).

## 6. Generative visuals + depth

- [ ] Cycle through several visuals, including one Halloween and one Christmas
      visual; each animates.
- [ ] Pick a GLSL shader visual — it renders (WebGL). (If one fails on your
      GPU, note which — static validation does not catch GPU compile errors.)
- [ ] Depth mode: upload a photo, set a surface to Depth, move the Depth
      slider — layered parallax slices offset by depth. Confirm the UI labels
      the depth as "Estimated … not AI depth estimation".
- [ ] Import a real grayscale depth map instead — the presets use it.

## 7. Scenes + transitions

- [ ] Create a second scene with visibly different surfaces; switch scenes —
      the stage swaps to the snapshot.
- [ ] Edit a surface while scene B is active, switch to A and back to B —
      the edit is still there (outgoing snapshot).
- [ ] Set transition to fade, 1 s; switch scenes — a smooth opacity ramp.
      Try dissolve and crossfade; try cut (instant).

## 8. Timeline

- [ ] Add an animation track with two scene clips (Scene A 0–10 s, Scene B
      10–20 s); press Play Show — the scene switches automatically at 10 s.
- [ ] Add keyframes (opacity 0 at 0 s, 1 at 10 s) on an animation track;
      scrub the playhead — opacity interpolates smoothly.
- [ ] Split a clip, duplicate a clip, delete a clip; set loop on/off; set a
      custom timeline duration.
- [ ] Attach an audio track (MP3), set trim + volume, play/pause from the
      timeline.

## 9. Audio-reactive + LFO + MIDI

- [ ] Enable the mic, make noise — the audio level meter moves and mapped
      visuals react (e.g. scale pulses with bass).
- [ ] Play an audio file as the source instead of the mic — same reaction.
- [ ] LFO: target opacity, sine, 0.5 Hz — opacity visibly oscillates; switch
      to BPM sync at 120 BPM, 4 beats/cycle — one cycle every 2 s.
- [ ] Envelope: trigger it and watch the attack ramp.
- [ ] **MIDI controller (Chrome only):** connect a controller, map CC 1 →
      opacity, CC 7 → zoom, CC 74 → hue; move the knobs — the parameters
      follow. In Firefox/Safari, confirm the MIDI panel says "not available".

## 10. Tracking (needs a camera)

- [ ] Enable hand tracking; hold a hand up — a palm marker follows it.
      (First enable downloads models from Google storage + WASM from
      jsDelivr — allow a few seconds on first run.)
- [ ] Enable face tracking; move closer/further — face scale reacts.
- [ ] Block network to the CDNs (or disable Wi-Fi after load) and enable
      tracking — the app falls back to motion tracking and labels it as
      such; waving moves the motion centroid.
- [ ] Confirm the UI never claims hand/face tracking while the fallback is
      active.

## 11. Performance mode

- [ ] Toggle performance mode — handles and editing chrome disappear, the
      stage stays live. Toggle it off — editing returns.

## 12. Output window (needs a second display or window)

- [ ] Open Output Window — `/output` opens full-screen, read-only, showing
      the live stage.
- [ ] Change a surface in the studio — the output window updates live.
- [ ] Open `/output` in a *different browser* — it does NOT live-sync
      (same-browser only, known limitation).
- [ ] If a projector/second display is available: drag the output window
      there, fullscreen it, confirm the mapping looks right on the real
      surface.

## 13. Export (needs a real browser)

- [ ] Open Export for a project with 2 scenes and a 60 s timeline.
- [ ] Record 720p / 30 fps, full timeline — wait for it to finish (real-time).
      Download the WebM and play it: scenes switch, transitions play.
- [ ] Record 1080p with the project audio track included — the exported file
      has audio.
- [ ] Try 4K on a capable machine; note any dropped frames. On a slow
      machine, confirm the UI warns that 4K is heavy.
- [ ] Try 60 fps; confirm the actual frame rate (check the file's fps in a
      player) — it may fall back to the display refresh rate.
- [ ] Hide the tab mid-recording — confirm recording stalls/pauses (known
      limitation) and the UI says to keep the tab visible.
- [ ] In Safari: confirm MP4 direct recording is offered. In Chrome: confirm
      only WebM, then use "Convert to MP4 (in-browser)" — first use downloads
      ~31 MB from unpkg; the resulting MP4 plays.
- [ ] Cancel a recording mid-way — nothing is saved, no stale file.

## 14. Regression / polish

- [ ] No decorative (non-functional) controls: click every button in the
      studio and confirm each one does something visible.
- [ ] Resize the window; panels resize; the stage keeps its aspect.
- [ ] Check the whole flow in Firefox (minus MIDI) and Safari (minus MIDI,
      plus MP4 direct recording).
