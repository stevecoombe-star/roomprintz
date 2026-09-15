import * as THREE from "three";

/**
 * PI-5D2A Asset C proof fixture: a small side table authored in metres.
 *
 * Nested groups + an offset root origin. Visibly different from the
 * certified sofa and lounge chair. Used to prove intake → registry
 * without a viewer edit.
 */

export const PI5D2_SIDE_TABLE_ASSET_ID =
  "afc-v2-runtime/test-fixtures/pi5d2-side-table" as const;

export const PI5D2_SIDE_TABLE_GLB_PUBLIC_PATH =
  "/afc-v2-runtime/test-fixtures/pi5d2-side-table.glb" as const;

export const PI5D2_SIDE_TABLE_AUTHORED_WIDTH_M = 0.55;
export const PI5D2_SIDE_TABLE_AUTHORED_HEIGHT_M = 0.46;
export const PI5D2_SIDE_TABLE_AUTHORED_DEPTH_M = 0.52;

export const PI5D2_SIDE_TABLE_ORIGIN_OFFSET_M = Object.freeze({
  x: 0.08,
  y: 0.11,
  z: 0.04,
});

const TOP_THICKNESS_M = 0.04;
const LEG_SIZE_M = 0.045;
const TOP_COLOR = 0x3b5f8a;
const LEG_COLOR = 0xd6c4a8;

export function createPi5d2SideTableObject3D(): THREE.Group {
  const top = new THREE.Mesh(
    new THREE.BoxGeometry(
      PI5D2_SIDE_TABLE_AUTHORED_WIDTH_M,
      TOP_THICKNESS_M,
      PI5D2_SIDE_TABLE_AUTHORED_DEPTH_M,
    ),
    new THREE.MeshStandardMaterial({
      color: TOP_COLOR,
      metalness: 0.08,
      roughness: 0.55,
    }),
  );
  top.name = "top";
  top.position.set(
    0,
    PI5D2_SIDE_TABLE_AUTHORED_HEIGHT_M - TOP_THICKNESS_M / 2,
    0,
  );

  const legHeight = PI5D2_SIDE_TABLE_AUTHORED_HEIGHT_M - TOP_THICKNESS_M;
  const insetX = PI5D2_SIDE_TABLE_AUTHORED_WIDTH_M / 2 - LEG_SIZE_M / 2 - 0.03;
  const insetZ = PI5D2_SIDE_TABLE_AUTHORED_DEPTH_M / 2 - LEG_SIZE_M / 2 - 0.03;
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
        metalness: 0.05,
        roughness: 0.7,
      }),
    );
    leg.name = `leg${index}`;
    leg.position.set(x, legHeight / 2, z);
    legsGroup.add(leg);
  });

  const topGroup = new THREE.Group();
  topGroup.name = "topGroup";
  topGroup.add(top);

  const locator = new THREE.Object3D();
  locator.name = "locator";

  const furnitureLocal = new THREE.Group();
  furnitureLocal.name = "tableLocal";
  furnitureLocal.add(topGroup);
  furnitureLocal.add(legsGroup);
  furnitureLocal.add(locator);

  const root = new THREE.Group();
  root.name = "pi5d2SideTable";
  root.position.set(
    PI5D2_SIDE_TABLE_ORIGIN_OFFSET_M.x,
    PI5D2_SIDE_TABLE_ORIGIN_OFFSET_M.y,
    PI5D2_SIDE_TABLE_ORIGIN_OFFSET_M.z,
  );
  root.add(furnitureLocal);
  return root;
}
