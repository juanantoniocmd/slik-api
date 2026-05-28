import { scoreSlikReport } from '../scoring/adira-model';
import type {
  ParsedSLIK,
  SLIKFacility,
  SLIKRingkasanFasilitas,
} from '../parsers/types';
import type { CreditScoringResult } from '../scoring/adira-model';

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
    baki_debet: 10_000_000,
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
    plafon_awal: 80_000_000,
    plafon: 80_000_000,
    sifat_kredit: 'Lainnya',
    frekuensi_restrukturisasi: 0,
    cara_restrukturisasi: '',
    jenis_penggunaan: 'Konsumsi',
    jenis_kredit: 'KPR',
    akad: 'Konvensional',
    suku_bunga: 9.5,
    jenis_suku_bunga: 'Fixed',
    kategori_debitur: 'Bukan Debitur UMKM',
    tanggal_awal_kredit: monthsAgo(36),
    tanggal_jatuh_tempo: new Date(TODAY.getFullYear() + 2, TODAY.getMonth(), 1),
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
        alamat: 'Jl. Sudirman No.1, 10270',
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

let passed = 0;
let failed = 0;

function runTest(
  name: string,
  report: ParsedSLIK,
  assertion: (r: CreditScoringResult) => { ok: boolean; msg?: string },
) {
  const result = scoreSlikReport(report);
  const { ok, msg } = assertion(result);
  if (ok) {
    console.log(`✅ ${name}`);
    passed++;
  } else {
    console.error(`❌ ${name}${msg ? ': ' + msg : ''}`);
    failed++;
  }
}

runTest(
  'TC-1 Clean Normal -> A',
  makeReport({}, [
    makeFacility({ no_rekening: '1111111111' }),
    makeFacility({ no_rekening: '2222222222', baki_debet: 5_000_000 }),
    makeFacility({ no_rekening: '3333333333' }),
    makeFacility({ no_rekening: '4444444444', baki_debet: 4_000_000 }),
  ]),
  (r) => ({
    ok: r.stage1_profile.file_type === 'NORMAL' && r.stage3_scoring.grade === 'A',
  }),
);

runTest(
  'TC-2 KO-1 DPD>90 + BD>5jt',
  makeReport({}, [
    makeFacility({
      no_rekening: '5555555555',
      jumlah_hari_tunggakan: 95,
      baki_debet: 8_000_000,
      pelapor_type: 'Multifinance',
    }),
    makeFacility({ no_rekening: '6666666666' }),
    makeFacility({ no_rekening: '7777777777' }),
    makeFacility({ no_rekening: '8888888888' }),
  ]),
  (r) => ({ ok: r.stage3_scoring.grade === 'KO' }),
);

runTest(
  'TC-3 KO-2 Dihapusbukukan <=36 bulan',
  makeReport({}, [
    makeFacility({
      no_rekening: '9999999999',
      kondisi: 'Dihapusbukukan',
      tanggal_kondisi: monthsAgo(18),
    }),
    makeFacility({ no_rekening: '1212121212' }),
    makeFacility({ no_rekening: '1313131313' }),
    makeFacility({ no_rekening: '1414141414' }),
  ]),
  (r) => ({ ok: r.stage2_knockout.triggered_rules.includes('KO-2') }),
);

runTest(
  'TC-4 KO-5 Lunas Diskon Leasing',
  makeReport({}, [
    makeFacility({
      no_rekening: '1515151515',
      kondisi: 'Lunas Dengan Diskon',
      tanggal_kondisi: monthsAgo(8),
      pelapor_type: 'Multifinance',
    }),
    makeFacility({ no_rekening: '1616161616' }),
    makeFacility({ no_rekening: '1717171717' }),
    makeFacility({ no_rekening: '1818181818' }),
  ]),
  (r) => ({ ok: r.stage2_knockout.triggered_rules.includes('KO-5') }),
);

runTest(
  'TC-5 KO-3 Pengadilan',
  makeReport({}, [
    makeFacility({
      no_rekening: '1919191919',
      kondisi: 'Lunas - Diselesaikan Melalui Pengadilan',
      tanggal_kondisi: monthsAgo(60),
    }),
    makeFacility({ no_rekening: '2020202020' }),
    makeFacility({ no_rekening: '2121212121' }),
    makeFacility({ no_rekening: '2222222223' }),
  ]),
  (r) => ({ ok: r.stage2_knockout.triggered_rules.includes('KO-3') }),
);

runTest(
  'TC-6 KO-6 Itikad Tidak Baik',
  makeReport({}, [
    makeFacility({
      no_rekening: '2323232323',
      sebab_macet: 'Itikad Tidak Baik',
      tanggal_macet: monthsAgo(12),
    }),
    makeFacility({ no_rekening: '2424242424' }),
    makeFacility({ no_rekening: '2525252525' }),
    makeFacility({ no_rekening: '2626262626' }),
  ]),
  (r) => ({ ok: r.stage2_knockout.triggered_rules.includes('KO-6') }),
);

runTest(
  'TC-7 Thin -> N/A',
  makeReport({}, [makeFacility({ no_rekening: 'R1001' })]),
  (r) => ({ ok: r.stage3_scoring.grade === 'N/A' }),
);

