import { scoreSlikReport } from '../scoring/adira-model';
import type {
  ParsedSLIK,
  SLIKFacility,
  SLIKRingkasanFasilitas,
} from '../parsers/types';
import type { CreditScoringResult } from '../scoring/adira-model';

// =============================================
// HELPERS
// =============================================

const TODAY = new Date();
TODAY.setHours(0, 0, 0, 0);

function daysAgo(n: number): Date {
  const d = new Date(TODAY);
  d.setDate(d.getDate() - n);
  return d;
}

function monthsAgo(n: number): Date {
  const d = new Date(TODAY);
  d.setMonth(d.getMonth() - n);
  return d;
}

function makeRingkasan(
  plafon: number,
  baki: number,
  count: number,
): SLIKRingkasanFasilitas {
  return {
    plafon_efektif_total: plafon,
    baki_debet_total: baki,
    jumlah_kreditur_bank_umum: count,
    jumlah_kreditur_bpr_bprs: 0,
    jumlah_kreditur_lembaga_pembiayaan: 0,
    jumlah_kreditur_lainnya: 0,
    total_fasilitas: count,
    kualitas_terburuk_kode: 1,
    bulan_data_terakhir: 'Mei 2026',
  };
}

function makeFacility(overrides: Partial<SLIKFacility>): SLIKFacility {
  return {
    pelapor: 'PT Bank Mandiri',
    pelapor_type: 'Bank',
    cabang: 'KC Jakarta Pusat',
    no_rekening: '1234567890',
    baki_debet: 100_000_000,
    tanggal_update: TODAY,
    kualitas_kode: 1,
    kualitas_label: '1 - Lancar',
    kondisi: 'Aktif',
    tanggal_kondisi: null,
    sebab_macet: null,
    tanggal_macet: null,
    jumlah_hari_tunggakan: 0,
    frekuensi_tunggakan: 0,
    tunggakan_pokok: 0,
    tunggakan_bunga: 0,
    denda: 0,
    plafon_awal: 500_000_000,
    plafon: 500_000_000,
    sifat_kredit: 'Lainnya',
    frekuensi_restrukturisasi: 0,
    cara_restrukturisasi: '',
    jenis_penggunaan: 'Konsumsi',
    jenis_kredit: 'KPR',
    akad: 'Konvensional',
    suku_bunga: 9.5,
    jenis_suku_bunga: 'Fixed',
    kategori_debitur: 'Bukan Debitur UMKM',
    tanggal_awal_kredit: monthsAgo(48),
    tanggal_jatuh_tempo: new Date(TODAY.getFullYear() + 5, TODAY.getMonth(), 1),
    sektor_ekonomi: 'Perumahan',
    kredit_program_pemerintah: false,
    monthly_quality_strip: Array.from({ length: 24 }, (_, i) => ({
      month: `Bulan ${i + 1}`,
      quality: 1,
    })),
    ...overrides,
  };
}

function makeReport(
  overrides: Partial<ParsedSLIK>,
  facilities: SLIKFacility[],
): ParsedSLIK {
  const totalPlafon = facilities.reduce((s, f) => s + f.plafon, 0);
  const totalBaki = facilities.reduce((s, f) => s + f.baki_debet, 0);
  return {
    nomor_laporan: 'TEST/001/2026',
    tanggal_permintaan: daysAgo(2),
    kode_ref_pengguna: '111111',
    operator: 'Test System',
    posisi_data_terakhir: 'Mei 2026',
    debitur_pokok: [
      {
        nama: 'UDIN PRATAMA',
        nik: '3174092012850005',
        npwp: null,
        jenis_kelamin: 'LAKI-LAKI',
        tempat_lahir: 'Jakarta',
        tanggal_lahir: new Date(1990, 3, 20),
        pekerjaan: 'Karyawan',
        tempat_bekerja: 'PT ABC',
        bidang_usaha: 'Perdagangan',
        alamat: 'Jl. Sudirman No.1',
        kelurahan: 'Senayan',
        kecamatan: 'Kebayoran',
        kabupaten_kota: 'Jakarta Selatan',
        kode_pos: '12190',
        negara: 'Indonesia',
      },
    ],
    ringkasan_fasilitas: makeRingkasan(
      totalPlafon,
      totalBaki,
      facilities.length,
    ),
    facilities,
    agunan: [],
    total_pages: 3,
    parse_timestamp: new Date(),
    parse_warnings: [],
    ...overrides,
  };
}

// =============================================
// TEST RUNNER
// =============================================

let passed = 0;
let failed = 0;

