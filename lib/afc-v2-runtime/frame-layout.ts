/**
 * Letterbox / pillarbox the AFC frozen-camera frame inside a browser container.
 *
 * Camera aspect is never taken from the container. The viewer content
 * rectangle always matches frozenCamera.frame.
 */

export type ContainRect = Readonly<{
  width: number;
  height: number;
  left: number;
  top: number;
}>;

export function containFitRect(
  containerWidth: number,
  containerHeight: number,
  frameWidth: number,
  frameHeight: number,
): ContainRect | null {
  if (
    !(containerWidth > 0) ||
    !(containerHeight > 0) ||
    !(frameWidth > 0) ||
    !(frameHeight > 0) ||
    !Number.isFinite(containerWidth) ||
    !Number.isFinite(containerHeight) ||
    !Number.isFinite(frameWidth) ||
    !Number.isFinite(frameHeight)
  ) {
    return null;
  }
  const frameAspect = frameWidth / frameHeight;
  const containerAspect = containerWidth / containerHeight;
  if (containerAspect > frameAspect) {
    const height = containerHeight;
    const width = height * frameAspect;
    return {
      width,
      height,
      left: (containerWidth - width) / 2,
      top: 0,
    };
  }
  const width = containerWidth;
  const height = width / frameAspect;
  return {
    width,
    height,
    left: 0,
    top: (containerHeight - height) / 2,
  };
}

export function containRectAspect(rect: ContainRect): number {
  return rect.width / rect.height;
}
