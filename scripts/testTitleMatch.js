'use strict';
function allWordsPresent(title, searchTerm) {
  const titleLower = title.toLowerCase();
  const words = searchTerm.toLowerCase().split(/\s+/).filter(Boolean);
  return words.every(w => {
    const escaped = w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return new RegExp(`(?:^|[^a-z0-9])${escaped}(?:[^a-z0-9]|$)`).test(titleLower);
  });
}

const tests = [
  // Should MATCH
  ['Ryzen 7 7800X3D, 4.2 GHz, 96 MB OEM',  'ryzen 7800x3d',     true],
  ['MSI GeForce RTX 3080 Ti Gaming X',       'rtx 3080 ti',       true],
  ['ASUS ROG RTX 4080 SUPER 16GB',           'rtx 4080 super',    true],
  ['AMD Ryzen 9 5900X Boxed',                'ryzen 9 5900x',     true],
  ['Intel Core i7-13700K',                   'i7-13700k',         true],
  ['Sapphire RX 7900 XT 20GB',              'rx 7900 xt',        true],
  ['GIGABYTE RTX 3080 GAMING OC 10G',        'rtx 3080',          true],
  // Should NOT match
  ['Ryzen 7 7800X3D, 4.2 GHz',             'rtx 3080 ti',       false],
  ['AMD Ryzen 7',                            'rtx 4070 ti super', false],
  ['Antec 1300W Platinum PSU',              'rtx 4070 super',    false],
  ['MSI GeForce RTX 4090 HEATSINK ONLY',    'i7-13700k',         false],
  ['Sapphire RX 7900 XTX 24GB',            'rx 7900 xt',        false],
  ['MSI RTX 3080 Gaming Trio',              'rtx 3080 ti',       false],
];

let pass = 0, fail = 0;
for (const [title, term, expected] of tests) {
  const result = allWordsPresent(title, term);
  const ok = result === expected;
  if (ok) pass++; else fail++;
  if (!ok) console.log(`FAIL: "${term}" in "${title}" => got ${result}, expected ${expected}`);
}
console.log(`${pass}/${pass + fail} tests passed`);
