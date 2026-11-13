// Timeline sampling — Phase 5 (pure functions, no DOM / store).
// The render loop calls these each frame with the playhead time:
//   - activeSceneClipAt(): which scene clip covers `time` (drives scene switches),
//   - sampleKeyframes(): linearly interpolated { param: value } per surface,
//   - timelineTotalDuration(): playhead wrap/stop point.
import type { Timeline, TimelineClip, TimelineTrack } from './schema';

export function timelineTotalDuration(timeline: Timeline | null | undefined): number {
  if (!timeline) return 60;
  const clipEnd = (timeline.tracks ?? []).reduce(
    (m, t) => Math.max(m, ...t.clips.map((c) => c.start + c.duration)),
    0,
  );
  return Math.max(timeline.duration ?? 60, clipEnd);
}

/** The clip on any track that covers `time`, preferring the latest start. */
export function activeClipAt(timeline: Timeline | null | undefined, time: number): { track: TimelineTrack; clip: TimelineClip } | null {
  if (!timeline) return null;
  let best: { track: TimelineTrack; clip: TimelineClip } | null = null;
  for (const track of timeline.tracks ?? []) {
    for (const clip of track.clips) {
      if (time >= clip.start && time < clip.start + clip.duration) {
        if (!best || clip.start > best.clip.start) best = { track, clip };
      }
    }
  }
  return best;
}

/** The scene clip covering `time`, if any (animation-track clips carry sceneId). */
export function activeSceneClipAt(
  timeline: Timeline | null | undefined,
  time: number,
): { track: TimelineTrack; clip: TimelineClip } | null {
  const found = activeClipAt(timeline, time);
  if (found && found.clip.sceneId) return found;
  // Scene clips may live on any track; scan all tracks for a scene clip covering time.
  if (!timeline) return null;
  let best: { track: TimelineTrack; clip: TimelineClip } | null = null;
  for (const track of timeline.tracks ?? []) {
    for (const clip of track.clips) {
      if (!clip.sceneId) continue;
      if (time >= clip.start && time < clip.start + clip.duration) {
        if (!best || clip.start > best.clip.start) best = { track, clip };
      }
    }
  }
  return best;
}

/**
 * Sample keyframes at `time` with linear interpolation.
 * Returns per-surface param values: Map<surfaceId | 'global', Map<param, value>>.
 * Keyframes without a surfaceId are 'global' (apply to the selected surface
 * at render time). Supported params: opacity, scale, brightness, speed,
 * rotation, hue, zoom, density, effectIntensity.
 */
export function sampleKeyframes(
  timeline: Timeline | null | undefined,
  time: number,
): Map<string, Map<string, number>> {
  const out = new Map<string, Map<string, number>>();
  if (!timeline) return out;
  for (const track of timeline.tracks ?? []) {
    if (track.kind !== 'animation' && track.kind !== 'effect') continue;
    const kfs = [...(track.keyframes ?? [])].sort((a, b) => a.time - b.time);
    // Group by (surfaceId, param).
    const groups = new Map<string, { param: string; surfaceId: string; points: { time: number; value: number }[] }>();
    for (const k of kfs) {
      const surfaceId = k.surfaceId ?? 'global';
      const key = `${surfaceId}:${k.param}`;
      const g = groups.get(key) ?? { param: k.param, surfaceId, points: [] };
      g.points.push({ time: k.time, value: k.value });
      groups.set(key, g);
    }
    for (const g of groups.values()) {
      const pts = g.points;
      let value: number;
      if (time <= pts[0].time) value = pts[0].value;
      else if (time >= pts[pts.length - 1].time) value = pts[pts.length - 1].value;
      else {
        let i = 0;
        while (i < pts.length - 1 && pts[i + 1].time <= time) i++;
        const a = pts[i];
        const b = pts[i + 1];
        const f = b.time === a.time ? 0 : (time - a.time) / (b.time - a.time);
        value = a.value + (b.value - a.value) * f;
      }
      const perSurface = out.get(g.surfaceId) ?? new Map<string, number>();
      perSurface.set(g.param, value);
      out.set(g.surfaceId, perSurface);
    }
  }
  return out;
}

/** Audio clip (if any) covering `time` — its mediaId drives the track player. */
export function activeAudioClipAt(
  timeline: Timeline | null | undefined,
  time: number,
): { track: TimelineTrack; clip: TimelineClip } | null {
  if (!timeline) return null;
  for (const track of timeline.tracks ?? []) {
    if (track.kind !== 'audio') continue;
    for (const clip of track.clips) {
      if (time >= clip.start && time < clip.start + clip.duration) return { track, clip };
    }
  }
  return null;
}
