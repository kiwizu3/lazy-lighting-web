// Projector setup — Phase 5.
// Guided setup: connect the projector (via the OS — the browser cannot
// control hardware), open the output window, move it to the projector
// display, fullscreen, align with test patterns, start playback.
// Test patterns are sent to the output window over the BroadcastChannel
// (and as a ?pattern= query param when opening it fresh). Output
// resolution/aspect is stored on the project settings and applied to the
// stage and the output window.
'use client';
import { useState } from 'react';
import { useStudioStore } from '../lib/store';
import { Button } from './ui/button';

export type TestPattern = 'none' | 'grid' | 'checkerboard' | 'corners' | 'red' | 'green' | 'blue' | 'white';

export const TEST_PATTERNS: { id: TestPattern; label: string }[] = [
  { id: 'none', label: 'None (normal output)' },
  { id: 'grid', label: 'Alignment grid' },
  { id: 'checkerboard', label: 'Checkerboard' },
  { id: 'corners', label: 'Corner markers' },
  { id: 'red', label: 'Solid red' },
  { id: 'green', label: 'Solid green' },
  { id: 'blue', label: 'Solid blue' },
  { id: 'white', label: 'Solid white' },
];

export function sendTestPattern(pattern: TestPattern): void {
  try {
    const bc = new BroadcastChannel('lazy-lighting-output');
    bc.postMessage({ type: 'pattern', pattern });
    bc.close();
  } catch {
    /* BroadcastChannel unavailable — the ?pattern= URL param is the fallback */
  }
}

const ASPECTS = ['16:9', '4:3', '21:9', 'custom'] as const;

export default function ProjectorSetup({ onClose }: { onClose?: () => void }) {
  const project = useStudioStore((s) => s.project);
  const [pattern, setPattern] = useState<TestPattern>('grid');
  const [step, setStep] = useState(1);
  const aspect = project?.settings.aspect ?? '16:9';
  const customW = project?.settings.customAspectWidth ?? 16;
  const customH = project?.settings.customAspectHeight ?? 9;

  const store = useStudioStore.getState();

  const openOutput = (withPattern: boolean) => {
    const url = withPattern && pattern !== 'none' ? `/output?pattern=${pattern}` : '/output';
    window.open(url, '_blank', 'noopener');
  };

  const steps: { title: string; body: string; action?: React.ReactNode }[] = [
    {
      title: '1 · Connect the projector',
      body: 'Plug the projector in over HDMI or USB-C, or connect it via AirPlay / Miracast from your operating system. The browser cannot detect or control projector hardware — use your OS display settings to confirm the projector shows up as a second display.',
    },
    {
      title: '2 · Open the output window',
      body: 'Open the output window in a new browser window. It mirrors the studio stage over a BroadcastChannel (same browser, any window).',
      action: (
        <Button size="sm" variant="outline" onClick={() => { openOutput(false); setStep(3); }}>
          Open output window ↗
        </Button>
      ),
    },
    {
      title: '3 · Move it to the projector display',
      body: 'Drag the output window onto the projector display (your OS decides which display is which — the browser cannot move a window between displays itself).',
    },
    {
      title: '4 · Fullscreen it',
      body: 'In the output window, press F or click its fullscreen control so the stage fills the projector with no browser chrome.',
    },
    {
      title: '5 · Align with test patterns',
      body: 'Show a test pattern on the output and adjust the projector (keystone, zoom, position) until the pattern fills the surface. Pick a pattern, then send it to the output window — or open a fresh output window already showing it.',
      action: (
        <div className="flex flex-wrap items-center gap-2">
          <select
            value={pattern}
            onChange={(e) => setPattern(e.target.value as TestPattern)}
            className="rounded border border-zinc-700 bg-zinc-900 px-2 py-1 text-xs text-zinc-100"
            aria-label="Test pattern"
          >
            {TEST_PATTERNS.map((p) => (
              <option key={p.id} value={p.id}>{p.label}</option>
            ))}
          </select>
          <Button size="sm" variant="outline" onClick={() => sendTestPattern(pattern)}>
            Send pattern to output
          </Button>
          <Button size="sm" variant="outline" onClick={() => openOutput(true)}>
            Open output with pattern ↗
          </Button>
        </div>
      ),
    },
    {
      title: '6 · Start playback',
      body: 'Back in the studio, press Play (Space). Scenes, timeline and audio follow the playhead; the output window mirrors them live.',
      action: (
        <Button
          size="sm"
          onClick={() => {
            store.setPlaying(true);
            onClose?.();
          }}
        >
          ▶ Start playback
        </Button>
      ),
    },
  ];

  return (
    <div className="space-y-3 text-zinc-100">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold">Projector setup</h2>
        {onClose && (
          <button type="button" onClick={onClose} className="text-xs text-zinc-400 underline" aria-label="Close projector setup">
            Close ✕
          </button>
        )}
      </div>

      <section className="rounded border border-zinc-800 p-3">
        <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-zinc-400">Output aspect</h3>
        <div className="flex flex-wrap items-center gap-2">
          {ASPECTS.map((a) => (
            <button
              key={a}
              type="button"
              onClick={() => store.setAspect(a)}
              className={`rounded border px-2.5 py-1 text-xs ${aspect === a ? 'border-amber-400 bg-amber-500/20 text-amber-200' : 'border-zinc-700 text-zinc-200 hover:border-zinc-500'}`}
            >
              {a}
            </button>
          ))}
          {aspect === 'custom' && (
            <span className="flex items-center gap-1 text-xs text-zinc-300">
              <input
                type="number"
                min={1}
                value={customW}
                onChange={(e) => store.setAspect('custom', Number(e.target.value) || 16, customH)}
                className="w-14 rounded border border-zinc-700 bg-zinc-900 px-1 py-0.5 text-xs text-zinc-100"
                aria-label="Custom aspect width"
              />
              :
              <input
                type="number"
                min={1}
                value={customH}
                onChange={(e) => store.setAspect('custom', customW, Number(e.target.value) || 9)}
                className="w-14 rounded border border-zinc-700 bg-zinc-900 px-1 py-0.5 text-xs text-zinc-100"
                aria-label="Custom aspect height"
              />
            </span>
          )}
        </div>
        <p className="mt-1 text-[11px] text-zinc-500">
          Sets the stage and output window aspect ratio ({aspect === 'custom' ? `${customW}:${customH}` : aspect}).
        </p>
      </section>

      <ol className="space-y-2">
        {steps.map((s, i) => (
          <li key={s.title} className={`rounded border p-3 ${step === i + 1 ? 'border-amber-500/60 bg-amber-500/5' : 'border-zinc-800'}`}>
            <button type="button" className="w-full text-left" onClick={() => setStep(i + 1)}>
              <span className="text-sm font-medium text-zinc-100">{s.title}</span>
            </button>
            {step === i + 1 && (
              <div className="mt-1.5 space-y-2">
                <p className="text-xs leading-relaxed text-zinc-400">{s.body}</p>
                {s.action}
                {i < steps.length - 1 && (
                  <div>
                    <Button size="sm" variant="ghost" onClick={() => setStep(i + 2)}>
                      Next step ↓
                    </Button>
                  </div>
                )}
              </div>
            )}
          </li>
        ))}
      </ol>

      <p className="text-[11px] leading-snug text-zinc-500">
        Honest limits: a browser cannot guarantee native external-display routing, cannot keep
        playback running after the browser is closed, and cannot control projector hardware
        (keystone, focus, input source) — those are OS / projector-remote jobs.
      </p>
    </div>
  );
}