runTest('TC-8 CV -> CV', makeReport({}, []), (r) => ({
  ok: r.stage3_scoring.grade === 'CV',
}));

runTest(
  'TC-9 Expired -> INVALID',
  makeReport({ tanggal_permintaan: daysAgo(35) }, [makeFacility({})]),
  (r) => ({ ok: r.stage3_scoring.grade === 'INVALID' }),
);

runTest(
  'TC-9b Expired + KO -> KO decision takes priority',
  makeReport(
    { tanggal_permintaan: daysAgo(44) },
    [
      makeFacility({
        no_rekening: 'KO-EXPIRED-1',
        jumlah_hari_tunggakan: 762,
        baki_debet: 213_627_936,
      }),
      makeFacility({
        no_rekening: 'KO-EXPIRED-2',
        kondisi: 'Dihapusbukukan',
        tanggal_kondisi: monthsAgo(12),
      }),
      makeFacility({ no_rekening: 'KO-EXPIRED-3' }),
      makeFacility({ no_rekening: 'KO-EXPIRED-4' }),
    ],
  ),
  (r) => ({
    ok:
      r.stage2_knockout.is_ko &&
      r.stage3_scoring.grade === 'KO' &&
      r.stage3_scoring.decision === '⛔ TOLAK OTOMATIS' &&
      !r.stage0_validity.is_valid,
  }),
);

runTest(
  'TC-10 D1 recency check',
  makeReport({}, [
    makeFacility({
      no_rekening: '2727272727',
      kualitas_kode: 2,
      monthly_quality_strip: [
        ...Array.from({ length: 21 }, (_, i) => ({
          month: `Bulan ${i + 1}`,
          quality: 1,
        })),
        { month: 'Bulan 22', quality: 2 },
        { month: 'Bulan 23', quality: 2 },
        { month: 'Bulan 24', quality: 2 },
      ],
    }),
    makeFacility({ no_rekening: '2828282828' }),
    makeFacility({ no_rekening: '2929292929' }),
    makeFacility({ no_rekening: '3030303030' }),
  ]),
  (r) => ({ ok: r.stage3_scoring.breakdown?.d1_kualitas_recency === 15 }),
);

runTest(
  'VAL-MARLAN -> A',
  makeReport(
    {
      ringkasan_fasilitas: makeRingkasan(15_000_000_000, 8_800_000_000, 30),
    },
    Array.from({ length: 8 }, (_, i) =>
      makeFacility({ no_rekening: `M${1000 + i}`, baki_debet: i === 0 ? 8_800_000_000 : 0 }),
    ),
  ),
  (r) => ({ ok: r.stage3_scoring.grade === 'A' }),
);

runTest(
  'VAL-EDO -> KO',
  makeReport(
    { ringkasan_fasilitas: makeRingkasan(1_000_000_000, 750_000_000, 25) },
    [
      makeFacility({
        no_rekening: 'E1001',
        jumlah_hari_tunggakan: 1602,
        baki_debet: 750_000_000,
      }),
      makeFacility({
        no_rekening: 'E1002',
        kondisi: 'Dihapusbukukan',
        tanggal_kondisi: monthsAgo(12),
      }),
      makeFacility({ no_rekening: 'E1003' }),
      makeFacility({ no_rekening: 'E1004' }),
    ],
  ),
  (r) => ({ ok: r.stage3_scoring.grade === 'KO' }),
);

runTest(
  'VAL-ANINDITA -> A',
  makeReport(
    { ringkasan_fasilitas: makeRingkasan(700_000_000, 54_000_000, 76) },
    [
      makeFacility({
        no_rekening: 'A1001',
        kualitas_kode: 2,
        monthly_quality_strip: Array.from({ length: 24 }, (_, i) => ({
          month: `Bulan ${i + 1}`,
          quality: i >= 21 ? 1 : 2,
        })),
      }),
      makeFacility({ no_rekening: 'A1002', baki_debet: 44_000_000 }),
      makeFacility({ no_rekening: 'A1003' }),
      makeFacility({ no_rekening: 'A1004' }),
      makeFacility({ no_rekening: 'A1005' }),
    ],
  ),
  (r) => ({ ok: r.stage3_scoring.grade === 'A' }),
);

runTest(
  'VAL-RIAN thin -> N/A',
  makeReport({}, [makeFacility({ no_rekening: 'R2001' })]),
  (r) => ({ ok: r.stage3_scoring.grade === 'N/A' }),
);

runTest(
  'VAL-ANTON stack -> KO-7',
  makeReport(
    { ringkasan_fasilitas: makeRingkasan(500_000_000, 30_000_000, 10) },
    Array.from({ length: 8 }, (_, i) =>
      makeFacility({
        no_rekening: `T${1000 + i}`,
        jumlah_hari_tunggakan: i < 5 ? 60 : 0,
        kualitas_kode: i < 5 ? 2 : 1,
        baki_debet: i === 0 ? 30_000_000 : 0,
      }),
    ),
  ),
  (r) => ({
    ok:
      r.stage3_scoring.grade === 'KO' &&
      r.stage2_knockout.triggered_rules.includes('KO-7'),
  }),
);

console.log(`TOTAL: ${passed + failed} | PASSED: ${passed} | FAILED: ${failed}`);
process.exit(failed > 0 ? 1 : 0);
