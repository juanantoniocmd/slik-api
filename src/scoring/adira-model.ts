import type { ParsedSLIK, SLIKFacility } from '../parsers/types';

// =============================================
// OUTPUT INTERFACES
// =============================================

export interface ScorecardBreakdown {
  d1_kualitas_recency: number;
  d2_dpd_current: number;
  d3_restruk: number;
  d4_concurrent_dpd30: number;
  d5a_active_count: number;
  d5b_total_baki_juta: number;
}

export interface CreditScoringResult {
  model_version: 'Adira v4.1';
  ref_date: string;
  stage0_validity: {
    is_valid: boolean;
    errors: string[];
  };
  stage1_profile: {
    file_type: 'CV' | 'THIN' | 'NORMAL';
    reason: string;
    total_facilities: number;
  };
  stage2_knockout: {
    is_ko: boolean;
    triggered_rules: string[];
    details: Record<string, string>;
  };
  stage3_scoring: {
    score: number | null;
    grade: 'A' | 'B' | 'C' | 'D' | 'E' | 'KO' | 'N/A' | 'CV' | 'INVALID';
    risk_level: string;
    decision: string;
    notes: string;
    breakdown?: ScorecardBreakdown;
  };
  diagnostic_flags: string[];
  pelapor_breakdown: {
    bank: number;
    multifinance: number;
    pinjol_bnpl: number;
    lainnya: number;
  };
  diagnostic_info: {
    dg1_pelapor_slip_terburuk: 'Bank' | 'Multifinance' | 'Pinjol_BNPL' | 'NA';
    total_baki_debet_juta: number;
    baki_flag: string;
  };
}

// =============================================
// DATE HELPERS
// =============================================

function getMonthDifference(d1: Date, d2: Date): number {
  return (
    (d2.getFullYear() - d1.getFullYear()) * 12 + (d2.getMonth() - d1.getMonth())
  );
}

function isConditionWithinMonths(
  tanggalKondisi: Date | null,
  refDate: Date,
  months: number,
): boolean {
  if (!tanggalKondisi) return false;
  const diff = getMonthDifference(tanggalKondisi, refDate);
  return diff >= 0 && diff <= months;
}

function hasText(value: string | null | undefined): boolean {
  return typeof value === 'string' && value.trim().length > 0;
}

function isExplicitPengadilanCondition(kondisi: string): boolean {
  const k = (kondisi || '').toLowerCase().trim();
  if (!k) return false;
  // KO-3 hanya untuk kondisi pengadilan yang eksplisit pada status fasilitas,
  // bukan sekadar token "pengadilan" yang bisa muncul akibat noise OCR.
  return /diselesaikan\s+melalui\s+pengadilan|lunas\s*-\s*diselesaikan\s*melalui\s+pengadilan/.test(
    k,
  );
}

function normalizeAlphaNum(value: string | null | undefined): string {
  if (!value) return '';
  return value.replace(/[^A-Za-z0-9]/g, '').trim();
}

function isLcFacility(fac: SLIKFacility): boolean {
  const joined = [fac.jenis_kredit, fac.sifat_kredit, fac.akad, fac.kondisi]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
  return /\bl\/?c\b|letter\s*of\s*credit|skbdn|irrevocable/.test(joined);
}

