import test from 'node:test';
import assert from 'node:assert/strict';
import {rgbToOklch, oklchToHex} from '../src/oklch.ts';

test('RGB values consumed by Appearance retain their exact sRGB color', () => {
  assert.equal(oklchToHex(rgbToOklch('rgb(226, 223, 218)')), '#e2dfda');
});
test('absolute RGB forms preserve alpha and percentages', () => {
  for (const value of ['rgba(255, 0, 0, 0.5)', 'rgb(100% 0% 0% / 50%)', 'rgba(255 0 0 / .5)']) {
    assert.equal(oklchToHex(rgbToOklch(value)), '#ff000080');
  }
  assert.equal(oklchToHex(rgbToOklch('rgb(300 -2 0)')), '#ff0000');
  assert.equal(oklchToHex(rgbToOklch('rgb(none 0 0 / none)')), '#00000000');
});
test('malformed and unsupported expressions are rejected without invented values', () => {
  for (const value of ['rgb()', 'rgb(1 2)', 'rgb(1 2 3 4)', 'rgb(1,2,3 / .5)', 'rgb(1%,2,3)', 'rgb(1px 2 3)', 'rgb(1 2 3 /)', 'rgb(1 2 3 / .5 / .2)', 'rgb(Infinity 0 0)', 'rgb(from red r g b)']) {
    assert.equal(rgbToOklch(value), null, value);
  }
});
