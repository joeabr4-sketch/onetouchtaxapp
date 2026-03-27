// ── OneTouch TaxApp — Tax Calculations & Financial Utilities ──────────────────
// Pure functions only. No DOM access. No global state.
// Tested in tests/tax.test.js

// ── SARS 2025/26 PAYROLL CONSTANTS ──
const UIF_MONTHLY_CAP      = 177.12;   // 1% × R17,712 monthly earnings ceiling
const UIF_RATE             = 0.01;     // Employee 1% + Employer 1% (each)
const SDL_RATE             = 0.01;     // 1% of leviable amount
const SDL_ANNUAL_THRESHOLD = 500000;   // SDL only applies if annual payroll > R500,000

// ── ROUNDING & FORMATTING ──
function rnd(v) { return Math.round((parseFloat(v) || 0) * 100) / 100; }
function vatOn(subtotal) { return rnd(subtotal * 0.15); }      // VAT on excl-VAT amount
function vatFrom(gross)  { return rnd(gross * 15 / 115); }     // Extract VAT from incl-VAT amount

function fmtR(v) {
  return 'R ' + (parseFloat(v)||0).toLocaleString('en-ZA', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
function fmtRShort(v) {
  const n = parseFloat(v) || 0;
  if (n >= 1000000) return 'R ' + (n / 1000000).toFixed(1) + 'M';
  if (n >= 1000)    return 'R ' + (n / 1000).toFixed(0) + 'k';
  return 'R ' + n.toFixed(0);
}
function exclVat(gross) { return rnd(gross - vatFrom(gross)); }  // Strip VAT from incl-VAT amount

function fmtPayroll(v) {
  return 'R ' + Math.abs(parseFloat(v)||0).toLocaleString('en-ZA', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

// ── DATE UTILITIES ──
function parseDateStr(raw) {
  if (!raw) return '';
  const d = String(raw).replace(/"/g, '').trim();

  // Already ISO: YYYY-MM-DD
  if (/^\d{4}-\d{2}-\d{2}$/.test(d)) return d;

  // YYYY/MM/DD (FNB internet banking)
  if (/^\d{4}\/\d{2}\/\d{2}$/.test(d)) return d.replace(/\//g, '-');

  // DD/MM/YYYY (FNB business / Nedbank)
  const dmy = d.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (dmy) return `${dmy[3]}-${dmy[2].padStart(2,'0')}-${dmy[1].padStart(2,'0')}`;

  // DD-MM-YYYY
  const dmyd = d.match(/^(\d{1,2})-(\d{1,2})-(\d{4})$/);
  if (dmyd) return `${dmyd[3]}-${dmyd[2].padStart(2,'0')}-${dmyd[1].padStart(2,'0')}`;

  // "5 Jan 2024" / "05 Jan 2024" (FNB app export)
  const MON = { jan:'01',feb:'02',mar:'03',apr:'04',may:'05',jun:'06',jul:'07',aug:'08',sep:'09',oct:'10',nov:'11',dec:'12' };
  const dmy3 = d.match(/^(\d{1,2})\s+([A-Za-z]{3})\s+(\d{4})$/);
  if (dmy3) { const m = MON[dmy3[2].toLowerCase()]; if (m) return `${dmy3[3]}-${m}-${dmy3[1].padStart(2,'0')}`; }

  // Last resort: native Date (only safe for unambiguous formats)
  const p = new Date(d);
  if (!isNaN(p)) return `${p.getFullYear()}-${String(p.getMonth()+1).padStart(2,'0')}-${String(p.getDate()).padStart(2,'0')}`;

  return '';
}

// SA financial year: March–February. Returns e.g. "2025/26"
function currentFinancialYear() {
  const now = new Date();
  const y = now.getFullYear();
  return now.getMonth() >= 2
    ? `${y}/${String(y + 1).slice(2)}`
    : `${y - 1}/${String(y).slice(2)}`;
}

// Formats a "YYYY-MM" period key to "March 2025"
function formatPeriodLabel(key) {
  if (!key) return '—';
  const [y, m] = key.split('-');
  const d = new Date(parseInt(y), parseInt(m) - 1, 1);
  return d.toLocaleString('en-ZA', { month: 'long', year: 'numeric' });
}

// ── SARS PAYE (2025/26 brackets) ──
// Returns monthly PAYE amount after primary/secondary/tertiary rebates.
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

// ── EMPLOYEE PAYSLIP CALCULATION ──
// Pure calculation — no DOM access.
// annualPayrollTotal: total of all employees' monthly gross × 12 (company-wide).
// If not provided, estimates from this employee's own annual gross (single-employee preview).
function calcEmployeePayslip(emp, annualPayrollTotal) {
  const gross   = parseFloat(emp.gross)   || 0;
  const travel  = parseFloat(emp.travel)  || 0;
  const housing = parseFloat(emp.housing) || 0;
  const bonus   = parseFloat(emp.bonus)   || 0;
  const medical = parseFloat(emp.medical) || 0;
  const pension = parseFloat(emp.pension) || 0;
  const uifApplicable = emp.uif_applicable !== false;
  const sdlApplicable = emp.sdl_applicable !== false;

  const totalGross    = gross + travel + housing + bonus;
  const taxableIncome = gross + housing + bonus + (travel * 0.8);
  const payeGross     = calcPAYE(taxableIncome * 12, emp.age_bracket || 'under65');
  const paye          = Math.max(0, payeGross - medical); // MATC reduces PAYE, never below 0
  const uifEmp        = uifApplicable ? Math.min(gross * UIF_RATE, UIF_MONTHLY_CAP) : 0;
  const uifEr         = uifApplicable ? Math.min(gross * UIF_RATE, UIF_MONTHLY_CAP) : 0;
  const estAnnualPayroll = annualPayrollTotal != null ? annualPayrollTotal : gross * 12;
  const sdlApplies    = sdlApplicable && estAnnualPayroll > SDL_ANNUAL_THRESHOLD;
  const sdl           = sdlApplies ? rnd(gross * SDL_RATE) : 0;
  const totalDed      = paye + uifEmp + pension;
  const netPay        = totalGross - totalDed;

  return { gross, travel, housing, bonus, totalGross, taxableIncome, paye, uifEmp, uifEr, sdl, medical, pension, totalDed, netPay };
}
