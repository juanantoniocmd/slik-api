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
  console.log(`  Alamat     : ${d.alamat}, ${d.kelurahan}, ${d.kecamatan}, ${d.kabupaten_kota} ${d.kode_pos}`);
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
console.log(`  Thin File         : ${scoring.stage1_profile.is_thin_file ? 'YES' : 'NO'}`);
console.log(`  Reason            : ${scoring.stage1_profile.reason}`);
console.log(`  Total Facilities  : ${scoring.stage1_profile.total_facilities}`);
console.log(`  History           : ${scoring.stage1_profile.history_months} bulan`);
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
console.log(`  Decision          : ${scoring.stage3_scoring.decision}`);
if (scoring.stage3_scoring.breakdown) {
  const b = scoring.stage3_scoring.breakdown;
  console.log(`  Breakdown         :`);
  console.log(`    Base Score   : ${b.baseScore}`);
  console.log(`    D1b Recency  : ${b.d1b_recency}`);
  console.log(`    D2 Severity  : ${b.d2_severity}`);
  console.log(`    D3a RestruFq : ${b.d3a_restruFreq}`);
  console.log(`    D3b Restruct : ${b.d3b_restruStatus}`);
  console.log(`    D4 CreditAge : ${b.d4_creditAge}`);
  console.log(`    D5b DebtLoad : ${b.d5b_debtBurden}`);
}
console.log(`\n  [Diagnostics]`);
console.log(`  Flags             : ${scoring.diagnostic_flags.join(', ') || 'none'}`);
console.log(`  Pelapor Breakdown : Bank=${scoring.pelapor_breakdown.bank} Multifinance=${scoring.pelapor_breakdown.multifinance} Pinjol/BNPL=${scoring.pelapor_breakdown.pinjol_bnpl} Lainnya=${scoring.pelapor_breakdown.lainnya}`);
console.log(`\n${'═'.repeat(60)}`);