function runTest(
  name: string,
  report: ParsedSLIK,
  assertion: (r: CreditScoringResult) => { ok: boolean; msg?: string },
) {
  console.log(`\n${'─'.repeat(55)}`);
  console.log(`TEST: ${name}`);
  const result = scoreSlikReport(report);
  const { ok, msg } = assertion(result);
  console.log(
    `  Stage0 Valid:   ${result.stage0_validity.is_valid ? '✔' : '✘'} ${result.stage0_validity.errors.join('; ')}`,
  );
  console.log(
    `  Stage1 Profile: ${result.stage1_profile.is_thin_file ? 'THIN' : 'THICK'} — ${result.stage1_profile.reason}`,
  );
  console.log(
    `  Stage2 KO:      ${
      result.stage2_knockout.is_ko
        ? `⛔ ${result.stage2_knockout.triggered_rules.join(', ')}`
        : '✔ CLEAN'
    }`,
  );
  if (result.stage2_knockout.is_ko) {
    for (const [k, v] of Object.entries(result.stage2_knockout.details)) {
      console.log(`     ${k}: ${v}`);
    }
  }
  console.log(
    `  Stage3 Score:   ${result.stage3_scoring.score} → Grade ${result.stage3_scoring.grade} → ${result.stage3_scoring.decision}`,
  );
  if (result.stage3_scoring.breakdown) {
    const b = result.stage3_scoring.breakdown;
    console.log(
      `  Breakdown:      Base:${b.baseScore} D1b:${b.d1b_recency} D2:${b.d2_severity} D3a:${b.d3a_restruFreq} D3b:${b.d3b_restruStatus} D4:${b.d4_creditAge} D5b:${b.d5b_debtBurden}`,
    );
  }
  console.log(
    `  Flags:          ${result.diagnostic_flags.join(', ') || 'none'}`,
  );
  if (ok) {
    console.log(`  ✅ PASSED`);
    passed++;
  } else {
    console.error(`  ❌ FAILED${msg ? ': ' + msg : ''}`);
    failed++;
  }
}

// =============================================
// SCENARIOS
// =============================================

// TC-1: Clean thick file — ideal applicant
runTest(
  'TC-1: Clean Thick File (Grade A)',
  makeReport({}, [
    makeFacility({
      pelapor: 'PT Bank Mandiri',
      pelapor_type: 'Bank',
      plafon: 500_000_000,
      baki_debet: 100_000_000,
    }),
    makeFacility({
      pelapor: 'PT Bank BCA',
      pelapor_type: 'Bank',
      plafon: 50_000_000,
      baki_debet: 10_000_000,
      jenis_kredit: 'Kartu Kredit',
    }),
  ]),
  (r) => ({
    ok:
      r.stage3_scoring.grade === 'A' && r.stage3_scoring.decision === 'APPROVE',
    msg: `grade=${r.stage3_scoring.grade} decision=${r.stage3_scoring.decision}`,
  }),
);

// TC-2: KO-1 — active KOL 3 + DPD > 90
runTest(
  'TC-2: KO-1 — Delinquent (KOL 3 / DPD 95)',
  makeReport({}, [
    makeFacility({
      kualitas_kode: 3,
      kualitas_label: '3 - Kurang Lancar',
      jumlah_hari_tunggakan: 95,
      kondisi: 'Aktif',
      pelapor: 'Mega Finance',
      pelapor_type: 'Multifinance',
    }),
    makeFacility({}),
  ]),
  (r) => ({
    ok:
      r.stage2_knockout.is_ko &&
      r.stage2_knockout.triggered_rules.includes('KO-1') &&
      r.stage3_scoring.decision === 'REJECT',
    msg: `KO rules: ${r.stage2_knockout.triggered_rules.join(',')}`,
  }),
);

// TC-3: KO-2 — active restructured facility
runTest(
  'TC-3: KO-2 — Active Restructuring',
  makeReport({}, [
    makeFacility({
      sifat_kredit: 'Direstrukturisasi',
      frekuensi_restrukturisasi: 1,
      kondisi: 'Aktif',
      pelapor: 'PT Bank BRI',
      pelapor_type: 'Bank',
    }),
    makeFacility({}),
  ]),
  (r) => ({
    ok:
      r.stage2_knockout.is_ko &&
      r.stage2_knockout.triggered_rules.includes('KO-2') &&
      r.stage3_scoring.decision === 'REJECT',
    msg: `KO rules: ${r.stage2_knockout.triggered_rules.join(',')}`,
  }),
);

// TC-4: KO-3 — Lunas Dengan Diskon < 12 months ago
runTest(
  'TC-4: KO-3 — Lunas Dengan Diskon (8 bln lalu)',
  makeReport({}, [
    makeFacility({
      kondisi: 'Lunas Dengan Diskon',
      tanggal_kondisi: monthsAgo(8),
      pelapor: 'PT Adira Finance',
      pelapor_type: 'Multifinance',
    }),
    makeFacility({}),
  ]),
  (r) => ({
    ok:
      r.stage2_knockout.is_ko &&
      r.stage2_knockout.triggered_rules.includes('KO-3') &&
      r.stage3_scoring.decision === 'REJECT',
    msg: `KO rules: ${r.stage2_knockout.triggered_rules.join(',')}`,
  }),
);

