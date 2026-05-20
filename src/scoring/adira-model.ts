import type { ParsedSLIK, SLIKFacility } from '../parsers/types';

// =============================================
// OUTPUT INTERFACES
// =============================================

export interface ScorecardBreakdown {
  baseScore: number;
  d1b_recency: number;
  d2_severity: number;
  d3a_restruFreq: number;
  d3b_restruStatus: number;
  d4_creditAge: number;
  d5b_debtBurden: number;
}

export interface CreditScoringResult {
  model_version: 'Adira v4.1';
  ref_date: string;
  stage0_validity: {
    is_valid: boolean;
    errors: string[];
  };
  stage1_profile: {
    is_thin_file: boolean;
    reason: string;
    history_months: number;
    total_facilities: number;
  };
  stage2_knockout: {
    is_ko: boolean;
    triggered_rules: string[];
    details: Record<string, string>;
  };
  stage3_scoring: {
    score: number;
    grade: 'A' | 'B' | 'C' | 'D';
    decision:
      | 'APPROVE'
      | 'APPROVE WITH LIMIT CAP'
      | 'REFER / MANUAL REVIEW'
      | 'REJECT';
    breakdown?: ScorecardBreakdown;
  };
  diagnostic_flags: string[];
  pelapor_breakdown: {
    bank: number;
    multifinance: number;
    pinjol_bnpl: number;
    lainnya: number;
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

  if (!hasText(debtor.kelurahan)) flags.push('OJK_D01_KELURAHAN_MISSING');
  if (!hasText(debtor.kecamatan)) flags.push('OJK_D01_KECAMATAN_MISSING');
  if (!hasText(debtor.kabupaten_kota)) flags.push('OJK_D01_KABKOTA_MISSING');

  if (!/^\d{5}$/.test((debtor.kode_pos || '').trim())) {
    errors.push('Kepatuhan OJK D01 gagal: kode pos wajib 5 digit');
    flags.push('OJK_D01_KODEPOS_INVALID');
  }

  if (!hasText(debtor.pekerjaan)) {
    errors.push('Kepatuhan OJK D01 gagal: pekerjaan wajib terisi');
    flags.push('OJK_D01_PEKERJAAN_MISSING');
  }

  if (!hasText(debtor.tempat_bekerja)) {
    // Sesuai pedoman, jika tidak ada tempat bekerja seharusnya diisi "NA".
    flags.push('OJK_D01_TEMPATKERJA_EMPTY_SHOULD_NA');
  }

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

  const total = facilities.length;
  const noRekMissingRatio = invalidNoRekening / total;

  // Nomor rekening adalah mandatory F01; invalid jika mayoritas kosong atau seluruhnya kosong.
  // Untuk sampel kecil, jangan langsung invalid agar tidak false reject akibat 1 OCR miss.
  const severeNoRekGap =
    invalidNoRekening === total || (total >= 5 && noRekMissingRatio >= 0.5);

  if (severeNoRekGap) {
    errors.push(
      `Kepatuhan OJK F01 gagal: nomor rekening kosong pada ${invalidNoRekening}/${total} fasilitas`,
    );
    flags.push('OJK_F01_NOREKENING_LOW_COMPLETENESS');
  } else if (invalidNoRekening > 0) {
    flags.push('OJK_F01_NOREKENING_PARTIAL_MISSING');
  }

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
    errors.push(
      `Laporan SLIK kadaluarsa (umur ${daysSinceReport} hari, maksimal 30 hari)`,
    );
    diagnosticFlags.push('VALIDITY_EXPIRED');
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
    errors.push(...ojkCompliance.errors);
  }
  if (ojkCompliance.flags.length > 0) {
    diagnosticFlags.push(...ojkCompliance.flags);
  }

  const isValid = errors.length === 0;

  // -------------------------------------------------------
  // STAGE 1: CV / THIN FILE DETERMINATION
  // -------------------------------------------------------
  // Thin file = < 2 fasilitas OR riwayat kredit < 6 bulan

  const facilities = report.facilities;
  let oldestCreditDate: Date | null = null;

  for (const fac of facilities) {
    const startDate = fac.tanggal_awal_kredit;
    if (startDate && (!oldestCreditDate || startDate < oldestCreditDate)) {
      oldestCreditDate = startDate;
    }
  }

  const historyMonths = oldestCreditDate
    ? getMonthDifference(oldestCreditDate, refDate)
    : 0;

  let isThinFile = false;
  let thinReason = 'Kriteria thick file terpenuhi';

