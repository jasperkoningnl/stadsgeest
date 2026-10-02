const MIB = 1024 * 1024;

export function grootteUitTitel(titel) {
  const match = String(titel || '').match(/(?:^|\s)(\d+(?:[.,]\d+)?)\s*MB(?:\s|$)/i);
  return match ? Number(match[1].replace(',', '.')) * MIB : null;
}

export function isGroteBijlageKandidaat({ status, bytes, titel, grotePogingen = 0 }, {
  standaardLimiet = 40 * MIB,
  maxPogingen = 3,
} = {}) {
  if (Number(grotePogingen || 0) >= maxPogingen) return false;
  if (status === 'te_groot') return true;
  if (status !== 'fout') return false;
  const bekendeGrootte = Number(bytes || 0) || grootteUitTitel(titel) || 0;
  return bekendeGrootte > standaardLimiet;
}

export { MIB };
