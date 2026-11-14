/**
 * Links the simulator's current conditions to what the NASA PSI data actually say about them.
 * Every card names its investigation; the simulator itself is a model, the cards are evidence.
 */
export interface SimParams { gravity: number; ventSpeed: number; o2: number; pressureKpa: number; material: { id: string; limitO2: number } }

export interface EvidenceCard {
  tone: "data" | "gap" | "caution";
  title: string;
  text: string;
  accession?: string;
}

export function evidenceFor(p: SimParams): EvidenceCard[] {
  const out: EvidenceCard[] = [];
  const o2 = p.o2 * 100;
  const ventCm = p.ventSpeed * 100;
  if (p.gravity > 0 && p.gravity < 9) {
    out.push({
      tone: "gap", title: "No combustion data at this gravity",
      text: "PSI holds no lunar or martian combustion experiment (LUCI and FM2 are planned). The simulator interpolates physics here; NASA data only bound this case between orbit and Earth.",
      accession: "PSI-22",
    });
  }
  if (p.gravity === 0 && ventCm < 1) {
    out.push({
      tone: "data", title: "Quiescent microgravity — ACME BRE",
      text: "On the ISS, flames emulating burning solids self-extinguished quickly at 21 % O2 without airflow, but kept burning in the elevated-O2 atmospheres planned for future spacecraft (results flagged preliminary).",
      accession: "PSI-20",
    });
  }
  if (p.gravity === 0 && ventCm >= 1) {
    out.push({
      tone: "data", title: "Ventilated microgravity — BASS, SAFFIRE",
      text: `Solid samples burned in forced flows on the ISS (BASS-II, flow settings up to ~49) and in Cygnus (SAFFIRE, 20–30 cm/s). You are at ${ventCm.toFixed(0)} cm/s.`,
      accession: ventCm >= 18 ? "PSI-98" : "PSI-25",
    });
  }
  if (o2 >= 26) {
    out.push({
      tone: "gap", title: "Oxygen-enriched atmosphere: thin evidence",
      text: "Only 9 PSI tests report both O2 and pressure near 34 % / 8.2 psia — all gaseous-fuel flames (CFI-G). No solid cabin material has been burned there in microgravity.",
      accession: "PSI-159",
    });
    out.push({
      tone: "data", title: "More oxygen, fewer self-extinctions — FLEX",
      text: "Methanol droplet flames went out before burnout in 9/12 tests at 21 % O2 but only 2/13 at 30–34 % O2 (N2-only atmospheres).",
      accession: "PSI-69",
    });
  }
  if (o2 < 19) {
    out.push({
      tone: "data", title: "Reduced oxygen — BASS-II",
      text: "BASS-II burned PMMA, cotton-fiberglass and Nomex down to 13.6 % initial O2 to map extinction limits in microgravity.",
      accession: "PSI-25",
    });
  }
  if (p.material.id === "nomex") {
    out.push({
      tone: "data", title: "Material ranking can flip — SAFFIRE-II",
      text: "In SAFFIRE-II, silicone samples barely burned in microgravity at 20 cm/s while 1-g references burned completely; PMMA and SIBAL fabric spread in both. Rank materials in the environment where they will fly.",
      accession: "PSI-99",
    });
  }
  out.push({
    tone: "caution", title: "Detectors and smoke transport — SAME",
    text: p.gravity === 0
      ? "Without buoyancy, smoke goes only where the ventilation carries it: a ceiling detector can stay blind. SAME/SAME-R measured how microgravity smoke differs for detector design."
      : "With gravity, smoke rises to the ceiling first. Microgravity smoke particles differ (SAME/SAME-R), which matters for detector calibration.",
    accession: "PSI-101",
  });
  return out;
}
