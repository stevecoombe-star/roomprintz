import * as THREE from "three";

/**
 * Consumer furniture chrome. These values are screen-space, not scene data.
 * Width is CSS pixels; the pass scales it by the renderer pixel ratio.
 */
export const STAGE_OUTLINE_WIDTH_PX = 10;
/** Device-pixel sample radius. Covers the CSS width at the viewer's max pixel ratio of 2. */
export const STAGE_OUTLINE_KERNEL_RADIUS = 20;
export const STAGE_OUTLINE_HOVER_OPACITY = 0.6;
export const STAGE_OUTLINE_SELECTED_OPACITY = 0.92;
/** Custom property painted by the main editor viewport frame in app/globals.css. */
export const VIBODE_VIEWPORT_FRAME_VAR = "--vibode-viewport-frame";
/**
 * Share of white mixed into the viewport-frame blue for hover.
 * Selected uses the frame color unchanged.
 */
export const STAGE_OUTLINE_HOVER_WHITE_MIX = 0.75;

export type StageOutlineRole = "hover" | "selected";

export type StageOutlineTarget = Readonly<{
  objectId: string;
  role: StageOutlineRole;
}>;

export type StageOutlineStyle = Readonly<{
  widthPx: number;
  opacity: number;
  color: string;
}>;

function channelHex(value: number): string {
  return Math.round(value).toString(16).padStart(2, "0").toUpperCase();
}

/** Accepts the hex or rgb() form the viewport-frame token can compute to. */
export function normalizeCssColorToHex(value: string): string | null {
  const text = value.trim();
  const hex = /^#([0-9a-fA-F]{6})$/.exec(text);
  if (hex) return `#${hex[1].toUpperCase()}`;
  const short = /^#([0-9a-fA-F]{3})$/.exec(text);
  if (short) {
    const [red, green, blue] = short[1].toUpperCase().split("");
    return `#${red}${red}${green}${green}${blue}${blue}`;
  }
  const rgb = /^rgba?\(\s*([0-9.]+)\s*[, ]\s*([0-9.]+)\s*[, ]\s*([0-9.]+)/i.exec(text);
  if (!rgb) return null;
  const channels = [rgb[1], rgb[2], rgb[3]].map((part) => Number(part));
  if (channels.some((channel) => !Number.isFinite(channel) || channel < 0 || channel > 255)) {
    return null;
  }
  return `#${channels.map((channel) => channelHex(channel)).join("")}`;
}

export function stageOutlineHoverColor(frameColor: string): string {
  const hex = normalizeCssColorToHex(frameColor);
  if (!hex) throw new Error("viewport frame color is not a hex or rgb color");
  const mix = STAGE_OUTLINE_HOVER_WHITE_MIX;
  const channel = (start: number) => {
    const value = Number.parseInt(hex.slice(start, start + 2), 16);
    return Math.round(value * (1 - mix) + 255 * mix);
  };
  return `#${channelHex(channel(1))}${channelHex(channel(3))}${channelHex(channel(5))}`;
}

export function readVibodeViewportFrameColor(
  read: () => string = () => getComputedStyle(document.documentElement)
    .getPropertyValue(VIBODE_VIEWPORT_FRAME_VAR),
): string {
  const hex = normalizeCssColorToHex(read());
  if (!hex) throw new Error(`${VIBODE_VIEWPORT_FRAME_VAR} is unavailable`);
  return hex;
}

export function stageOutlineStyle(
  role: StageOutlineRole,
  frameColor: string,
): StageOutlineStyle {
  const selected = normalizeCssColorToHex(frameColor);
  if (!selected) throw new Error("viewport frame color is not a hex or rgb color");
  return {
    widthPx: STAGE_OUTLINE_WIDTH_PX,
    opacity: role === "selected"
      ? STAGE_OUTLINE_SELECTED_OPACITY
      : STAGE_OUTLINE_HOVER_OPACITY,
    color: role === "selected" ? selected : stageOutlineHoverColor(selected),
  };
}

/** Device-pixel blur radius for a shared CSS width. Role does not change it. */
export function stageOutlineDeviceRadius(widthPx: number, pixelRatio: number): number {
  return Math.min(
    STAGE_OUTLINE_KERNEL_RADIUS,
    widthPx * Math.max(1, pixelRatio),
  );
}

/**
 * Selected styling wins for the same object. A different hovered object keeps
 * its own dim outline. Neither id produces no outline.
 */
export function stageOutlineTargets(input: Readonly<{
  selectedObjectId: string | null;
  hoveredObjectId: string | null;
}>): readonly StageOutlineTarget[] {
  const targets: StageOutlineTarget[] = [];
  if (input.selectedObjectId) {
    targets.push({ objectId: input.selectedObjectId, role: "selected" });
  }
  if (
    input.hoveredObjectId
    && input.hoveredObjectId !== input.selectedObjectId
  ) {
    targets.push({ objectId: input.hoveredObjectId, role: "hover" });
  }
  return targets;
}

export type StageOutlineDrawTarget = Readonly<{
  object: THREE.Object3D;
  role: StageOutlineRole;
}>;

const MASK_VERTEX = `
  void main() {
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const MASK_FRAGMENT = `
  void main() {
    gl_FragColor = vec4(1.0, 1.0, 1.0, 1.0);
  }
`;

const COMPOSITE_VERTEX = `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = vec4(position.xy, 0.0, 1.0);
  }
