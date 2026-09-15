import * as THREE from "three";

/**
 * PI-5F2A Asset E proof fixture: a round pedestal side table authored in metres.
 *
 * Visibly distinct from Asset C (rectangular four-leg side table).
 * 1 GLB metre = 1 Vibode metre. No hidden scale.
 */

export const PI5F2_SIDE_TABLE_ASSET_ID =
  "afc-v2-runtime/partners/demo-furniture-co/demo-side-table-v1" as const;

export const PI5F2_SIDE_TABLE_GLB_PUBLIC_PATH =
  "/afc-v2-runtime/partners/demo-furniture-co/demo-side-table-v1.glb" as const;

export const PI5F2_SIDE_TABLE_AUTHORED_WIDTH_M = 0.45;
export const PI5F2_SIDE_TABLE_AUTHORED_HEIGHT_M = 0.55;
export const PI5F2_SIDE_TABLE_AUTHORED_DEPTH_M = 0.45;

const TOP_THICKNESS_M = 0.035;
const BASE_HEIGHT_M = 0.085;
const STEM_HEIGHT_M = PI5F2_SIDE_TABLE_AUTHORED_HEIGHT_M - TOP_THICKNESS_M - BASE_HEIGHT_M;
const TOP_RADIUS_M = PI5F2_SIDE_TABLE_AUTHORED_WIDTH_M / 2;
const BASE_RADIUS_M = 0.16;
const STEM_TOP_RADIUS_M = 0.04;
const STEM_BOTTOM_RADIUS_M = 0.055;
const TOP_COLOR = 0xc45c26;
const STEM_COLOR = 0x8a3d1c;
const BASE_COLOR = 0x3f2a22;
const RADIAL_SEGMENTS = 32;

export function createPi5f2DemoSideTableObject3D(): THREE.Group {
  const top = new THREE.Mesh(
    new THREE.CylinderGeometry(TOP_RADIUS_M, TOP_RADIUS_M, TOP_THICKNESS_M, RADIAL_SEGMENTS),
    new THREE.MeshStandardMaterial({
      color: TOP_COLOR,
      metalness: 0.1,
      roughness: 0.48,
    }),
  );
  top.name = "top";
  top.position.set(
    0,
    BASE_HEIGHT_M + STEM_HEIGHT_M + TOP_THICKNESS_M / 2,
    0,
  );

  const stem = new THREE.Mesh(
    new THREE.CylinderGeometry(
      STEM_TOP_RADIUS_M,
      STEM_BOTTOM_RADIUS_M,
      STEM_HEIGHT_M,
      RADIAL_SEGMENTS,
    ),
    new THREE.MeshStandardMaterial({
      color: STEM_COLOR,
      metalness: 0.12,
      roughness: 0.55,
    }),
  );
  stem.name = "stem";
  stem.position.set(0, BASE_HEIGHT_M + STEM_HEIGHT_M / 2, 0);

  const base = new THREE.Mesh(
    new THREE.CylinderGeometry(BASE_RADIUS_M, BASE_RADIUS_M, BASE_HEIGHT_M, RADIAL_SEGMENTS),
    new THREE.MeshStandardMaterial({
      color: BASE_COLOR,
      metalness: 0.08,
      roughness: 0.7,
    }),
  );
  base.name = "base";
  base.position.set(0, BASE_HEIGHT_M / 2, 0);

  const root = new THREE.Group();
  root.name = "pi5f2DemoSideTable";
  root.add(base);
  root.add(stem);
  root.add(top);
  return root;
}
