// Guards the application version string: the format asserted here is the one
// README.md documents and the page footer shows.
const test = require('node:test');
const assert = require('node:assert');

const { APP_VERSION } = require('../js/version.js');

test('APP_VERSION is a semantic version', () => {
  assert.match(APP_VERSION, /^\d+\.\d+\.\d+$/, 'expected MAJOR.MINOR.PATCH');
});

test('APP_VERSION has no leading zeroes', () => {
  for(const part of APP_VERSION.split('.')){
    assert.equal(String(Number(part)), part, `"${part}" has a leading zero`);
  }
});
