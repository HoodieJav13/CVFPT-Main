// Redesign gate, frontend half (docs/redesign-gate.md): off unless the value is exactly "look-a".
import test from 'node:test';
import assert from 'node:assert/strict';
import { redesignRequested, REDESIGN_NAME } from '../../redesign/overlayPlugin.mjs';

test('the redesign is off by default and for every value except the exact name', () => {
  for (const value of [undefined, '', 'true', '1', 'on', 'LOOK-A', 'look-a ', 'look_a']) {
    assert.equal(redesignRequested({ REACT_APP_PT_REDESIGN: value }), false, JSON.stringify(value));
  }
  assert.equal(redesignRequested({}), false);
  assert.equal(REDESIGN_NAME, 'look-a');
  assert.equal(redesignRequested({ REACT_APP_PT_REDESIGN: 'look-a' }), true);
});
