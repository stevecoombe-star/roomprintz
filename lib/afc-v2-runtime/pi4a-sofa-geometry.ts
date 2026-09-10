import * as THREE from "three";

/**
 * PI-4A test sofa authored in metres.
 *
 * Nested groups + an offset root origin. Geometry keeps authored metres.
 * Import-placement grounding is the consumer's job.
 */

export const PI4A_SOFA_AUTHORED_WIDTH_M = 2.2;
export const PI4A_SOFA_AUTHORED_HEIGHT_M = 0.8;
export const PI4A_SOFA_AUTHORED_DEPTH_M = 0.9;

export const PI4A_SOFA_ORIGIN_OFFSET_M = Object.freeze({
  x: 0.12,
  y: 0.27,
  z: -0.09,
});

const SEAT_HEIGHT_M = 0.45;
const BACK_HEIGHT_M = 0.35;
const BACK_DEPTH_M = 0.18;
const SEAT_COLOR = 0x6b5344;
const BACK_COLOR = 0x4f4338;

export function createPi4aSofaObject3D(): THREE.Group {
  const seat = new THREE.Mesh(
    new THREE.BoxGeometry(
      PI4A_SOFA_AUTHORED_WIDTH_M,
      SEAT_HEIGHT_M,
      PI4A_SOFA_AUTHORED_DEPTH_M,
    ),
    new THREE.MeshStandardMaterial({
      color: SEAT_COLOR,
      metalness: 0.05,
      roughness: 0.85,
    }),
  );
  seat.name = "seat";
  seat.position.set(0, SEAT_HEIGHT_M / 2, 0);

  const back = new THREE.Mesh(
    new THREE.BoxGeometry(
      PI4A_SOFA_AUTHORED_WIDTH_M,
      BACK_HEIGHT_M,
      BACK_DEPTH_M,
    ),
    new THREE.MeshStandardMaterial({
      color: BACK_COLOR,
      metalness: 0.05,
      roughness: 0.85,
    }),
  );
  back.name = "back";
  back.position.set(
    0,
    SEAT_HEIGHT_M + BACK_HEIGHT_M / 2,
    -PI4A_SOFA_AUTHORED_DEPTH_M / 2 + BACK_DEPTH_M / 2,
  );

  const seatGroup = new THREE.Group();
  seatGroup.name = "seatGroup";
  seatGroup.add(seat);

  const backGroup = new THREE.Group();
  backGroup.name = "backGroup";
  backGroup.add(back);

  const locator = new THREE.Object3D();
  locator.name = "locator";

  const furnitureLocal = new THREE.Group();
  furnitureLocal.name = "sofaLocal";
  furnitureLocal.add(seatGroup);
  furnitureLocal.add(backGroup);
  furnitureLocal.add(locator);

  const root = new THREE.Group();
  root.name = "pi4aSofa";
  root.position.set(
    PI4A_SOFA_ORIGIN_OFFSET_M.x,
    PI4A_SOFA_ORIGIN_OFFSET_M.y,
    PI4A_SOFA_ORIGIN_OFFSET_M.z,
  );
  root.add(furnitureLocal);
  return root;
}