  if (facilities.length < 2) {
    isThinFile = true;
    thinReason = `Jumlah fasilitas kurang dari 2 (total: ${facilities.length})`;
    diagnosticFlags.push('THIN_FILE_FEW_FACILITIES');
  } else if (historyMonths < 6) {
    isThinFile = true;
    thinReason = `Riwayat kredit kurang dari 6 bulan (${historyMonths} bulan)`;
    diagnosticFlags.push('THIN_FILE_SHORT_HISTORY');
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

  // -------------------------------------------------------
  // STAGE 2: KO (KNOCK-OUT) FAST-PATH
  // -------------------------------------------------------

  for (const fac of facilities) {
    const kondisiLower = (fac.kondisi || '').toLowerCase();
    const isClosed =
      kondisiLower.includes('lunas') || kondisiLower.includes('selesai');
    const isRestructured =
      (fac.sifat_kredit || '').toLowerCase().includes('restrukturisasi') ||
      fac.frekuensi_restrukturisasi > 0;

    // KO-1: Current delinquency (KOL >= 3 atau DPD > 90 pada fasilitas aktif)
    if (
      !isClosed &&
      (fac.kualitas_kode >= 3 || fac.jumlah_hari_tunggakan > 90)
    ) {
      triggeredKOs.push('KO-1');
      koDetails['KO-1'] =
        `KOL ${fac.kualitas_kode} / DPD ${fac.jumlah_hari_tunggakan} hari pada ${fac.pelapor}`;
    }

    // KO-2: Fasilitas aktif yang sedang dalam status restrukturisasi
    if (!isClosed && isRestructured) {
      triggeredKOs.push('KO-2');
      koDetails['KO-2'] =
        `Fasilitas aktif direstrukturisasi (${fac.frekuensi_restrukturisasi}x) pada ${fac.pelapor}`;
    }

    // KO-3: Lunas Dengan Diskon dalam 12 bulan terakhir
    if (
      kondisiLower.includes('diskon') &&
      isConditionWithinMonths(fac.tanggal_kondisi, refDate, 12)
    ) {
      triggeredKOs.push('KO-3');
      koDetails['KO-3'] =
        `Lunas Dengan Diskon ${fac.tanggal_kondisi?.toLocaleDateString('id-ID')} di ${fac.pelapor}`;
    }

    // KO-4: Dihapusbukukan / Hapus Tagih dalam 24 bulan terakhir
    if (
      (kondisiLower.includes('hapusbukukan') ||
        kondisiLower.includes('hapus tagih')) &&
      isConditionWithinMonths(fac.tanggal_kondisi, refDate, 24)
    ) {
      triggeredKOs.push('KO-4');
      koDetails['KO-4'] =
        `${fac.kondisi} per ${fac.tanggal_kondisi?.toLocaleDateString('id-ID')} di ${fac.pelapor}`;
    }

    // KO-5: Lunas via pengadilan / pengambilalihan agunan dalam 24 bulan terakhir
    if (
      (kondisiLower.includes('pengadilan') ||
        kondisiLower.includes('pengambilalihan agunan')) &&
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

  // Deduplicate triggered KOs
  const uniqueKOs = [...new Set(triggeredKOs)];
  const isKO = uniqueKOs.length > 0;

  // -------------------------------------------------------
  // STAGE 3: FULL SCORING (ADIRA v4.1)
  // -------------------------------------------------------

  let score = 0;
  let grade: 'A' | 'B' | 'C' | 'D' = 'D';
  let decision: CreditScoringResult['stage3_scoring']['decision'] = 'REJECT';
  let breakdown: ScorecardBreakdown | undefined;

  if (isKO) {
    score = 0;
    grade = 'D';
    decision = 'REJECT';
    diagnosticFlags.push('KO_FAST_PATH_REJECTION');
  } else if (isThinFile) {
    // ---- THIN FILE SCORECARD ----
    const baseScore = 50;

    // D1b: Max active KOL
    const maxActiveKol = facilities.reduce(
      (m, f) => Math.max(m, f.kualitas_kode),
      1,
    );
    const d1b_recency = maxActiveKol === 1 ? 30 : maxActiveKol === 2 ? 5 : -30;

    // D2: Max DPD
    const maxDpd = facilities.reduce(
      (m, f) => Math.max(m, f.jumlah_hari_tunggakan),
      0,
    );
    const d2_severity = maxDpd === 0 ? 20 : maxDpd <= 30 ? 5 : -25;

    // D5b: Debt burden using ringkasan_fasilitas (pre-aggregated OJK figures)
    const totalBaki = report.ringkasan_fasilitas.baki_debet_total;
    const totalPlafon = report.ringkasan_fasilitas.plafon_efektif_total;
    const debtRatio = totalPlafon > 0 ? totalBaki / totalPlafon : 0;
    const d5b_debtBurden = totalBaki === 0 ? 15 : debtRatio <= 0.5 ? 10 : -10;

    score = baseScore + d1b_recency + d2_severity + d5b_debtBurden;

    if (score >= 90) {
      grade = 'B';
      decision = 'APPROVE WITH LIMIT CAP';
    } else if (score >= 70) {
      grade = 'C';
      decision = 'REFER / MANUAL REVIEW';
    } else {
      grade = 'D';
      decision = 'REJECT';
    }

    breakdown = {
      baseScore,
      d1b_recency,
      d2_severity,
      d3a_restruFreq: 0,
      d3b_restruStatus: 0,
      d4_creditAge: 0,
      d5b_debtBurden,
    };
  } else {
    // ---- THICK FILE FULL SCORECARD ----
    const baseScore = 40;

    // D1b: Worst historical KOL from monthly_quality_strip across ALL facilities
    let maxHistoricalKol = 1;
    for (const fac of facilities) {
      let facilityMaxKol = Math.max(1, Math.min(5, fac.kualitas_kode || 1));

      for (const entry of fac.monthly_quality_strip) {
        const qRaw = Number(entry.quality);
        if (!Number.isFinite(qRaw)) continue;
        const q = Math.max(1, Math.min(5, Math.round(qRaw)));
        if (q > facilityMaxKol) facilityMaxKol = q;
      }

      if (facilityMaxKol > maxHistoricalKol) maxHistoricalKol = facilityMaxKol;
    }
    const d1b_recency =
      maxHistoricalKol === 1
        ? 35
        : maxHistoricalKol === 2
          ? 15
          : maxHistoricalKol === 3
            ? -10
            : -35;

    // D2: Worst DPD ever recorded
    const maxDpd = facilities.reduce(
      (m, f) => Math.max(m, f.jumlah_hari_tunggakan),
      0,
    );
    const d2_severity =
      maxDpd === 0 ? 25 : maxDpd <= 30 ? 10 : maxDpd <= 90 ? -15 : -40;

    // D3a: Total restructuring frequency
    const totalRestruCount = facilities.reduce(
      (s, f) => s + f.frekuensi_restrukturisasi,
      0,
    );
    const d3a_restruFreq =
      totalRestruCount === 0 ? 15 : totalRestruCount === 1 ? -5 : -25;

    // D3b: Any facility ever restructured
    const hasRestructured = facilities.some(
      (f) =>
        f.sifat_kredit.toLowerCase().includes('restrukturisasi') ||
        f.frekuensi_restrukturisasi > 0,
    );
    const d3b_restruStatus = hasRestructured ? -20 : 10;

    // D4: Age of oldest credit
    const d4_creditAge = historyMonths > 36 ? 20 : historyMonths >= 12 ? 10 : 5;

    // D5b: Debt burden using pre-aggregated OJK ringkasan (most accurate)
    const totalBaki = report.ringkasan_fasilitas.baki_debet_total;
    const totalPlafon = report.ringkasan_fasilitas.plafon_efektif_total;
    const debtRatio = totalPlafon > 0 ? totalBaki / totalPlafon : 0;
    const d5b_debtBurden =
      totalBaki === 0 ? 20 : debtRatio <= 0.3 ? 15 : debtRatio <= 0.7 ? 5 : -15;

    score =
      baseScore +
      d1b_recency +
      d2_severity +
      d3a_restruFreq +
      d3b_restruStatus +
      d4_creditAge +
      d5b_debtBurden;

    if (score >= 115) {
      grade = 'A';
      decision = 'APPROVE';
    } else if (score >= 90) {
      grade = 'B';
      decision = 'APPROVE';
    } else if (score >= 60) {
      grade = 'C';
      decision = 'REFER / MANUAL REVIEW';
    } else {
      grade = 'D';
      decision = 'REJECT';
    }

    breakdown = {
      baseScore,
      d1b_recency,
      d2_severity,
      d3a_restruFreq,
      d3b_restruStatus,
      d4_creditAge,
      d5b_debtBurden,
    };
  }

  return {
    model_version: 'Adira v4.1',
    ref_date: refDate.toISOString().split('T')[0],
    stage0_validity: { is_valid: isValid, errors },
    stage1_profile: {
      is_thin_file: isThinFile,
      reason: thinReason,
      history_months: historyMonths,
      total_facilities: facilities.length,
    },
    stage2_knockout: {
      is_ko: isKO,
      triggered_rules: uniqueKOs,
      details: koDetails,
    },
    stage3_scoring: { score, grade, decision, breakdown },
    diagnostic_flags: diagnosticFlags,
    pelapor_breakdown: pelaporBreakdown,
  };
}