// TC-5: KO-4 — Dihapusbukukan < 24 months ago
runTest(
  'TC-5: KO-4 — Dihapusbukukan (18 bln lalu)',
  makeReport({}, [
    makeFacility({
      kondisi: 'Dihapusbukukan',
      tanggal_kondisi: monthsAgo(18),
      pelapor: 'PT FIF',
      pelapor_type: 'Multifinance',
    }),
    makeFacility({}),
  ]),
  (r) => ({
    ok:
      r.stage2_knockout.is_ko &&
      r.stage2_knockout.triggered_rules.includes('KO-4') &&
      r.stage3_scoring.decision === 'REJECT',
    msg: `KO rules: ${r.stage2_knockout.triggered_rules.join(',')}`,
  }),
);

// TC-6: KO-6 — Itikad Tidak Baik < 36 months ago
runTest(
  'TC-6: KO-6 — Itikad Tidak Baik (12 bln lalu)',
  makeReport({}, [
    makeFacility({
      sebab_macet: 'Itikad Tidak Baik',
      tanggal_macet: monthsAgo(12),
      kualitas_kode: 5,
      kondisi: 'Aktif',
      pelapor: 'PT Capella Multidana',
      pelapor_type: 'Multifinance',
    }),
    makeFacility({}),
  ]),
  (r) => ({
    ok:
      r.stage2_knockout.is_ko &&
      r.stage2_knockout.triggered_rules.includes('KO-6') &&
      r.stage3_scoring.decision === 'REJECT',
    msg: `KO rules: ${r.stage2_knockout.triggered_rules.join(',')}`,
  }),
);

// TC-7: Thin File — clean single facility
runTest(
  'TC-7: Thin File — Clean (1 fasilitas)',
  makeReport({}, [
    makeFacility({ plafon: 500_000_000, baki_debet: 100_000_000 }),
  ]),
  (r) => ({
    ok:
      r.stage1_profile.is_thin_file &&
      !r.stage2_knockout.is_ko &&
      r.stage3_scoring.decision === 'APPROVE WITH LIMIT CAP',
    msg: `thin=${r.stage1_profile.is_thin_file} decision=${r.stage3_scoring.decision}`,
  }),
);

// TC-8: Expired SLIK (> 30 days)
runTest(
  'TC-8: Validity — Expired Report (35 hari lalu)',
  makeReport({ tanggal_permintaan: daysAgo(35) }, [makeFacility({})]),
  (r) => ({
    ok:
      !r.stage0_validity.is_valid &&
      r.stage0_validity.errors.some((e) => e.includes('kadaluarsa')),
    msg: `errors: ${r.stage0_validity.errors.join('; ')}`,
  }),
);

// TC-9: Thick file with DPK history — D1b drops 35→15 but total 140 still Grade A
runTest(
  'TC-9: Thick File — Historical KOL 2 (still Grade A, D1b penalty)',
  makeReport({}, [
    makeFacility({
      pelapor: 'PT Bank BNI',
      pelapor_type: 'Bank',
      plafon: 200_000_000,
      baki_debet: 50_000_000,
      monthly_quality_strip: [
        ...Array.from({ length: 20 }, (_, i) => ({
          month: `Bulan ${i + 1}`,
          quality: 1,
        })),
        { month: 'Bulan 21', quality: 2 },
        { month: 'Bulan 22', quality: 2 },
        { month: 'Bulan 23', quality: 1 },
        { month: 'Bulan 24', quality: 1 },
      ],
    }),
    makeFacility({ pelapor: 'PT Bank BCA', pelapor_type: 'Bank' }),
  ]),
  (r) => ({
    ok:
      !r.stage2_knockout.is_ko &&
      r.stage3_scoring.grade === 'A' &&
      r.stage3_scoring.decision === 'APPROVE' &&
      r.stage3_scoring.breakdown!.d1b_recency === 15, // D1b penalized from 35 → 15
    msg: `grade=${r.stage3_scoring.grade} score=${r.stage3_scoring.score} d1b=${r.stage3_scoring.breakdown?.d1b_recency}`,
  }),
);

// TC-10: Pinjol detected — flag diagnostic
runTest(
  'TC-10: Pinjol/BNPL Detected — Diagnostic Flag',
  makeReport({}, [
    makeFacility({
      pelapor: 'Kredivo Indonesia',
      pelapor_type: 'Pinjol_BNPL',
      plafon: 5_000_000,
      baki_debet: 2_000_000,
    }),
    makeFacility({}),
  ]),
  (r) => ({
    ok: r.diagnostic_flags.some((f) => f.startsWith('PINJOL_BNPL_DETECTED')),
    msg: `flags: ${r.diagnostic_flags.join(', ')}`,
  }),
);

// =============================================
// SUMMARY
// =============================================
console.log(`\n${'═'.repeat(55)}`);
console.log(
  `TOTAL: ${passed + failed} | ✅ PASSED: ${passed} | ❌ FAILED: ${failed}`,
);
console.log('═'.repeat(55));
process.exit(failed > 0 ? 1 : 0);
