import { parseSlikPdf } from '../parsers/pdf-parser';
import { scoreSlikReport } from '../scoring/adira-model';
import { join } from 'path';

const UPLOADS_DIR = join(process.cwd(), 'uploads');
const FILE = 'slik_1779293026549_5qv2lu.pdf';
const filePath = join(UPLOADS_DIR, FILE);

console.log(`\n${'═'.repeat(60)}`);
console.log(`TEST-REAL-PDF: Parsing ${FILE}`);
console.log('═'.repeat(60));

let parsed;
try {
  parsed = await parseSlikPdf(filePath);
} catch (err: any) {
  console.error('❌ parseSlikPdf threw:', err.message);
  process.exit(1);
}

// ---- PARSER OUTPUT ----
console.log('\n📋 HEADER');
console.log(`  Nomor Laporan     : ${parsed.nomor_laporan}`);
console.log(`  Tanggal Permintaan: ${parsed.tanggal_permintaan?.toLocaleDateString('id-ID') ?? 'null'}`);
console.log(`  Kode Ref Pengguna : ${parsed.kode_ref_pengguna}`);
console.log(`  Operator          : ${parsed.operator}`);
console.log(`  Posisi Data       : ${parsed.posisi_data_terakhir}`);
console.log(`  Total Pages       : ${parsed.total_pages}`);
if (parsed.parse_warnings.length) {
  console.warn(`  ⚠ Warnings: ${parsed.parse_warnings.join(' | ')}`);
}

console.log('\n👤 DATA POKOK DEBITUR');
for (const d of parsed.debitur_pokok) {
  console.log(`  Nama       : ${d.nama}`);
  console.log(`  NIK        : ${d.nik}`);
  console.log(`  TTL        : ${d.tempat_lahir}, ${d.tanggal_lahir?.toLocaleDateString('id-ID') ?? '-'}`);
  console.log(`  Pekerjaan  : ${d.pekerjaan} — ${d.tempat_bekerja}`);
  console.log(`  Alamat     : ${d.alamat}`);
  console.log('  ---');
}

console.log('\n📊 RINGKASAN FASILITAS');
const r = parsed.ringkasan_fasilitas;
console.log(`  Plafon Efektif Total  : Rp ${r.plafon_efektif_total.toLocaleString('id-ID')}`);
console.log(`  Baki Debet Total      : Rp ${r.baki_debet_total.toLocaleString('id-ID')}`);
console.log(`  Total Fasilitas       : ${r.total_fasilitas}`);
console.log(`  Bank Umum             : ${r.jumlah_kreditur_bank_umum}`);
console.log(`  BPR/BPRS              : ${r.jumlah_kreditur_bpr_bprs}`);
console.log(`  Lembaga Pembiayaan    : ${r.jumlah_kreditur_lembaga_pembiayaan}`);
console.log(`  Lainnya               : ${r.jumlah_kreditur_lainnya}`);
console.log(`  Kualitas Terburuk     : KOL ${r.kualitas_terburuk_kode}`);
console.log(`  Bulan Data Terakhir   : ${r.bulan_data_terakhir}`);

console.log(`\n💳 DETAIL FASILITAS (${parsed.facilities.length} fasilitas)`);
for (let i = 0; i < parsed.facilities.length; i++) {
  const f = parsed.facilities[i];
  console.log(`\n  [Fasilitas ${i + 1}]`);
  console.log(`  Pelapor             : ${f.pelapor} [${f.pelapor_type}]`);
  console.log(`  Cabang              : ${f.cabang}`);
  console.log(`  No. Rekening        : ${f.no_rekening}`);
  console.log(`  Baki Debet          : Rp ${f.baki_debet.toLocaleString('id-ID')}`);
  console.log(`  Plafon              : Rp ${f.plafon.toLocaleString('id-ID')}`);
  console.log(`  Kualitas            : ${f.kualitas_label} (KOL ${f.kualitas_kode})`);
  console.log(`  Kondisi             : ${f.kondisi}${f.tanggal_kondisi ? ` per ${f.tanggal_kondisi.toLocaleDateString('id-ID')}` : ''}`);
  console.log(`  Hari Tunggakan      : ${f.jumlah_hari_tunggakan} DPD`);
  console.log(`  Tanggal Akad Awal   : ${f.tanggal_akad_awal?.toLocaleDateString('id-ID') ?? '-'}`);
  console.log(`  Tanggal Akad Akhir  : ${f.tanggal_akad_akhir?.toLocaleDateString('id-ID') ?? '-'}`);
  console.log(`  Tanggal Mulai       : ${f.tanggal_mulai?.toLocaleDateString('id-ID') ?? '-'}`);
  console.log(`  Tanggal Awal Kredit : ${f.tanggal_awal_kredit?.toLocaleDateString('id-ID') ?? '-'}`);
  console.log(`  Tanggal Jatuh Tempo : ${f.tanggal_jatuh_tempo?.toLocaleDateString('id-ID') ?? '-'}`);
  console.log(`  Sifat Kredit        : ${f.sifat_kredit}`);
  console.log(`  Freq. Restrukturisasi: ${f.frekuensi_restrukturisasi}x`);
  console.log(`  Suku Bunga          : ${f.suku_bunga}%`);
  console.log(`  Sebab Macet         : ${f.sebab_macet ?? '-'}`);
  console.log(`  Monthly Strip       : [${f.monthly_quality_strip.map(s => s.quality).join('')}] (${f.monthly_quality_strip.length} bulan)`);
}