`;

const BLUR_FRAGMENT = `
  uniform sampler2D source;
  uniform sampler2D coverage;
  uniform vec2 direction;
  uniform vec3 color;
  uniform float opacity;
  uniform float radius;
  uniform float composite;
  varying vec2 vUv;

  void main() {
    float accum = 0.0;
    float weight = 0.0;
    for (int i = 0; i < ${STAGE_OUTLINE_KERNEL_RADIUS * 2 + 1}; i++) {
      float offset = float(i - ${STAGE_OUTLINE_KERNEL_RADIUS});
      float dist = abs(offset);
      float sampleWeight = dist > radius ? 0.0 : 1.0 - dist / max(radius, 0.001);
      float sampleAlpha = texture2D(source, vUv + direction * offset).a;
      accum += sampleAlpha * sampleWeight;
      weight += sampleWeight;
    }
    float blur = weight > 0.0 ? accum / weight : 0.0;
    if (composite < 0.5) {
      gl_FragColor = vec4(blur, blur, blur, blur);
      return;
    }
    float center = texture2D(coverage, vUv).a;
    float glow = smoothstep(0.04, 0.55, blur) * (1.0 - center);
    float alpha = glow * opacity;
    gl_FragColor = vec4(color * alpha, alpha);
  }
`;

/**
 * One mask render of the hovered or selected object, then one fullscreen
 * silhouette composite. The mask does not include the rest of the scene, so
 * the contour stays visible through other furniture. The ring is the alpha
 * boundary of that mask, not the mesh's hard edges.
 */
export function createStageSelectionOutlinePass() {
  const frameColor = readVibodeViewportFrameColor();
  const maskTarget = new THREE.WebGLRenderTarget(1, 1, {
    depthBuffer: true,
    stencilBuffer: false,
    magFilter: THREE.LinearFilter,
    minFilter: THREE.LinearFilter,
    format: THREE.RGBAFormat,
    type: THREE.UnsignedByteType,
  });
  maskTarget.texture.generateMipmaps = false;

  const maskMaterial = new THREE.ShaderMaterial({
    vertexShader: MASK_VERTEX,
    fragmentShader: MASK_FRAGMENT,
    side: THREE.DoubleSide,
    depthTest: true,
    depthWrite: true,
    toneMapped: false,
  });

  const blurTarget = maskTarget.clone();
  const color = new THREE.Color(frameColor);
  const direction = new THREE.Vector2(1, 0);
  const compositeMaterial = new THREE.ShaderMaterial({
    uniforms: {
      source: { value: maskTarget.texture },
      coverage: { value: maskTarget.texture },
      direction: { value: direction },
      color: { value: color },
      opacity: { value: STAGE_OUTLINE_SELECTED_OPACITY },
      radius: { value: STAGE_OUTLINE_WIDTH_PX },
      composite: { value: 0 },
    },
    vertexShader: COMPOSITE_VERTEX,
    fragmentShader: BLUR_FRAGMENT,
    transparent: true,
    depthTest: false,
    depthWrite: false,
    toneMapped: false,
    premultipliedAlpha: true,
  });
  const compositeCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  const compositeGeometry = new THREE.PlaneGeometry(2, 2);
  const compositeQuad = new THREE.Mesh(compositeGeometry, compositeMaterial);
  const compositeScene = new THREE.Scene();
  compositeScene.add(compositeQuad);

  const drawingSize = new THREE.Vector2();
  const savedClear = new THREE.Color();
  let disposed = false;

  const ensureSize = (renderer: THREE.WebGLRenderer) => {
    renderer.getDrawingBufferSize(drawingSize);
    const width = Math.max(1, drawingSize.x);
    const height = Math.max(1, drawingSize.y);
    if (maskTarget.width !== width || maskTarget.height !== height) {
      maskTarget.setSize(width, height);
      blurTarget.setSize(width, height);
    }
  };

  const renderMask = (
    renderer: THREE.WebGLRenderer,
    camera: THREE.Camera,
    object: THREE.Object3D,
  ) => {
    const replaced: { mesh: THREE.Mesh; material: THREE.Material | THREE.Material[] }[] = [];
    object.updateWorldMatrix(true, true);
    object.traverse((child) => {
      if (!(child instanceof THREE.Mesh) || !child.visible) return;
      replaced.push({ mesh: child, material: child.material });
      child.material = maskMaterial;
    });
    renderer.getClearColor(savedClear);
    const savedAlpha = renderer.getClearAlpha();
    renderer.setRenderTarget(maskTarget);
    renderer.setClearColor(0x000000, 0);
    renderer.clear(true, true, false);
    try {
      if (replaced.length > 0) renderer.render(object, camera);
    } finally {
      for (const entry of replaced) entry.mesh.material = entry.material;
      renderer.setClearColor(savedClear, savedAlpha);
    }
  };

  return {
    render(
      renderer: THREE.WebGLRenderer,
      camera: THREE.Camera,
      targets: readonly StageOutlineDrawTarget[],
    ) {
      if (disposed || targets.length === 0) return;
      ensureSize(renderer);
      const pixelRatio = renderer.getPixelRatio();
      const previousTarget = renderer.getRenderTarget();
      const previousAutoClear = renderer.autoClear;
      try {
        for (const target of targets) {
          renderMask(renderer, camera, target.object);
          const uniforms = compositeMaterial.uniforms;
          const style = stageOutlineStyle(target.role, frameColor);
          (uniforms.color.value as THREE.Color).set(style.color);
          uniforms.opacity.value = style.opacity;
          uniforms.radius.value = stageOutlineDeviceRadius(style.widthPx, pixelRatio);
          uniforms.composite.value = 0;
          uniforms.source.value = maskTarget.texture;
          direction.set(1 / maskTarget.width, 0);
          renderer.setRenderTarget(blurTarget);
          renderer.autoClear = true;
          renderer.render(compositeScene, compositeCamera);
          uniforms.composite.value = 1;
          uniforms.source.value = blurTarget.texture;
          direction.set(0, 1 / maskTarget.height);
          renderer.setRenderTarget(null);
          renderer.autoClear = false;
          renderer.render(compositeScene, compositeCamera);
        }
      } finally {
        renderer.autoClear = previousAutoClear;
        renderer.setRenderTarget(previousTarget);
      }
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      maskTarget.dispose();
      blurTarget.dispose();
      maskMaterial.dispose();
      compositeMaterial.dispose();
      compositeGeometry.dispose();
    },
  };
}
