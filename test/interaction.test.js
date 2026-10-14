const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '..', 'public', 'interaction.js'), 'utf8');

function loadFeedback({ vibrate = true, reducedMotion = false, preference = null } = {}) {
  const vibrations = [];
  const localStorage = {
    getItem: () => preference,
    setItem: () => {},
  };
  const navigator = vibrate ? { vibrate: pattern => vibrations.push(pattern) } : {};
  const window = { matchMedia: () => ({ matches: reducedMotion }) };
  vm.runInNewContext(source, {
    navigator,
    window,
    localStorage,
    document: { querySelectorAll: () => [] },
  });
  return { feedback: window.CutlyFeedback, vibrations };
}

test('haptic feedback uses browser vibration only when supported and enabled', () => {
  const supported = loadFeedback();
  supported.feedback('tap');
  supported.feedback('confirm');
  supported.feedback('error');
  assert.equal(JSON.stringify(supported.vibrations), JSON.stringify([10, [12, 35, 18], [20, 35, 20]]));

  const unsupported = loadFeedback({ vibrate: false });
  assert.doesNotThrow(() => unsupported.feedback('tap'));
  assert.deepEqual(unsupported.vibrations, []);
});

test('haptic feedback respects reduced motion and the saved preference', () => {
  const reduced = loadFeedback({ reducedMotion: true });
  reduced.feedback('confirm');
  assert.deepEqual(reduced.vibrations, []);

  const disabled = loadFeedback({ preference: 'off' });
  disabled.feedback('tap');
  assert.deepEqual(disabled.vibrations, []);
});
