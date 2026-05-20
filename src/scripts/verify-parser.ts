import { parseSlikText } from "../parsers/pdf-parser";

// Mock realistic SLIK text content based on actual OJK SLIK reports
const mockSlikText = `
SISTEM LAYANAN INFORMASI KEUANGAN (SLIK) - IDEB KU
--------------------------------------------------
DATA POKOK DEBITUR:
Nama Debitur       : BUDI UTOMO
Nomor Identitas    : 3174092012850005
Tempat Lahir       : Jakarta
Tanggal Lahir      : 20-12-1985
Jenis Kelamin      : Laki-laki
NPWP               : 09.254.321.4-012.000
Alamat             : Jl. Sudirman No. 45, Jakarta Selatan

RINGKASAN FASILITAS:
Total Plafon       : 125.000.000,00
Total Baki Debet   : 85.000.000,00

DETIL FASILITAS KREDIT:

Fasilitas ke-1
Lembaga Jasa Keuangan : BANK MANDIRI (PERSERO) Tbk
Jenis Fasilitas       : KREDIT PEMILIKAN RUMAH (KPR)
Plafon                : 100.000.000
Baki Debet            : 75.000.000,00
Kolektibilitas        : 1 - Lancar
Tanggal Mulai         : 15-05-2023
Tanggal Jatuh Tempo   : 15-05-2033
Tunggakan Pokok       : 0
Tunggakan Bunga       : 0
Hari Tunggakan        : 0
Kondisi               : 00 - AKTIF

Fasilitas ke-2
Lembaga Jasa Keuangan : PT ADIRA DINAMIKA MULTI FINANCE Tbk
Jenis Fasilitas       : PEMBIAYAAN KONSUMEN
Plafon                : 25.000.000,00
Baki Debet            : 10.000.000
Kolektibilitas        : 2 - DALAM PERHATIAN KHUSUS
Tanggal Mulai         : 01-10-2024
Tanggal Jatuh Tempo   : 01-10-2027
Tunggakan Pokok       : 2.000.000,00
Tunggakan Bunga       : 150.000,00
Hari Tunggakan        : 45
Kondisi               : 00 - AKTIF
`;

console.log("=== STARTING SLIK PARSER VERIFICATION ===");

try {
  const result = parseSlikText(mockSlikText);

  console.log("\n[DEBTOR INFO]");
  console.log(`Nama:          ${result.debtor.nama}`);
  console.log(`NIK:           ${result.debtor.nik}`);
  console.log(`Tempat Lahir:  ${result.debtor.tempatLahir}`);
  console.log(`Tanggal Lahir: ${result.debtor.tanggalLahir}`);
  console.log(`Jenis Kelamin: ${result.debtor.jenisKelamin}`);
  console.log(`NPWP:          ${result.debtor.npwp}`);
  console.log(`Alamat:        ${result.debtor.alamat}`);

  console.log("\n[FACILITIES]");
  result.facilities.forEach((fac, index) => {
    console.log(`\nFasilitas #${index + 1}:`);
    console.log(`  Kreditur:       ${fac.kreditur}`);
    console.log(`  Jenis:          ${fac.jenisFasilitas}`);
    console.log(`  Plafon:         Rp ${fac.plafon.toLocaleString('id-ID')}`);
    console.log(`  Baki Debet:     Rp ${fac.bakiDebet.toLocaleString('id-ID')}`);
    console.log(`  KOL:            ${fac.kol}`);
    console.log(`  Tanggal Mulai:  ${fac.tanggalMulai}`);
    console.log(`  Tunggakan:      Rp ${fac.tunggakanPokok.toLocaleString('id-ID')} (Pokok) / Rp ${fac.tunggakanBunga.toLocaleString('id-ID')} (Bunga)`);
    console.log(`  Hari Tunggakan: ${fac.hariTunggakan} DPD`);
    console.log(`  Status/Kondisi: ${fac.kondisi}`);
  });

  console.log("\n[SUMMARY STATS]");
  console.log(`Total Fasilitas:  ${result.summary.totalFasilitas}`);
  console.log(`Total Plafon:     Rp ${result.summary.totalPlafon.toLocaleString('id-ID')}`);
  console.log(`Total Baki Debet: Rp ${result.summary.totalBakiDebet.toLocaleString('id-ID')}`);
  console.log(`Total Tunggakan:  Rp ${result.summary.totalTunggakan.toLocaleString('id-ID')}`);
  console.log(`KOL Terburuk:     KOL ${result.summary.kolTerburuk}`);

  // Assertions to verify correctness
  console.log("\n[RUNNING ASSERTIONS]");
  let errors = 0;

  if (result.debtor.nama !== "BUDI UTOMO") {
    console.error("❌ Assert failed: debtor.nama is not 'BUDI UTOMO'");
    errors++;
  }
  if (result.debtor.nik !== "3174092012850005") {
    console.error("❌ Assert failed: debtor.nik is not '3174092012850005'");
    errors++;
  }
  if (result.facilities.length !== 2) {
    console.error(`❌ Assert failed: facilities count is ${result.facilities.length}, expected 2`);
    errors++;
  } else {
    if (result.facilities[0].kreditur !== "BANK MANDIRI (PERSERO) Tbk") {
      console.error("❌ Assert failed: facility 1 kreditur is incorrect");
      errors++;
    }
    if (result.facilities[1].kol !== 2) {
      console.error("❌ Assert failed: facility 2 KOL is not 2");
      errors++;
    }
    if (result.facilities[1].hariTunggakan !== 45) {
      console.error("❌ Assert failed: facility 2 DPD is not 45");
      errors++;
    }
  }

  if (result.summary.kolTerburuk !== 2) {
    console.error(`❌ Assert failed: kolTerburuk is ${result.summary.kolTerburuk}, expected 2`);
    errors++;
  }

  if (errors === 0) {
    console.log("✅ ALL ASSERTIONS PASSED! Slik parser regex logic is working perfectly!");
  } else {
    console.error(`❌ VERIFICATION FAILED with ${errors} error(s)`);
    process.exit(1);
  }

} catch (err) {
  console.error("❌ Script error during verification:", err);
  process.exit(1);
}
