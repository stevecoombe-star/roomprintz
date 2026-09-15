import * as THREE from "three";

/**
 * PI-5F2A Asset D proof fixture: a low, wide coffee table authored in metres.
 *
 * Distinct from the certified sofa, lounge chair, and rectangular side table C.
 * 1 GLB metre = 1 Vibode metre. No hidden scale.
 */

export const PI5F2_COFFEE_TABLE_ASSET_ID =
  "afc-v2-runtime/partners/demo-furniture-co/demo-coffee-table-v1" as const;

export const PI5F2_COFFEE_TABLE_GLB_PUBLIC_PATH =
  "/afc-v2-runtime/partners/demo-furniture-co/demo-coffee-table-v1.glb" as const;

export const PI5F2_COFFEE_TABLE_AUTHORED_WIDTH_M = 1.2;
export const PI5F2_COFFEE_TABLE_AUTHORED_HEIGHT_M = 0.4;
export const PI5F2_COFFEE_TABLE_AUTHORED_DEPTH_M = 0.6;

const TOP_THICKNESS_M = 0.05;
const APRON_HEIGHT_M = 0.04;
const LEG_SIZE_M = 0.05;
const SHELF_THICKNESS_M = 0.025;
const SHELF_HEIGHT_M = 0.09;
const TOP_COLOR = 0x5c3317;
const LEG_COLOR = 0x2b1b12;
const SHELF_COLOR = 0x7a4a28;

export function createPi5f2DemoCoffeeTableObject3D(): THREE.Group {
  const top = new THREE.Mesh(
    new THREE.BoxGeometry(
      PI5F2_COFFEE_TABLE_AUTHORED_WIDTH_M,
      TOP_THICKNESS_M,
      PI5F2_COFFEE_TABLE_AUTHORED_DEPTH_M,
    ),
    new THREE.MeshStandardMaterial({
      color: TOP_COLOR,
      metalness: 0.06,
      roughness: 0.62,
    }),
  );
  top.name = "top";
  top.position.set(
    0,
    PI5F2_COFFEE_TABLE_AUTHORED_HEIGHT_M - TOP_THICKNESS_M / 2,
    0,
  );

  const apron = new THREE.Mesh(
    new THREE.BoxGeometry(
      PI5F2_COFFEE_TABLE_AUTHORED_WIDTH_M - 0.04,
      APRON_HEIGHT_M,
      PI5F2_COFFEE_TABLE_AUTHORED_DEPTH_M - 0.04,
    ),
    new THREE.MeshStandardMaterial({
      color: LEG_COLOR,
      metalness: 0.04,
      roughness: 0.7,
    }),
  );
  apron.name = "apron";
  apron.position.set(
    0,
    PI5F2_COFFEE_TABLE_AUTHORED_HEIGHT_M - TOP_THICKNESS_M - APRON_HEIGHT_M / 2,
    0,
  );

  const shelf = new THREE.Mesh(
    new THREE.BoxGeometry(
      PI5F2_COFFEE_TABLE_AUTHORED_WIDTH_M - 0.16,
      SHELF_THICKNESS_M,
      PI5F2_COFFEE_TABLE_AUTHORED_DEPTH_M - 0.16,
    ),
    new THREE.MeshStandardMaterial({
      color: SHELF_COLOR,
      metalness: 0.05,
      roughness: 0.68,
    }),
  );
  shelf.name = "shelf";
  shelf.position.set(0, SHELF_HEIGHT_M, 0);

  const insetX = PI5F2_COFFEE_TABLE_AUTHORED_WIDTH_M / 2 - LEG_SIZE_M / 2;
  const insetZ = PI5F2_COFFEE_TABLE_AUTHORED_DEPTH_M / 2 - LEG_SIZE_M / 2;
  const legHeight = PI5F2_COFFEE_TABLE_AUTHORED_HEIGHT_M - TOP_THICKNESS_M;
  const legsGroup = new THREE.Group();
  legsGroup.name = "legsGroup";
  const corners = [
    [-insetX, insetZ],
    [insetX, insetZ],
    [-insetX, -insetZ],
    [insetX, -insetZ],
  ] as const;
  corners.forEach(([x, z], index) => {
    const leg = new THREE.Mesh(
      new THREE.BoxGeometry(LEG_SIZE_M, legHeight, LEG_SIZE_M),
      new THREE.MeshStandardMaterial({
        color: LEG_COLOR,
        metalness: 0.04,
        roughness: 0.74,
      }),
    );
    leg.name = `leg${index}`;
    leg.position.set(x, legHeight / 2, z);
    legsGroup.add(leg);
  });

  const root = new THREE.Group();
  root.name = "pi5f2DemoCoffeeTable";
  root.add(top);
  root.add(apron);
  root.add(shelf);
  root.add(legsGroup);
  return root;
}
