'use strict';
const assert = require('assert');
const { parsePrice } = require('./parsePrice');

const cases = [
  ['3 999 kr', 3999],
  ['3 290 kr, Ledande bud', 3290],
  ['2 500:-', 2500],
  ['2500 SEK', 2500],
  ['1 200,00 kr', 1200],
  ['kr/st 150 kr', 150],
  ['', null],
  [null, null],
  ['Gratis', null],
];

let passed = 0;
for (const [input, expected] of cases) {
  const result = parsePrice(input);
  assert.strictEqual(result, expected, `parsePrice(${JSON.stringify(input)}) expected ${expected}, got ${result}`);
  passed++;
}
console.log(`parsePrice: ${passed}/${cases.length} tests passed`);
