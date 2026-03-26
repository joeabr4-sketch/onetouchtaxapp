/**
 * OneTouch TaxApp — Tax Calculation Tests
 * Run with: node tests/tax.test.js
 * No dependencies required.
 */

// ─── Constants (mirrored from business.html) ──────────────────────────────────
const UIF_MONTHLY_CAP      = 177.12;
const UIF_RATE             = 0.01;
const SDL_RATE             = 0.01;
const SDL_ANNUAL_THRESHOLD = 500000;

// ─── Functions under test (copied verbatim from business.html) ────────────────
function rnd(v) { return Math.round(v * 100) / 100; }

function vatOn(subtotal) { return rnd(subtotal * 0.15); }

function calcPAYE(annualIncome, ageBracket = 'under65') {
  const brackets = [
    { limit: 237100,  base: 0,      rate: 0.18 },
    { limit: 370500,  base: 42678,  rate: 0.26 },
    { limit: 512800,  base: 77362,  rate: 0.31 },
    { limit: 673000,  base: 121475, rate: 0.36 },
    { limit: 857900,  base: 179147, rate: 0.39 },
    { limit: 1817000, base: 251258, rate: 0.41 },
    { limit: Infinity,base: 644489, rate: 0.45 },
  ];
  let tax = 0;
  for (const b of brackets) {
    if (annualIncome <= b.limit) {
      const prev = brackets[brackets.indexOf(b) - 1];
      const prevLimit = prev ? prev.limit : 0;
      tax = b.base + (annualIncome - prevLimit) * b.rate;
      break;
    }
  }
  const primary   = 17235;
  const secondary = (ageBracket === '65to74' || ageBracket === 'over75') ? 9444 : 0;
  const tertiary  = ageBracket === 'over75' ? 3145 : 0;
  tax = Math.max(0, tax - primary - secondary - tertiary);
  return tax / 12;
}

// ─── Test harness ─────────────────────────────────────────────────────────────
let passed = 0;
let failed = 0;

function expect(label, actual, expected, tolerance = 0.01) {
  const ok = Math.abs(actual - expected) <= tolerance;
  if (ok) {
    console.log(`  ✓ ${label}`);
    passed++;
  } else {
    console.error(`  ✗ ${label}`);
    console.error(`      expected: ${expected}`);
    console.error(`      actual:   ${actual}`);
    failed++;
  }
}

// ─── VAT tests ────────────────────────────────────────────────────────────────
console.log('\nVAT (vatOn)');
expect('R1,000 excl → R150 VAT',      vatOn(1000),  150.00);
expect('R100 excl → R15 VAT',         vatOn(100),    15.00);
expect('Zero → R0 VAT',               vatOn(0),       0.00);
expect('R1 → R0.15',                  vatOn(1),       0.15);
expect('R0.01 → R0.00 (rounds down)', vatOn(0.01),    0.00);
expect('R1.33 → R0.20 (rounds)',      vatOn(1.33),    0.20);

// ─── PAYE tests ───────────────────────────────────────────────────────────────
console.log('\nPAYE — under65 bracket tests');
// Below primary rebate threshold: R80,000 annual → tax = 14400, minus rebate 17235 = 0 → 0/12
expect('R80,000 annual → R0/mo (below threshold)',   calcPAYE(80000),          0.00);
// Bracket 1: R200,000 → 200000×0.18 = 36000 − 17235 = 18765 → /12 = 1563.75
expect('R200,000 annual → R1,563.75/mo',             calcPAYE(200000),       1563.75);
// Bracket 2: R300,000 → 42678 + (300000-237100)×0.26 = 42678+16354 = 59032 − 17235 = 41797 → /12 = 3483.08
expect('R300,000 annual → R3,483.08/mo',             calcPAYE(300000),       3483.08);
// Bracket 3: R450,000 → 77362 + (450000-370500)×0.31 = 77362+24645 = 102007 − 17235 = 84772 → /12 = 7064.33
expect('R450,000 annual → R7,064.33/mo',             calcPAYE(450000),       7064.33);
// Bracket 4: R600,000 → 121475 + (600000-512800)×0.36 = 121475+31392 = 152867 − 17235 = 135632 → /12 = 11302.67
expect('R600,000 annual → R11,302.67/mo',            calcPAYE(600000),      11302.67);
// Bracket 5: R750,000 → 179147 + (750000-673000)×0.39 = 179147+30030 = 209177 − 17235 = 191942 → /12 = 15995.17
expect('R750,000 annual → R15,995.17/mo',            calcPAYE(750000),      15995.17);
// Bracket 6: R1,000,000 → 251258 + (1000000-857900)×0.41 = 251258+58261 = 309519 − 17235 = 292284 → /12 = 24357.00
expect('R1,000,000 annual → R24,357.00/mo',          calcPAYE(1000000),     24357.00);
// Bracket 7: R2,000,000 → 644489 + (2000000-1817000)×0.45 = 644489+82350 = 726839 − 17235 = 709604 → /12 = 59133.67
expect('R2,000,000 annual → R59,133.67/mo',          calcPAYE(2000000),     59133.67);

console.log('\nPAYE — age bracket rebates');
// 65to74: secondary rebate 9444 added
// R300,000: 59032 − 17235 − 9444 = 32353 → /12 = 2696.08
expect('R300,000, age 65to74 → R2,696.08/mo',       calcPAYE(300000, '65to74'),  2696.08);
// over75: secondary + tertiary
// R300,000: 59032 − 17235 − 9444 − 3145 = 29208 → /12 = 2434.00
expect('R300,000, age over75 → R2,434.00/mo',       calcPAYE(300000, 'over75'),  2434.00);
// Low income + over75 → never negative
expect('R50,000, age over75 → R0/mo (floor)',        calcPAYE(50000, 'over75'),      0.00);

// ─── UIF tests ────────────────────────────────────────────────────────────────
console.log('\nUIF');
function calcUIF(grossMonthly, applicable = true) {
  if (!applicable) return 0;
  return Math.min(grossMonthly * UIF_RATE, UIF_MONTHLY_CAP);
}
expect('R10,000 gross → R100.00 UIF',               calcUIF(10000),    100.00);
expect('R17,712 gross → R177.12 UIF (at cap)',       calcUIF(17712),    177.12);
expect('R20,000 gross → R177.12 UIF (capped)',       calcUIF(20000),    177.12);
expect('R5,000 gross → R50.00 UIF',                  calcUIF(5000),      50.00);
expect('UIF not applicable → R0',                    calcUIF(20000, false), 0.00);

// ─── SDL tests ────────────────────────────────────────────────────────────────
console.log('\nSDL');
function calcSDL(grossMonthly, annualPayrollTotal, applicable = true) {
  if (!applicable) return 0;
  return applicable && annualPayrollTotal > SDL_ANNUAL_THRESHOLD
    ? rnd(grossMonthly * SDL_RATE)
    : 0;
}
expect('R20,000 gross, R600k annual payroll → R200 SDL',  calcSDL(20000, 600000),   200.00);
expect('R20,000 gross, R400k annual payroll → R0 SDL',    calcSDL(20000, 400000),     0.00);
expect('R20,000 gross, exactly R500k → R0 SDL (not >)',   calcSDL(20000, 500000),     0.00);
expect('R20,000 gross, R500,001 → R200 SDL',              calcSDL(20000, 500001),   200.00);
expect('SDL not applicable → R0',                         calcSDL(20000, 600000, false), 0.00);

// ─── Summary ──────────────────────────────────────────────────────────────────
console.log(`\n${'─'.repeat(50)}`);
console.log(`Results: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
