// Minimal ambient types for `three` (r187).
// The three package ships no TypeScript declarations and @types/three is not
// installed (and no new packages may be installed in this phase), so this
// file declares just the API surface the Phase 2 engine uses. It is
// intentionally loose (any-typed where the exact signature does not matter
// for the engine) — tighten it if the engine grows past this surface.
declare module 'three' {
  export const NormalBlending: number;
  export const AdditiveBlending: number;
  export const SubtractiveBlending: number;
  export const MultiplyBlending: number;
  export const CustomBlending: number;
  export const FrontSide: number;
  export const DoubleSide: number;
  export const BackSide: number;
  export const LinearFilter: number;
  export const ClampToEdgeWrapping: number;
  export const RepeatWrapping: number;
  export const SRGBColorSpace: any;
  export const NoColorSpace: any;

  export class Vector2 {
    constructor(x?: number, y?: number);
    x: number;
    y: number;
    set(x: number, y: number): this;
  }
  export class Vector3 {
    constructor(x?: number, y?: number, z?: number);
    x: number;
    y: number;
    z: number;
    set(x: number, y: number, z: number): this;
  }
  export class Color {
    constructor(color?: any);
    set(value: any): this;
  }
  export class BufferAttribute {
    constructor(array: any, itemSize: number);
    array: any;
    count: number;
    needsUpdate: boolean;
    getX(i: number): number;
    getY(i: number): number;
    getZ(i: number): number;
    setXYZ(i: number, x: number, y: number, z: number): void;
    setXY(i: number, x: number, y: number): void;
  }
  export class BufferGeometry {
    attributes: Record<string, BufferAttribute>;
    setAttribute(name: string, attr: BufferAttribute): this;
    getAttribute(name: string): BufferAttribute;
    setIndex(index: any): this;
    computeVertexNormals(): void;
    dispose(): void;
  }
  export class PlaneGeometry extends BufferGeometry {
    constructor(width?: number, height?: number, widthSegments?: number, heightSegments?: number);
  }
  export class CircleGeometry extends BufferGeometry {
    constructor(radius?: number, segments?: number);
  }
  export class BoxGeometry extends BufferGeometry {
    constructor(width?: number, height?: number, depth?: number);
  }
  export class Shape {
    constructor(points?: Vector2[]);
    moveTo(x: number, y: number): this;
    lineTo(x: number, y: number): this;
    absarc(x: number, y: number, radius: number, startAngle: number, endAngle: number, clockwise?: boolean): this;
    closePath(): this;
  }
  export class ShapeGeometry extends BufferGeometry {
    constructor(shape: Shape, curveSegments?: number);
  }
  export class Material {
    transparent: boolean;
    opacity: number;
    blending: number;
    depthWrite: boolean;
    depthTest: boolean;
    side: number;
    visible: boolean;
    needsUpdate: boolean;
    dispose(): void;
  }
  export class MeshBasicMaterial extends Material {
    constructor(parameters?: any);
    color: Color;
  }
  export class ShaderMaterial extends Material {
    constructor(parameters?: any);
    uniforms: Record<string, { value: any }>;
  }
  export class Texture {
    constructor(image?: any);
    image: any;
    needsUpdate: boolean;
    colorSpace: any;
    minFilter: number;
    magFilter: number;
    wrapS: number;
    wrapT: number;
    dispose(): void;
  }
  export class CanvasTexture extends Texture {
    constructor(canvas: HTMLCanvasElement);
  }
  export class VideoTexture extends Texture {
    constructor(video: HTMLVideoElement);
  }
  export class Object3D {
    position: Vector3;
    rotation: any;
    scale: Vector3;
    visible: boolean;
    renderOrder: number;
    children: Object3D[];
    parent: Object3D | null;
    add(...objects: Object3D[]): this;
    remove(...objects: Object3D[]): this;
    traverse(callback: (obj: any) => void): void;
  }
  export class Mesh extends Object3D {
    constructor(geometry?: BufferGeometry, material?: Material | Material[]);
    geometry: BufferGeometry;
    material: Material | Material[];
  }
  export class Group extends Object3D {}
  export class Scene extends Object3D {
    background: any;
  }
  export class Camera extends Object3D {}
  export class OrthographicCamera extends Camera {
    constructor(left: number, right: number, top: number, bottom: number, near: number, far: number);
    left: number;
    right: number;
    top: number;
    bottom: number;
    updateProjectionMatrix(): void;
  }
  export class WebGLRenderer {
    constructor(parameters?: any);
    domElement: HTMLCanvasElement;
    setSize(width: number, height: number, updateStyle?: boolean): void;
    setPixelRatio(value: number): void;
    setClearColor(color: any, alpha?: number): void;
    render(scene: Scene, camera: Camera): void;
    dispose(): void;
    getContext(): WebGLRenderingContext;
    forceContextRestore(): void;
  }
}