function isFasilitasLainnya(fac: SLIKFacility): boolean {
  const joined = [
    fac.jenis_kredit,
    fac.sifat_kredit,
    fac.jenis_penggunaan,
    fac.sektor_ekonomi,
    fac.kondisi,
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();

  return /fasilitas\s+lainnya|kredit\s+kelolaan|tagihan\s+akseptasi|kewajiban\s+kepada\s+pemerintah|derivatif|reverse\s*repo/.test(
    joined,
  );
}

function kondisiToOjkCode(kondisi: string): string | null {
  const k = kondisi.toLowerCase();
  if (!k) return null;
  if (k.includes('aktif')) return '00';
  if (k.includes('dibatalkan')) return '01';
  if (k.includes('lunas') && k.includes('diskon')) return '12';
  if (k.includes('lunas') && k.includes('pengambilalihan')) return '05';
  if (k.includes('lunas') && k.includes('pengadilan')) return '06';
  if (k.includes('lunas')) return '02';
  if (k.includes('dihapusbukukan')) return '03';
  if (k.includes('hapus tagih')) return '04';
  if (k.includes('dialihkan') && k.includes('pelapor lain')) return '07';
  if (k.includes('dialihkan') && k.includes('fasilitas lain')) return '08';
  if (k.includes('dialihkan') || k.includes('dijual')) return '09';
  if (k.includes('disekuritisasi') && k.includes('tidak sebagai servicer'))
    return '11';
  if (k.includes('disekuritisasi')) return '10';
  if (k.includes('diblokir')) return '13';
  return null;
}

function validateOjkCoreCompliance(report: ParsedSLIK): {
  errors: string[];
  flags: string[];
} {
  const errors: string[] = [];
  const flags: string[] = [];

  const debtor = report.debitur_pokok[0];
  if (!debtor) {
    errors.push('Kepatuhan OJK D01 gagal: data debitur pokok tidak tersedia');
    flags.push('OJK_D01_MISSING');
    return { errors, flags };
  }

  // D01 core mandatory checks (subset yang tersedia di model parser).
  if (!hasText(debtor.nama)) {
    errors.push('Kepatuhan OJK D01 gagal: nama sesuai identitas wajib terisi');
    flags.push('OJK_D01_NAMA_MISSING');
  }

  const nikClean = (debtor.nik || '').replace(/[^A-Za-z0-9]/g, '');
  if (nikClean.length < 16) {
    errors.push(
      'Kepatuhan OJK D01 gagal: nomor identitas (NIK/Paspor) tidak valid',
    );
    flags.push('OJK_D01_IDENTITAS_INVALID');
  }

  if (!hasText(debtor.jenis_kelamin)) {
    errors.push('Kepatuhan OJK D01 gagal: jenis kelamin wajib terisi');
    flags.push('OJK_D01_GENDER_MISSING');
  }

  if (!hasText(debtor.tempat_lahir) || !debtor.tanggal_lahir) {
    errors.push('Kepatuhan OJK D01 gagal: tempat/tanggal lahir wajib terisi');
    flags.push('OJK_D01_BIRTH_MISSING');
  }

  if (!hasText(debtor.alamat)) {
    errors.push('Kepatuhan OJK D01 gagal: alamat wajib terisi');
    flags.push('OJK_D01_ALAMAT_MISSING');
  }

  // Detail wilayah kini disatukan dalam satu field alamat.
  if (!/\b\d{5}\b/.test(debtor.alamat || '')) {
    flags.push('OJK_D01_KODEPOS_NOT_DETECTED_IN_ALAMAT');
  }

  if (!hasText(debtor.pekerjaan)) {
    errors.push('Kepatuhan OJK D01 gagal: pekerjaan wajib terisi');
    flags.push('OJK_D01_PEKERJAAN_MISSING');
  }

  // if (!hasText(debtor.tempat_bekerja)) {
  // Sesuai pedoman, jika tidak ada tempat bekerja seharusnya diisi "NA".
  // flags.push('OJK_D01_TEMPATKERJA_EMPTY_SHOULD_NA');
  // }

  const facilities = report.facilities || [];
  if (facilities.length === 0) {
    errors.push(
      'Kepatuhan OJK F01 gagal: fasilitas kredit/pembiayaan tidak tersedia',
    );
    flags.push('OJK_F01_MISSING');
    return { errors, flags };
  }

  let invalidNoRekening = 0;
  let invalidKondisi = 0;
  let invalidKolektibilitas = 0;
  let invalidHariTunggakan = 0;
  let invalidNoRekeningFormat = 0;
  const noRekeningUsage = new Map<string, number>();
  const lcFacilities = facilities.filter(isLcFacility);
  const f06Facilities = facilities.filter(isFasilitasLainnya);

  let lcMissingTanggalKeluar = 0;
  let lcMissingTanggalJatuhTempo = 0;
  let lcTanggalInconsistent = 0;
  let lcMissingNomorAkad = 0;
  let lcMissingCabang = 0;
  let lcInvalidPlafon = 0;
  let lcInvalidNominal = 0;
  let lcInvalidKondisiCode = 0;
  let lcInvalidTanggalKondisiRule = 0;

  let f06MissingTanggalMulai = 0;
  let f06MissingTanggalJatuhTempo = 0;
  let f06TanggalInconsistent = 0;
  let f06MissingSukuBunga = 0;
  let f06InvalidNominal = 0;
  let f06InvalidTunggakan = 0;
  let f06InvalidKondisiCode = 0;
  let f06InvalidTanggalKondisiRule = 0;
  let f06InvalidMacetRule = 0;
  let f06MissingCabang = 0;

  for (const fac of facilities) {
    const normalizedNoRek = normalizeAlphaNum(fac.no_rekening);
    if (!normalizedNoRek) {
      invalidNoRekening += 1;
    } else {
      noRekeningUsage.set(
        normalizedNoRek,
        (noRekeningUsage.get(normalizedNoRek) || 0) + 1,
      );
    }

    if (
      hasText(fac.no_rekening) &&
      normalizedNoRek !== fac.no_rekening.trim()
    ) {
      invalidNoRekeningFormat += 1;
    }

    if (!hasText(fac.kondisi)) invalidKondisi += 1;
    if (
      !Number.isInteger(fac.kualitas_kode) ||
      fac.kualitas_kode < 1 ||
      fac.kualitas_kode > 5
    ) {
      invalidKolektibilitas += 1;
    }
    if (
      !Number.isFinite(fac.jumlah_hari_tunggakan) ||
      fac.jumlah_hari_tunggakan < 0
    ) {
      invalidHariTunggakan += 1;
    }

    if (isLcFacility(fac)) {
      if (!fac.tanggal_awal_kredit) lcMissingTanggalKeluar += 1;
      if (!fac.tanggal_jatuh_tempo) lcMissingTanggalJatuhTempo += 1;
      if (
        fac.tanggal_awal_kredit &&
        fac.tanggal_jatuh_tempo &&
        fac.tanggal_jatuh_tempo < fac.tanggal_awal_kredit
      ) {
        lcTanggalInconsistent += 1;
      }
      if (!hasText(fac.akad)) lcMissingNomorAkad += 1;
      if (!hasText(fac.cabang)) lcMissingCabang += 1;
      if (!Number.isFinite(fac.plafon) || fac.plafon <= 0) lcInvalidPlafon += 1;
      if (!Number.isFinite(fac.plafon_awal) || fac.plafon_awal < 0) {
        lcInvalidNominal += 1;
      }

      const kondisiCode = kondisiToOjkCode(fac.kondisi || '');
      if (!kondisiCode) {
        lcInvalidKondisiCode += 1;
      } else {
        const isAktif = kondisiCode === '00';
        const hasTanggalKondisi = !!fac.tanggal_kondisi;
        if (
          (isAktif && hasTanggalKondisi) ||
          (!isAktif && !hasTanggalKondisi)
        ) {
          lcInvalidTanggalKondisiRule += 1;
        }
      }
    }

    if (isFasilitasLainnya(fac)) {
      if (!fac.tanggal_awal_kredit) f06MissingTanggalMulai += 1;
      if (!fac.tanggal_jatuh_tempo) f06MissingTanggalJatuhTempo += 1;
      if (
        fac.tanggal_awal_kredit &&
        fac.tanggal_jatuh_tempo &&
        fac.tanggal_jatuh_tempo < fac.tanggal_awal_kredit
      ) {
        f06TanggalInconsistent += 1;
      }

      if (!Number.isFinite(fac.suku_bunga) || fac.suku_bunga <= 0) {
        f06MissingSukuBunga += 1;
      }

      if (!Number.isFinite(fac.baki_debet) || fac.baki_debet < 0) {
        f06InvalidNominal += 1;
      }

      const tunggakanTotal =
        (Number.isFinite(fac.tunggakan_pokok) ? fac.tunggakan_pokok : 0) +
        (Number.isFinite(fac.tunggakan_bunga) ? fac.tunggakan_bunga : 0);
      if (!Number.isFinite(tunggakanTotal) || tunggakanTotal < 0) {
        f06InvalidTunggakan += 1;
      }

      const kondisiCode = kondisiToOjkCode(fac.kondisi || '');
      if (!kondisiCode) {
        f06InvalidKondisiCode += 1;
      } else {
        const isAktif = kondisiCode === '00';
        const hasTanggalKondisi = !!fac.tanggal_kondisi;
        if (
          (isAktif && hasTanggalKondisi) ||
          (!isAktif && !hasTanggalKondisi)
        ) {
          f06InvalidTanggalKondisiRule += 1;
        }
      }

      const isMacet = fac.kualitas_kode === 5;
      const hasTanggalMacet = !!fac.tanggal_macet;
      const hasSebabMacet = hasText(fac.sebab_macet);
      if (
        (isMacet && (!hasTanggalMacet || !hasSebabMacet)) ||
        (!isMacet && (hasTanggalMacet || hasSebabMacet))
      ) {
        f06InvalidMacetRule += 1;
      }

      if (!hasText(fac.cabang)) f06MissingCabang += 1;
    }
  }

  // const total = facilities.length;
  // const noRekMissingRatio = invalidNoRekening / total;

  // Nomor rekening adalah mandatory F01; invalid jika mayoritas kosong atau seluruhnya kosong.
  // Untuk sampel kecil, jangan langsung invalid agar tidak false reject akibat 1 OCR miss.
  // const severeNoRekGap =
  //   invalidNoRekening === total || (total >= 5 && noRekMissingRatio >= 0.5);

  // if (severeNoRekGap) {
  //   errors.push(
  //     `Kepatuhan OJK F01 gagal: nomor rekening kosong pada ${invalidNoRekening}/${total} fasilitas`,
  //   );
  //   flags.push('OJK_F01_NOREKENING_LOW_COMPLETENESS');
  // } else if (invalidNoRekening > 0) {
  //   flags.push('OJK_F01_NOREKENING_PARTIAL_MISSING');
  // }

  if (invalidKondisi > 0) {
    flags.push('OJK_F01_KONDISI_PARTIAL_MISSING');
  }
  if (invalidNoRekeningFormat > 0) {
    flags.push('OJK_F01_NOREKENING_NORMALIZED_NONALNUM');
  }

  const duplicatedNoRekening = Array.from(noRekeningUsage.values()).filter(
    (count) => count > 1,
  ).length;
  if (duplicatedNoRekening > 0) {
    errors.push(
      `Kepatuhan OJK F01 gagal: ditemukan reuse nomor rekening pada ${duplicatedNoRekening} nilai`,
    );
    flags.push('OJK_F01_NOREKENING_REUSE_DETECTED');
  }

  if (invalidKolektibilitas > 0) {
    errors.push(
      'Kepatuhan OJK F01 gagal: terdapat kode kolektibilitas di luar rentang 1-5',
    );
    flags.push('OJK_F01_KOLEKTIBILITAS_INVALID');
  }
  if (invalidHariTunggakan > 0) {
    errors.push('Kepatuhan OJK F01 gagal: jumlah hari tunggakan tidak valid');
    flags.push('OJK_F01_HARI_TUNGGAKAN_INVALID');
  }

  // F03 (Irrevocable L/C) subset validation based on available fields.
  if (lcFacilities.length > 0) {
    if (lcMissingTanggalKeluar > 0) {
      errors.push(
        `Kepatuhan OJK F03 gagal: tanggal keluar kosong pada ${lcMissingTanggalKeluar}/${lcFacilities.length} fasilitas LC`,
      );
      flags.push('OJK_F03_LC_TGL_KELUAR_MISSING');
    }
    if (lcMissingTanggalJatuhTempo > 0) {
      errors.push(
        `Kepatuhan OJK F03 gagal: tanggal jatuh tempo kosong pada ${lcMissingTanggalJatuhTempo}/${lcFacilities.length} fasilitas LC`,
      );
      flags.push('OJK_F03_LC_TGL_JATUHTEMPO_MISSING');
    }
    if (lcTanggalInconsistent > 0) {
      errors.push(
        'Kepatuhan OJK F03 gagal: terdapat tanggal jatuh tempo lebih awal dari tanggal keluar LC',
      );
      flags.push('OJK_F03_LC_TANGGAL_INCONSISTENT');
    }
    if (lcMissingNomorAkad > 0) {
      flags.push('OJK_F03_LC_NOMOR_AKAD_MISSING');
    }
    if (lcMissingCabang > 0) {
      errors.push(
        'Kepatuhan OJK F03 gagal: kode kantor cabang LC wajib terisi',
      );
      flags.push('OJK_F03_LC_KODE_CABANG_MISSING');
    }
    if (lcInvalidPlafon > 0) {
      errors.push('Kepatuhan OJK F03 gagal: plafon LC wajib > 0');
      flags.push('OJK_F03_LC_PLAFON_INVALID');
    }
    if (lcInvalidNominal > 0) {
      flags.push('OJK_F03_LC_NOMINAL_INVALID');
    }
    if (lcInvalidKondisiCode > 0) {
      errors.push(
        'Kepatuhan OJK F03 gagal: kode kondisi LC tidak dapat dipetakan',
      );
      flags.push('OJK_F03_LC_KONDISI_CODE_INVALID');
    }
    if (lcInvalidTanggalKondisiRule > 0) {
      errors.push(
        'Kepatuhan OJK F03 gagal: aturan tanggal kondisi LC tidak konsisten dengan kode kondisi',
      );
      flags.push('OJK_F03_LC_TGL_KONDISI_RULE_INVALID');
    }

    // Kolom mandatory LC yang belum ada pada model parser saat ini.
    flags.push(
      'OJK_F03_LC_FIELD_GAPS_CIF_JENIS_TUJUAN_VALUTA_COUNTERPARTY_OPERASI',
    );
  }

  // F06 (Fasilitas Lainnya) subset validation based on available fields.
  if (f06Facilities.length > 0) {
    if (f06MissingTanggalMulai > 0) {
      errors.push(
        `Kepatuhan OJK F06 gagal: tanggal mulai kosong pada ${f06MissingTanggalMulai}/${f06Facilities.length} fasilitas`,
      );
      flags.push('OJK_F06_TGL_MULAI_MISSING');
    }
    if (f06MissingTanggalJatuhTempo > 0) {
      errors.push(
        `Kepatuhan OJK F06 gagal: tanggal jatuh tempo kosong pada ${f06MissingTanggalJatuhTempo}/${f06Facilities.length} fasilitas`,
      );
      flags.push('OJK_F06_TGL_JATUHTEMPO_MISSING');
    }
    if (f06TanggalInconsistent > 0) {
      errors.push(
        'Kepatuhan OJK F06 gagal: terdapat tanggal jatuh tempo lebih awal dari tanggal mulai',
      );
      flags.push('OJK_F06_TANGGAL_INCONSISTENT');
    }
    if (f06MissingSukuBunga > 0) {
      errors.push('Kepatuhan OJK F06 gagal: suku bunga/imbalan wajib > 0');
      flags.push('OJK_F06_SUKU_BUNGA_INVALID');
    }
    if (f06InvalidNominal > 0) {
      errors.push('Kepatuhan OJK F06 gagal: nominal fasilitas tidak valid');
      flags.push('OJK_F06_NOMINAL_INVALID');
    }
    if (f06InvalidTunggakan > 0) {
      errors.push('Kepatuhan OJK F06 gagal: nominal tunggakan tidak valid');
      flags.push('OJK_F06_TUNGGAKAN_INVALID');
    }
    if (f06InvalidKondisiCode > 0) {
      errors.push(
        'Kepatuhan OJK F06 gagal: kode kondisi tidak dapat dipetakan',
      );
      flags.push('OJK_F06_KONDISI_CODE_INVALID');
    }
    if (f06InvalidTanggalKondisiRule > 0) {
      errors.push(
        'Kepatuhan OJK F06 gagal: aturan tanggal kondisi tidak konsisten dengan kode kondisi',
      );
      flags.push('OJK_F06_TGL_KONDISI_RULE_INVALID');
    }
    if (f06InvalidMacetRule > 0) {
      errors.push(
        'Kepatuhan OJK F06 gagal: aturan tanggal/sebab macet tidak konsisten dengan kolektibilitas',
      );
      flags.push('OJK_F06_MACET_RULE_INVALID');
    }
    if (f06MissingCabang > 0) {
      errors.push('Kepatuhan OJK F06 gagal: kode kantor cabang wajib terisi');
      flags.push('OJK_F06_KODE_CABANG_MISSING');
    }

    // Mandatory fields F06 yang belum ada pada model parser saat ini.
    flags.push(
      'OJK_F06_FIELD_GAPS_CIF_KODE_JENIS_SUMBER_DANA_VALUTA_NILAI_ASAL_OPERASI',
    );
  }

  // A01 (Agunan) validation
  const agunanList = report.agunan || [];
  if (agunanList.length === 0) {
    flags.push('OJK_A01_NOT_FOUND_OR_NOT_PARSED');
  } else {
    const facilityNoRekeningSet = new Set(
      facilities
        .map((f) => normalizeAlphaNum(f.no_rekening))
        .filter((v) => v.length > 0),
    );

    const registerUsage = new Map<string, number>();
    let a01MissingRegister = 0;
    let a01MissingNoRek = 0;
    let a01NoRekNotLinked = 0;
    let a01MissingCif = 0;
    let a01InvalidSegmen = 0;
    let a01InvalidStatus = 0;
    let a01InvalidJenisAgunan = 0;
    let a01MissingJenisPengikatan = 0;
    let a01MissingTanggalPengikatan = 0;
    let a01MissingPemilik = 0;
    let a01MissingBukti = 0;
    let a01MissingAlamat = 0;
    let a01InvalidKabkota = 0;
    let a01InvalidNilaiNjop = 0;
    let a01InvalidNilaiPelapor = 0;
    let a01InvalidParipasu = 0;
    let a01InvalidPersentaseParipasu = 0;
    let a01InvalidKreditJoin = 0;
    let a01InvalidAsuransi = 0;
    let a01MissingCabang = 0;
    let a01InvalidOperasi = 0;

    for (const ag of agunanList) {
      const reg = normalizeAlphaNum(ag.kode_register_agunan);
      const noRek = normalizeAlphaNum(ag.no_rekening_fasilitas);

      if (!reg) a01MissingRegister += 1;
      else registerUsage.set(reg, (registerUsage.get(reg) || 0) + 1);

      if (!noRek) {
        a01MissingNoRek += 1;
      } else if (!facilityNoRekeningSet.has(noRek)) {
        a01NoRekNotLinked += 1;
      }

      if (!normalizeAlphaNum(ag.no_cif)) a01MissingCif += 1;
      if (!/^F0[1-6]$/.test(ag.kode_jenis_segmen_fasilitas || ''))
        a01InvalidSegmen += 1;
      if (!/^[12]$/.test(ag.kode_status_agunan || '')) a01InvalidStatus += 1;
      if (!/^\d{3}$/.test(ag.kode_jenis_agunan || ''))
        a01InvalidJenisAgunan += 1;

      if (ag.kode_status_agunan === '1') {
        if (!/^\d{2}$/.test(ag.kode_jenis_pengikatan || ''))
          a01MissingJenisPengikatan += 1;
        if (!ag.tanggal_pengikatan) a01MissingTanggalPengikatan += 1;
        if (
          !Number.isFinite(ag.nilai_agunan_njop_wajar) ||
          ag.nilai_agunan_njop_wajar <= 0
        ) {
          a01InvalidNilaiNjop += 1;
        }
        if (
          !Number.isFinite(ag.nilai_agunan_pelapor) ||
          ag.nilai_agunan_pelapor <= 0
        ) {
          a01InvalidNilaiPelapor += 1;
        }
      }

      if (!hasText(ag.nama_pemilik_agunan)) a01MissingPemilik += 1;
      if (!hasText(ag.bukti_kepemilikan)) a01MissingBukti += 1;
      if (!hasText(ag.alamat_agunan)) a01MissingAlamat += 1;
      if (!/^\d{4}$/.test((ag.kode_kabkota_lokasi || '').trim()))
        a01InvalidKabkota += 1;

      if (!/^[YT]$/.test(ag.status_paripasu || '')) a01InvalidParipasu += 1;
      if (ag.status_paripasu === 'Y') {
        if (
          ag.persentase_paripasu === null ||
          !Number.isFinite(ag.persentase_paripasu) ||
          ag.persentase_paripasu <= 0 ||
          ag.persentase_paripasu > 100
        ) {
          a01InvalidPersentaseParipasu += 1;
        }
      }

      if (!/^[YT]$/.test(ag.status_kredit_join || ''))
        a01InvalidKreditJoin += 1;
      if (!/^[YT]$/.test(ag.diasuransikan || '')) a01InvalidAsuransi += 1;
      if (!hasText(ag.kode_kantor_cabang)) a01MissingCabang += 1;
      if (!/^[CUDN]$/.test(ag.operasi_data || '')) a01InvalidOperasi += 1;
    }

    const duplicatedRegister = Array.from(registerUsage.values()).filter(
      (count) => count > 1,
    ).length;

    if (a01MissingRegister > 0 || duplicatedRegister > 0) {
      errors.push(
        'Kepatuhan OJK A01 gagal: kode register/nomor agunan wajib unik dan terisi',
      );
      flags.push('OJK_A01_REGISTER_INVALID_OR_REUSE');
    }
    if (a01MissingNoRek > 0 || a01NoRekNotLinked > 0) {
      errors.push(
        'Kepatuhan OJK A01 gagal: nomor rekening fasilitas agunan wajib terisi dan terhubung ke segmen fasilitas',
      );
      flags.push('OJK_A01_NOREKENING_LINK_INVALID');
    }
    if (a01MissingCif > 0) flags.push('OJK_A01_CIF_MISSING');
    if (a01InvalidSegmen > 0) {
      errors.push(
        'Kepatuhan OJK A01 gagal: kode jenis segmen fasilitas agunan tidak valid',
      );
      flags.push('OJK_A01_SEGMENT_CODE_INVALID');
    }
    if (a01InvalidStatus > 0) {
      errors.push('Kepatuhan OJK A01 gagal: kode status agunan harus 1 atau 2');
      flags.push('OJK_A01_STATUS_INVALID');
    }
    if (a01InvalidJenisAgunan > 0) {
      errors.push('Kepatuhan OJK A01 gagal: kode jenis agunan harus 3 digit');
      flags.push('OJK_A01_JENIS_AGUNAN_INVALID');
    }
    if (a01MissingJenisPengikatan > 0 || a01MissingTanggalPengikatan > 0) {
      errors.push(
        'Kepatuhan OJK A01 gagal: jenis/tanggal pengikatan wajib untuk status agunan tersedia',
      );
      flags.push('OJK_A01_PENGIKATAN_MISSING');
    }
    if (a01MissingPemilik > 0 || a01MissingBukti > 0 || a01MissingAlamat > 0) {
      errors.push(
        'Kepatuhan OJK A01 gagal: data pemilik/bukti/alamat agunan wajib terisi',
      );
      flags.push('OJK_A01_IDENTITAS_AGUNAN_MISSING');
    }
    if (a01InvalidKabkota > 0) {
      errors.push(
        'Kepatuhan OJK A01 gagal: kode kab/kota lokasi agunan wajib 4 digit',
      );
      flags.push('OJK_A01_KABKOTA_INVALID');
    }
    if (a01InvalidNilaiNjop > 0 || a01InvalidNilaiPelapor > 0) {
      errors.push(
        'Kepatuhan OJK A01 gagal: nilai agunan wajib valid untuk status agunan tersedia',
      );
      flags.push('OJK_A01_NILAI_INVALID');
    }
    if (a01InvalidParipasu > 0 || a01InvalidPersentaseParipasu > 0) {
      errors.push(
        'Kepatuhan OJK A01 gagal: status/persentase paripasu tidak valid',
      );
      flags.push('OJK_A01_PARIPASU_INVALID');
    }
    if (a01InvalidKreditJoin > 0) flags.push('OJK_A01_KREDIT_JOIN_INVALID');
    if (a01InvalidAsuransi > 0) flags.push('OJK_A01_ASURANSI_INVALID');
    if (a01MissingCabang > 0) {
      errors.push(
        'Kepatuhan OJK A01 gagal: kode kantor cabang agunan wajib terisi',
      );
      flags.push('OJK_A01_KODE_CABANG_MISSING');
    }
    if (a01InvalidOperasi > 0) {
      errors.push('Kepatuhan OJK A01 gagal: operasi data agunan harus C/U/D/N');
      flags.push('OJK_A01_OPERASI_INVALID');
    }
  }

  return { errors, flags };
}

// =============================================
// MAIN SCORING FUNCTION
// =============================================

export function scoreSlikReport(report: ParsedSLIK): CreditScoringResult {
  const errors: string[] = [];
  const validityErrors: string[] = [];
  const diagnosticFlags: string[] = [];
  const triggeredKOs: string[] = [];
  const koDetails: Record<string, string> = {};

  // -------------------------------------------------------
  // REFERENCE DATE
  // Use tanggal_permintaan from the parsed SLIK as ref date.
  // Fall back to current system time if it's in the future
  // or clearly wrong.
  // -------------------------------------------------------
  const CURRENT_SYSTEM_DATE = new Date();
  CURRENT_SYSTEM_DATE.setHours(0, 0, 0, 0);

  const reportDate = report.tanggal_permintaan;
  const refDate =
    reportDate && reportDate <= CURRENT_SYSTEM_DATE
      ? reportDate
      : CURRENT_SYSTEM_DATE;

  // -------------------------------------------------------
  // STAGE 0: VALIDITY CHECK
  // -------------------------------------------------------

  // 0-1: Report freshness (<= 30 days)
  const daysSinceReport = Math.floor(
    (CURRENT_SYSTEM_DATE.getTime() - reportDate.getTime()) /
      (1000 * 60 * 60 * 24),
  );
  if (daysSinceReport > 30) {
    validityErrors.push(
      `Laporan SLIK kadaluarsa (umur ${daysSinceReport} hari, maksimal 30 hari)`,
    );
    diagnosticFlags.push('VALIDITY_EXPIRED');
  } else if (daysSinceReport < 0) {
    validityErrors.push(
      `Tanggal laporan SLIK di masa depan (${daysSinceReport} hari dari hari ini)`,
    );
    diagnosticFlags.push('VALIDITY_FUTURE_DATE');
  }

  // 0-2: Debtor data completeness
  const primaryDebtor = report.debitur_pokok[0];
  if (!primaryDebtor) {
    errors.push('Data Pokok Debitur tidak ditemukan');
    diagnosticFlags.push('VALIDITY_NO_DEBTOR');
  } else {
    if (!primaryDebtor.nama || primaryDebtor.nama === 'Unknown') {
      errors.push('Nama Debitur tidak valid');
      diagnosticFlags.push('VALIDITY_MISSING_NAMA');
    }
    if (
      !primaryDebtor.nik ||
      primaryDebtor.nik.replace(/\D/g, '').length < 15
    ) {
      errors.push('NIK tidak valid (kurang dari 15 digit)');
      diagnosticFlags.push('VALIDITY_INVALID_NIK');
    }
  }

  // 0-3: Parse warnings from PDF
  if (report.parse_warnings.length > 0) {
    diagnosticFlags.push(`PARSE_WARNINGS_${report.parse_warnings.length}`);
  }

  // 0-4: OJK compliance checks (core fields in D01/F01 that exist in parsed model)
  const ojkCompliance = validateOjkCoreCompliance(report);
  if (ojkCompliance.errors.length > 0) {
    const filteredErrors = ojkCompliance.errors.filter((err) => {
      if (report.facilities.length === 0 && err.includes('F01 gagal')) {
        // Untuk skenario CV (0 fasilitas), model v4.1 tetap lanjut ke jalur CV.
        return false;
      }
      return true;
    });
    errors.push(...filteredErrors);
  }
  if (ojkCompliance.flags.length > 0) {
    diagnosticFlags.push(...ojkCompliance.flags);
  }

  const isValid = validityErrors.length === 0;

  // -------------------------------------------------------
  // STAGE 1: CV / THIN FILE DETERMINATION
  // -------------------------------------------------------
  const facilities = report.facilities;
  let fileType: CreditScoringResult['stage1_profile']['file_type'] = 'NORMAL';
  let stage1Reason = 'Total fasilitas >= 4 (normal scoring)';
  if (facilities.length === 0) {
    fileType = 'CV';
    stage1Reason = '0 fasilitas SLIK (Credit Virgin)';
  } else if (facilities.length <= 3) {
    fileType = 'THIN';
    stage1Reason = 'Thin file (1-3 fasilitas), wajib survey';
  }

  // Pelapor breakdown for diagnostics
  const pelaporBreakdown = {
    bank: 0,
    multifinance: 0,
    pinjol_bnpl: 0,
    lainnya: 0,
  };
  for (const fac of facilities) {
    switch (fac.pelapor_type) {
      case 'Bank':
        pelaporBreakdown.bank++;
        break;
      case 'Multifinance':
        pelaporBreakdown.multifinance++;
        break;
      case 'Pinjol_BNPL':
        pelaporBreakdown.pinjol_bnpl++;
        break;
      default:
        pelaporBreakdown.lainnya++;
        break;
    }
  }

  // Pinjol flag
  if (pelaporBreakdown.pinjol_bnpl > 0) {
    diagnosticFlags.push(
      `PINJOL_BNPL_DETECTED_${pelaporBreakdown.pinjol_bnpl}`,
    );
  }

  const isActiveFacility = (fac: SLIKFacility): boolean => {
    const kondisiLower = (fac.kondisi || '').toLowerCase();
    return !(
      kondisiLower.includes('lunas') ||
      kondisiLower.includes('selesai') ||
      kondisiLower.includes('dibatalkan') ||
      kondisiLower.includes('dijual') ||
      kondisiLower.includes('dialihkan') ||
      kondisiLower.includes('disekuritisasi')
    );
  };

  const isPinjolBnplOrCc = (fac: SLIKFacility): boolean => {
    const kreditType = (fac.jenis_kredit || '').toLowerCase();
    return (
      fac.pelapor_type === 'Pinjol_BNPL' || kreditType.includes('kartu kredit')
    );
  };

  // K1 smart filter: noise-out pinjol kecil.
  const pinjolCcFacilities = facilities.filter(isPinjolBnplOrCc);
  const totalPinjolCcBaki = pinjolCcFacilities.reduce(
    (sum, fac) => sum + fac.baki_debet,
    0,
  );
  const shouldNoiseOutPinjol =
    totalPinjolCcBaki <= 5_000_000 && pinjolCcFacilities.length <= 2;
  const qualifiedForK1 = facilities.filter((fac) => {
    if (!isPinjolBnplOrCc(fac)) return true;
    return !shouldNoiseOutPinjol;
  });
  if (shouldNoiseOutPinjol && pinjolCcFacilities.length > 0) {
    diagnosticFlags.push('K1_SMART_FILTER_PINJOL_NOISE_OUT');
  }

  const activeFacilities = facilities.filter(isActiveFacility);
  const qualifiedActiveFacilities = qualifiedForK1.filter(isActiveFacility);

  const worstQualityActive = Math.max(
    1,
    ...qualifiedActiveFacilities.map((fac) => fac.kualitas_kode || 1),
  );
  const maxDpdCurrent = Math.max(
    0,
    ...qualifiedActiveFacilities.map((fac) => fac.jumlah_hari_tunggakan || 0),
  );
  const concurrentDpd30Count = activeFacilities.filter(
    (fac) => (fac.jumlah_hari_tunggakan || 0) > 30,
  ).length;

  // D1b recency: apakah kualitas terburuk muncul pada 3 bulan terakhir.
  let isWorstQualityRecent = false;
  for (const fac of qualifiedActiveFacilities) {
    const recentThree = fac.monthly_quality_strip.slice(-3);
    if (recentThree.some((entry) => entry.quality === worstQualityActive)) {
      isWorstQualityRecent = true;
      break;
    }
  }

  const maxRestrukFreq = Math.max(
    0,
    ...facilities.map((fac) => fac.frekuensi_restrukturisasi || 0),
  );
  const activeRestrukCount = activeFacilities.filter((fac) =>
    (fac.sifat_kredit || '').toLowerCase().includes('restrukturisasi'),
  ).length;
  const restrukMetric = Math.max(maxRestrukFreq, activeRestrukCount);

  // -------------------------------------------------------
  // STAGE 2: KO (KNOCK-OUT) FAST-PATH
  // -------------------------------------------------------

  for (const fac of facilities) {
    const kondisiLower = (fac.kondisi || '').toLowerCase();
    const isQualifiedActive =
      isActiveFacility(fac) && qualifiedForK1.some((q) => q === fac);

    // KO-1: DPD>90 + BD>5jt (aktif, qualified K1).
    if (
      isQualifiedActive &&
      fac.jumlah_hari_tunggakan > 90 &&
      fac.baki_debet > 5_000_000
    ) {
      triggeredKOs.push('KO-1');
      koDetails['KO-1'] =
        `DPD ${fac.jumlah_hari_tunggakan} + BD ${fac.baki_debet.toLocaleString('id-ID')} pada ${fac.pelapor}`;
    }

    // KO-2: Dihapusbukukan <=36 bulan (hapus tagih tidak termasuk).
    if (
      kondisiLower.includes('dihapusbukukan') &&
      isConditionWithinMonths(fac.tanggal_kondisi, refDate, 36)
    ) {
      triggeredKOs.push('KO-2');
      koDetails['KO-2'] =
        `Dihapusbukukan ${fac.tanggal_kondisi?.toLocaleDateString('id-ID')} di ${fac.pelapor}`;
    }

    // KO-3: Pengadilan (auto KO, no window) - explicit condition only.
    if (isExplicitPengadilanCondition(fac.kondisi || '')) {
      triggeredKOs.push('KO-3');
      koDetails['KO-3'] = `History pengadilan terdeteksi pada ${fac.pelapor}`;
    }

    // KO-4: AYDA <=24 bulan.
    if (
      kondisiLower.includes('pengambilalihan agunan') &&
      isConditionWithinMonths(fac.tanggal_kondisi, refDate, 24)
    ) {
      triggeredKOs.push('KO-4');
      koDetails['KO-4'] =
        `${fac.kondisi} per ${fac.tanggal_kondisi?.toLocaleDateString('id-ID')} di ${fac.pelapor}`;
    }

    // KO-5: Lunas Diskon LEASING <=24 bulan (multifinance only).
    if (
      kondisiLower.includes('diskon') &&
      fac.pelapor_type === 'Multifinance' &&
      isConditionWithinMonths(fac.tanggal_kondisi, refDate, 24)
    ) {
      triggeredKOs.push('KO-5');
      koDetails['KO-5'] =
        `${fac.kondisi} per ${fac.tanggal_kondisi?.toLocaleDateString('id-ID')} di ${fac.pelapor}`;
    }

    // KO-6: Itikad Tidak Baik dalam 36 bulan
    const sebabMacetLower = (fac.sebab_macet || '').toLowerCase();
    if (
      sebabMacetLower.includes('itikad tidak baik') ||
      sebabMacetLower.includes('itikad')
    ) {
      const macetDate = fac.tanggal_macet || fac.tanggal_kondisi;
      if (isConditionWithinMonths(macetDate, refDate, 36)) {
        triggeredKOs.push('KO-6');
        koDetails['KO-6'] =
          `Sebab Macet: "${fac.sebab_macet}" per ${macetDate?.toLocaleDateString('id-ID')} di ${fac.pelapor}`;
      }
    }
  }

  // KO-7: >=4 fasilitas aktif DPD>30 konkuren.
  if (concurrentDpd30Count >= 4) {
    triggeredKOs.push('KO-7');
    koDetails['KO-7'] =
      `${concurrentDpd30Count} fasilitas aktif DPD>30 konkuren`;
  }

  // Deduplicate triggered KOs
  const uniqueKOs = [...new Set(triggeredKOs)];
  const isKO = uniqueKOs.length > 0;

  // -------------------------------------------------------
  // STAGE 3: FULL SCORING (ADIRA v4.1)
  // -------------------------------------------------------

  let score: number | null = null;
  let grade: CreditScoringResult['stage3_scoring']['grade'] = 'E';
  let riskLevel = 'SANGAT TINGGI';
  let decision = '❌ TOLAK';
  let notes = 'Proceed ke verifikasi income, DSR, uang muka sesuai grade.';
  let breakdown: ScorecardBreakdown | undefined;
  const totalBakiDebetJuta =
    report.ringkasan_fasilitas.baki_debet_total / 1_000_000;
  if (isKO) {
    grade = 'KO';
    riskLevel = 'KNOCKOUT';
    decision = '⛔ TOLAK OTOMATIS';
    notes = 'Lihat KO_Check. Catat KO# di dosir untuk audit.';
    score = null;
    diagnosticFlags.push('KO_FAST_PATH_REJECTION');
  } else if (!isValid) {
    grade = 'INVALID';
    riskLevel = 'INVALID SLIK';
    decision = '📛 RE-REQUEST SLIK';
    notes =
      'Tanggal laporan SLIK tidak valid untuk scoring (harus <=30 hari dan tidak boleh masa depan). Re-request OJK sebelum lanjut.';
    score = null;
  } else if (fileType === 'CV') {
    grade = 'CV';
    riskLevel = 'CREDIT VIRGIN';
    decision = '↪ ALIHKAN — JALUR NON-SLIK';
    notes = 'Tidak ada riwayat SLIK. Jalur non-SLIK terpisah.';
    score = null;
  } else if (fileType === 'THIN') {
    grade = 'N/A';
    riskLevel = 'THIN FILE — WAJIB SURVEY';
    decision = '🔍 SURVEY DEALER/CABANG WAJIB';
    notes =
      'Thin File 1-3 fasilitas — data SLIK tidak cukup. Wajib survey lapangan.';
    score = null;
  } else {
    const d1 =
      worstQualityActive === 1
        ? 30
        : worstQualityActive === 2
          ? isWorstQualityRecent
            ? 15
            : 22
          : worstQualityActive === 3
            ? isWorstQualityRecent
              ? 4
              : 10
            : worstQualityActive === 4
              ? 2
              : 0;
    const d2 =
      maxDpdCurrent === 0
        ? 25
        : maxDpdCurrent <= 7
          ? 22
          : maxDpdCurrent <= 30
            ? 16
            : maxDpdCurrent <= 60
              ? 8
              : maxDpdCurrent <= 90
                ? 3
                : 0;
    const d3 =
      restrukMetric === 0
        ? 10
        : restrukMetric === 1
          ? 7
          : restrukMetric === 2
            ? 3
            : 0;
    const d4 =
      concurrentDpd30Count === 0
        ? 20
        : concurrentDpd30Count === 1
          ? 13
          : concurrentDpd30Count === 2
            ? 6
            : concurrentDpd30Count === 3
              ? 2
              : 0;
    const d5a =
      activeFacilities.length <= 2
        ? 6
        : activeFacilities.length <= 4
          ? 5
          : activeFacilities.length <= 6
            ? 2
            : 0;
    const d5b =
      totalBakiDebetJuta <= 50
        ? 9
        : totalBakiDebetJuta <= 150
          ? 6
          : totalBakiDebetJuta <= 300
            ? 2
            : 0;

    score = d1 + d2 + d3 + d4 + d5a + d5b;
    breakdown = {
      d1_kualitas_recency: d1,
      d2_dpd_current: d2,
      d3_restruk: d3,
      d4_concurrent_dpd30: d4,
      d5a_active_count: d5a,
      d5b_total_baki_juta: d5b,
    };

    if (score >= 80) {
      grade = 'A';
      riskLevel = 'RENDAH';
      decision = '✅ SETUJUI';
    } else if (score >= 65) {
      grade = 'B';
      riskLevel = 'SEDANG';
      decision = '✅ SETUJUI DENGAN SYARAT';
    } else if (score >= 50) {
      grade = 'C';
      riskLevel = 'MENINGKAT';
      decision = '⚠ ESKALASI KOMITE CABANG';
    } else if (score >= 35) {
      grade = 'D';
      riskLevel = 'TINGGI';
      decision = '❌ TOLAK (override BM+ACH)';
    } else {
      grade = 'E';
      riskLevel = 'SANGAT TINGGI';
      decision = '❌ TOLAK';
    }
    if (totalBakiDebetJuta > 300) {
      notes =
        'Total exposure >Rp 300jt — overleveraged untuk segmen motor 20-45jt. DSR check ketat.';
    }
  }

  // DG1: pelapor slip terburuk (DPD>0 atau KOL>=2).
  let dg1Pelapor: CreditScoringResult['diagnostic_info']['dg1_pelapor_slip_terburuk'] =
    'NA';
  let worstSlipScore = -1;
  for (const fac of facilities) {
    const hasSlip = fac.jumlah_hari_tunggakan > 0 || fac.kualitas_kode >= 2;
    if (!hasSlip) continue;
    const slipScore = fac.jumlah_hari_tunggakan * 10 + fac.kualitas_kode;
    if (slipScore > worstSlipScore) {
      worstSlipScore = slipScore;
      if (
        fac.pelapor_type === 'Bank' ||
        fac.pelapor_type === 'Multifinance' ||
        fac.pelapor_type === 'Pinjol_BNPL'
      ) {
        dg1Pelapor = fac.pelapor_type;
      } else {
        dg1Pelapor = 'NA';
      }
    }
  }

  const bakiFlag =
    totalBakiDebetJuta > 300
      ? '⚠ OVERLEVERAGED — DSR check ketat'
      : totalBakiDebetJuta > 150
        ? '⚠ Watch — verifikasi income tambahan'
        : '✅ Within range';

  return {
    model_version: 'Adira v4.1',
    ref_date: refDate.toISOString().split('T')[0],
    stage0_validity: {
      is_valid: isValid,
      errors: [...validityErrors, ...errors],
    },
    stage1_profile: {
      file_type: fileType,
      reason: stage1Reason,
      total_facilities: facilities.length,
    },
    stage2_knockout: {
      is_ko: isKO,
      triggered_rules: uniqueKOs,
      details: koDetails,
    },
    stage3_scoring: {
      score,
      grade,
      risk_level: riskLevel,
      decision,
      notes,
      breakdown,
    },
    diagnostic_flags: diagnosticFlags,
    pelapor_breakdown: pelaporBreakdown,
    diagnostic_info: {
      dg1_pelapor_slip_terburuk: dg1Pelapor,
      total_baki_debet_juta: totalBakiDebetJuta,
      baki_flag: bakiFlag,
    },
  };
}
