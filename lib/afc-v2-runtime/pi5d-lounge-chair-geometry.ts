import * as THREE from "three";

/**
 * PI-5D1 test lounge chair authored in metres.
 *
 * Nested groups + an offset root origin. Geometry keeps authored metres.
 * Import-placement grounding is the consumer's job. Visibly narrower than
 * the PI-4A sofa and a different silhouette so mixed scenes are obvious.
 */

export const PI5D_LOUNGE_CHAIR_AUTHORED_WIDTH_M = 0.8;
export const PI5D_LOUNGE_CHAIR_AUTHORED_HEIGHT_M = 0.8;
export const PI5D_LOUNGE_CHAIR_AUTHORED_DEPTH_M = 0.78;

export const PI5D_LOUNGE_CHAIR_ORIGIN_OFFSET_M = Object.freeze({
  x: 0.06,
  y: 0.14,
  z: -0.05,
});

const SEAT_HEIGHT_M = 0.42;
const BACK_HEIGHT_M = 0.38;
const BACK_DEPTH_M = 0.14;
const ARM_WIDTH_M = 0.07;
const ARM_HEIGHT_M = 0.18;
const ARM_DEPTH_M = 0.52;
const SEAT_COLOR = 0x3d6b5a;
const BACK_COLOR = 0x2f5246;
const ARM_COLOR = 0xc4a574;

export function createPi5dLoungeChairObject3D(): THREE.Group {
  const seat = new THREE.Mesh(
    new THREE.BoxGeometry(
      PI5D_LOUNGE_CHAIR_AUTHORED_WIDTH_M,
      SEAT_HEIGHT_M,
      PI5D_LOUNGE_CHAIR_AUTHORED_DEPTH_M,
    ),
    new THREE.MeshStandardMaterial({
      color: SEAT_COLOR,
      metalness: 0.08,
      roughness: 0.72,
    }),
  );
  seat.name = "seat";
  seat.position.set(0, SEAT_HEIGHT_M / 2, 0);

  const back = new THREE.Mesh(
    new THREE.BoxGeometry(
      PI5D_LOUNGE_CHAIR_AUTHORED_WIDTH_M,
      BACK_HEIGHT_M,
      BACK_DEPTH_M,
    ),
    new THREE.MeshStandardMaterial({
      color: BACK_COLOR,
      metalness: 0.08,
      roughness: 0.72,
    }),
  );
  back.name = "back";
  back.position.set(
    0,
    SEAT_HEIGHT_M + BACK_HEIGHT_M / 2,
    -PI5D_LOUNGE_CHAIR_AUTHORED_DEPTH_M / 2 + BACK_DEPTH_M / 2,
  );

  const armY = SEAT_HEIGHT_M + ARM_HEIGHT_M / 2;
  const armZ = -PI5D_LOUNGE_CHAIR_AUTHORED_DEPTH_M / 2 + BACK_DEPTH_M + ARM_DEPTH_M / 2;
  const armX = PI5D_LOUNGE_CHAIR_AUTHORED_WIDTH_M / 2 - ARM_WIDTH_M / 2;

  const leftArm = new THREE.Mesh(
    new THREE.BoxGeometry(ARM_WIDTH_M, ARM_HEIGHT_M, ARM_DEPTH_M),
    new THREE.MeshStandardMaterial({
      color: ARM_COLOR,
      metalness: 0.12,
      roughness: 0.6,
    }),
  );
  leftArm.name = "armLeft";
  leftArm.position.set(-armX, armY, armZ);

  const rightArm = new THREE.Mesh(
    new THREE.BoxGeometry(ARM_WIDTH_M, ARM_HEIGHT_M, ARM_DEPTH_M),
    new THREE.MeshStandardMaterial({
      color: ARM_COLOR,
      metalness: 0.12,
      roughness: 0.6,
    }),
  );
  rightArm.name = "armRight";
  rightArm.position.set(armX, armY, armZ);

  const seatGroup = new THREE.Group();
  seatGroup.name = "seatGroup";
  seatGroup.add(seat);

  const backGroup = new THREE.Group();
  backGroup.name = "backGroup";
  backGroup.add(back);

  const armsGroup = new THREE.Group();
  armsGroup.name = "armsGroup";
  armsGroup.add(leftArm);
  armsGroup.add(rightArm);

  const locator = new THREE.Object3D();
  locator.name = "locator";

  const furnitureLocal = new THREE.Group();
  furnitureLocal.name = "chairLocal";
  furnitureLocal.add(seatGroup);
  furnitureLocal.add(backGroup);
  furnitureLocal.add(armsGroup);
  furnitureLocal.add(locator);

  const root = new THREE.Group();
  root.name = "pi5dLoungeChair";
  root.position.set(
    PI5D_LOUNGE_CHAIR_ORIGIN_OFFSET_M.x,
    PI5D_LOUNGE_CHAIR_ORIGIN_OFFSET_M.y,
    PI5D_LOUNGE_CHAIR_ORIGIN_OFFSET_M.z,
  );
  root.add(furnitureLocal);
  return root;
}