// ---- SCORING OUTPUT ----
const scoring = scoreSlikReport(parsed);

console.log(`\n${'═'.repeat(60)}`);
console.log('🏆 ADIRA v4.1 CREDIT SCORING RESULT');
console.log('═'.repeat(60));
console.log(`  Model Version     : ${scoring.model_version}`);
console.log(`  Ref Date          : ${scoring.ref_date}`);
console.log(`\n  [Stage 0 – Validity]`);
console.log(`  Valid             : ${scoring.stage0_validity.is_valid ? '✔ YES' : '✘ NO'}`);
if (scoring.stage0_validity.errors.length) {
  for (const e of scoring.stage0_validity.errors) console.log(`  ⚠ ${e}`);
}
console.log(`\n  [Stage 1 – Profile]`);
console.log(`  File Type         : ${scoring.stage1_profile.file_type}`);
console.log(`  Reason            : ${scoring.stage1_profile.reason}`);
console.log(`  Total Facilities  : ${scoring.stage1_profile.total_facilities}`);
console.log(`\n  [Stage 2 – Knock-Out]`);
if (scoring.stage2_knockout.is_ko) {
  console.log(`  ⛔ KO TRIGGERED: ${scoring.stage2_knockout.triggered_rules.join(', ')}`);
  for (const [k, v] of Object.entries(scoring.stage2_knockout.details)) {
    console.log(`    ${k}: ${v}`);
  }
} else {
  console.log(`  ✔ CLEAN — Tidak ada rule KO yang terpicu`);
}
console.log(`\n  [Stage 3 – Scorecard]`);
console.log(`  Score             : ${scoring.stage3_scoring.score}`);
console.log(`  Grade             : ${scoring.stage3_scoring.grade}`);
console.log(`  Risk Level        : ${scoring.stage3_scoring.risk_level}`);
console.log(`  Decision          : ${scoring.stage3_scoring.decision}`);
console.log(`  Notes             : ${scoring.stage3_scoring.notes}`);
if (scoring.stage3_scoring.breakdown) {
  const b = scoring.stage3_scoring.breakdown;
  console.log(`  Breakdown         :`);
  console.log(`    D1 Kualitas  : ${b.d1_kualitas_recency}`);
  console.log(`    D2 DPD       : ${b.d2_dpd_current}`);
  console.log(`    D3 Restruk   : ${b.d3_restruk}`);
  console.log(`    D4 Konkuren  : ${b.d4_concurrent_dpd30}`);
  console.log(`    D5a Aktif    : ${b.d5a_active_count}`);
  console.log(`    D5b BD Juta  : ${b.d5b_total_baki_juta}`);
}
console.log(`\n  [Diagnostics]`);
console.log(`  Flags             : ${scoring.diagnostic_flags.join(', ') || 'none'}`);
console.log(`  Pelapor Breakdown : Bank=${scoring.pelapor_breakdown.bank} Multifinance=${scoring.pelapor_breakdown.multifinance} Pinjol/BNPL=${scoring.pelapor_breakdown.pinjol_bnpl} Lainnya=${scoring.pelapor_breakdown.lainnya}`);
console.log(`  DG1 Worst Slip    : ${scoring.diagnostic_info.dg1_pelapor_slip_terburuk}`);
console.log(`  Total BD (jt)     : ${scoring.diagnostic_info.total_baki_debet_juta}`);
console.log(`  Baki Flag         : ${scoring.diagnostic_info.baki_flag}`);
console.log(`\n${'═'.repeat(60)}`);
