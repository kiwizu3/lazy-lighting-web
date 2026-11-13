// Shared offscreen shader renderer for the stage (Phase 5).
// ONE WebGL context, programs cached per shader id (no recompile when
// switching between surfaces), rendering into a reusable offscreen canvas
// that sources.ts draws into each surface's content canvas. This is
// deliberately separate from ShaderPreview (which owns a visible canvas
// for the library panel).
import { compileShader, getShaderVisual, hexToRgb, type ShaderParams, type ShaderVisual } from '../shaders';

interface CachedProgram {
  program: WebGLProgram;
  uniforms: Record<string, WebGLUniformLocation | null>;
}

const UNIFORM_NAMES = [
  'u_time', 'u_res', 'u_audio', 'u_color1', 'u_color2', 'u_speed',
  'u_scale', 'u_intensity', 'u_density', 'u_rotation', 'u_distortion',
] as const;

export class ShaderStageRenderer {
  private canvas: HTMLCanvasElement;
  private gl: WebGLRenderingContext | null = null;
  private buffer: WebGLBuffer | null = null;
  private programs = new Map<string, CachedProgram>();
  private failed = new Set<string>();

  constructor(width = 480, height = 270) {
    this.canvas = document.createElement('canvas');
    this.canvas.width = width;
    this.canvas.height = height;
    const gl = this.canvas.getContext('webgl', { preserveDrawingBuffer: true });
    if (gl) {
      this.gl = gl;
      this.buffer = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, this.buffer);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    }
  }

  get available(): boolean {
    return this.gl !== null;
  }

  get outputCanvas(): HTMLCanvasElement {
    return this.canvas;
  }

  private programFor(visual: ShaderVisual): CachedProgram | null {
    const gl = this.gl;
    if (!gl) return null;
    const cached = this.programs.get(visual.id);
    if (cached) return cached;
    if (this.failed.has(visual.id)) return null;
    const result = compileShader(gl, visual.fragment);
    if (result.error || !result.program) {
      console.warn('[shaderStage] compile failed for', visual.id, result.error);
      this.failed.add(visual.id);
      return null;
    }
    const uniforms: Record<string, WebGLUniformLocation | null> = {};
    for (const name of UNIFORM_NAMES) uniforms[name] = gl.getUniformLocation(result.program, name);
    const entry = { program: result.program, uniforms };
    this.programs.set(visual.id, entry);
    return entry;
  }

  /**
   * Render a shader visual into the shared offscreen canvas. Returns the
   * canvas on success, null when WebGL or the shader is unavailable
   * (callers fall back to the classic visual path).
   */
  render(visualId: string, params: ShaderParams, time: number, audioLevel = 0): HTMLCanvasElement | null {
    const gl = this.gl;
    const visual = getShaderVisual(visualId);
    if (!gl || !visual || !this.buffer) return null;
    const prog = this.programFor(visual);
    if (!prog) return null;
    const w = this.canvas.width;
    const h = this.canvas.height;
    gl.viewport(0, 0, w, h);
    gl.useProgram(prog.program);
    const loc = (name: string) => prog.uniforms[name] ?? null;
    gl.uniform1f(loc('u_time'), time);
    gl.uniform2f(loc('u_res'), w, h);
    gl.uniform1f(loc('u_audio'), audioLevel);
    const [r1, g1, b1] = hexToRgb(params.color1);
    const [r2, g2, b2] = hexToRgb(params.color2);
    gl.uniform3f(loc('u_color1'), r1, g1, b1);
    gl.uniform3f(loc('u_color2'), r2, g2, b2);
    gl.uniform1f(loc('u_speed'), params.speed);
    gl.uniform1f(loc('u_scale'), params.scale);
    gl.uniform1f(loc('u_intensity'), params.intensity);
    gl.uniform1f(loc('u_density'), params.density);
    gl.uniform1f(loc('u_rotation'), params.rotation);
    gl.uniform1f(loc('u_distortion'), params.distortion);
    const pos = gl.getAttribLocation(prog.program, 'a_position');
    gl.bindBuffer(gl.ARRAY_BUFFER, this.buffer);
    gl.enableVertexAttribArray(pos);
    gl.vertexAttribPointer(pos, 2, gl.FLOAT, false, 0, 0);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    return this.canvas;
  }

  dispose(): void {
    const gl = this.gl;
    if (gl) {
      for (const p of this.programs.values()) gl.deleteProgram(p.program);
      if (this.buffer) gl.deleteBuffer(this.buffer);
    }
    this.programs.clear();
    this.buffer = null;
    this.gl = null;
  }
}
