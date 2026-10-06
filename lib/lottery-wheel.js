export function getWheelAlignmentDegrees(selectedIndex, sliceCount, currentRotation) {
  const sliceMiddle = (selectedIndex + 0.5) * (360 / sliceCount);
  const currentRotationMod = ((currentRotation % 360) + 360) % 360;
  return ((270 - sliceMiddle - currentRotationMod) % 360 + 360) % 360;
}
