// Timeline sampling — pure functions, no DOM / store.
import { describe, expect, it } from 'vitest';
import {
  activeAudioClipAt,
  activeClipAt,
  activeSceneClipAt,
  sampleKeyframes,
  timelineTotalDuration,
} from '../timeline';
import type { Timeline } from '../schema';

function makeTimeline(): Timeline {
  return {
    bpm: 120,
    duration: 60,
    loop: true,
    bpmSync: false,
    tracks: [
      {
        id: 'track-anim',
        kind: 'animation',
        name: 'Animation',
        clips: [
          { id: 'clip-a', trackId: 'track-anim', start: 10, duration: 10, label: 'Scene A', sceneId: 'scene-a', speed: 1 },
          { id: 'clip-b', trackId: 'track-anim', start: 30, duration: 10, label: 'Scene B', sceneId: 'scene-b', speed: 1 },
        ],
        keyframes: [
          { id: 'kf-1', time: 0, param: 'opacity', value: 0, surfaceId: 'surf-1' },
          { id: 'kf-2', time: 10, param: 'opacity', value: 1, surfaceId: 'surf-1' },
          { id: 'kf-3', time: 0, param: 'zoom', value: 1 },
          { id: 'kf-4', time: 20, param: 'zoom', value: 3 },
        ],
      },
      {
        id: 'track-audio',
        kind: 'audio',
        name: 'Audio',
        clips: [
          { id: 'clip-audio', trackId: 'track-audio', start: 5, duration: 20, label: 'Track', speed: 1 },
        ],
        keyframes: [],
      },
    ],
  };
}

describe('activeSceneClipAt', () => {
  it('returns the scene clip covering the playhead time', () => {
    const tl = makeTimeline();
    expect(activeSceneClipAt(tl, 15)?.clip.id).toBe('clip-a');
    expect(activeSceneClipAt(tl, 35)?.clip.id).toBe('clip-b');
  });

  it('returns null between clips and at the exact end (end-exclusive)', () => {
    const tl = makeTimeline();
    expect(activeSceneClipAt(tl, 5)).toBeNull();
    expect(activeSceneClipAt(tl, 25)).toBeNull();
    expect(activeSceneClipAt(tl, 20)).toBeNull(); // clip-a ends at 20
    expect(activeSceneClipAt(tl, 40)).toBeNull(); // clip-b ends at 40
  });

  it('is inclusive at the clip start', () => {
    const tl = makeTimeline();
    expect(activeSceneClipAt(tl, 10)?.clip.id).toBe('clip-a');
    expect(activeSceneClipAt(tl, 30)?.clip.id).toBe('clip-b');
  });

  it('returns null for a null timeline', () => {
    expect(activeSceneClipAt(null, 15)).toBeNull();
    expect(activeSceneClipAt(undefined, 15)).toBeNull();
  });
});

describe('activeClipAt / activeAudioClipAt', () => {
  it('finds any clip covering the time, preferring the latest start', () => {
    const tl = makeTimeline();
    // At t=15 both the audio clip (start 5) and clip-a (start 10) cover it.
    expect(activeClipAt(tl, 15)?.clip.id).toBe('clip-a');
    expect(activeClipAt(tl, 7)?.clip.id).toBe('clip-audio');
    expect(activeClipAt(tl, 50)).toBeNull();
  });

  it('finds the audio clip covering the time', () => {
    const tl = makeTimeline();
    expect(activeAudioClipAt(tl, 10)?.clip.id).toBe('clip-audio');
    expect(activeAudioClipAt(tl, 30)).toBeNull();
  });
});

describe('sampleKeyframes', () => {
  it('linearly interpolates between keyframes', () => {
    const tl = makeTimeline();
    const at5 = sampleKeyframes(tl, 5);
    expect(at5.get('surf-1')?.get('opacity')).toBeCloseTo(0.5, 9);
    const at2 = sampleKeyframes(tl, 2);
    expect(at2.get('surf-1')?.get('opacity')).toBeCloseTo(0.2, 9);
  });

  it('clamps to the first/last value outside the keyframe range', () => {
    const tl = makeTimeline();
    expect(sampleKeyframes(tl, 0).get('surf-1')?.get('opacity')).toBe(0);
    expect(sampleKeyframes(tl, 10).get('surf-1')?.get('opacity')).toBe(1);
    expect(sampleKeyframes(tl, 99).get('surf-1')?.get('opacity')).toBe(1);
  });

  it('groups keyframes without a surfaceId under "global"', () => {
    const tl = makeTimeline();
    expect(sampleKeyframes(tl, 10).get('global')?.get('zoom')).toBeCloseTo(2, 9);
    expect(sampleKeyframes(tl, 0).get('global')?.get('zoom')).toBe(1);
    expect(sampleKeyframes(tl, 20).get('global')?.get('zoom')).toBe(3);
  });

  it('returns an empty map for a null timeline or no keyframes', () => {
    expect(sampleKeyframes(null, 5).size).toBe(0);
    const tl = makeTimeline();
    tl.tracks[0].keyframes = [];
    expect(sampleKeyframes(tl, 5).size).toBe(0);
  });
});

describe('timelineTotalDuration', () => {
  it('returns the declared duration when no clip extends past it', () => {
    expect(timelineTotalDuration(makeTimeline())).toBe(60);
  });

  it('extends to the end of the latest clip', () => {
    const tl = makeTimeline();
    tl.tracks[0].clips.push({
      id: 'clip-c', trackId: 'track-anim', start: 70, duration: 5, label: '', speed: 1,
    });
    expect(timelineTotalDuration(tl)).toBe(75);
  });

  it('returns 60 for a null timeline and honours a short declared duration', () => {
    expect(timelineTotalDuration(null)).toBe(60);
    expect(timelineTotalDuration(undefined)).toBe(60);
    const tl = makeTimeline();
    tl.duration = 10;
    tl.tracks = [];
    expect(timelineTotalDuration(tl)).toBe(10);
  });
});
