import test from 'node:test';
import assert from 'node:assert/strict';

import { getWheelAlignmentDegrees } from './lottery-wheel.js';

test('wheel alignment places the selected slice center under the top pointer', () => {
  for (const sliceCount of [1, 2, 7, 50, 500]) {
    for (const selectedIndex of [0, Math.floor(sliceCount / 2), sliceCount - 1]) {
      const currentRotation = 1234;
      const alignment = getWheelAlignmentDegrees(selectedIndex, sliceCount, currentRotation);
      const sliceMiddle = (selectedIndex + 0.5) * (360 / sliceCount);
      const finalAngle = (sliceMiddle + currentRotation + alignment) % 360;
      assert.ok(Math.abs(finalAngle - 270) < 1e-8);
    }
  }
});
