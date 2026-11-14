# Demo script (≈ 2 min live, or cut to 30 s for the video)

## 30-second video

| Time | Screen | Voice-over / caption |
|---|---|---|
| 0–5 s | Mission control: rotate to the ISS, click it, list of experiments by rack | "NASA has burned things in space for decades. Fire Lab puts all of it in one place." |
| 5–14 s | Simulation: preset *Earth reference* → Ignite (yellow plume, ceiling alarm 4 s) → preset *ISS, ventilation shut down* → Ignite (blue ball, self-extinguishes, no alarm) | "Without gravity, smoke doesn't rise and flames starve — unless air moves." |
| 14–22 s | Preset *34 % O2 cabin, ventilation off* → the flame keeps burning; evidence panel: ACME BRE + "only 9 tests" | "Future Moon bases will breathe oxygen-rich air. There, cutting ventilation may not be enough — and NASA has almost no data." |
| 22–27 s | Find evidence ranking + Extract ZIP | "Every result traces back to a NASA dataset, file and DOI." |
| 27–30 s | Logo + "Making the next giant leap a safer one" | |

## Live demo (judges)

1. **Overview.** Move the gravity slider (Earth → Moon → Orbit) and turn on ventilation. Say: *"In orbit, ventilation becomes the wind that feeds a fire."* Then point at the gap list: the 34 % atmosphere has no solid- or liquid-fuel test.
2. **Find evidence → example "Moon base at 34% O2…".**
   - Show the parsed chips (need, habitat, O2, pressure).
   - Open BASS-II's reasoning: gravity is *bounded only*, O2 is *outside range*, pressure is *not reported*.
   - Point out: *"Unknown stays unknown."*
3. **Switch the need to Extinction.** FLEX jumps to the top. Switch to Detection: SAME-R. *"The ranking understands a need, not a keyword."*
4. **Conditions map.** Show the dashed habitat boxes and the strip of solid-fuel tests that report O2 only.
5. **Extract data.** Select FLEX and set O2 between 20 and 35 %. Show the FLEX reference analysis: extinction before burnout drops as O2 rises. Download the ZIP and open `provenance.json`.
6. **Safety insights & Ask.** Ask *"Is cutting ventilation enough to stop a fire in a Moon base at 34% oxygen?"*. Click a citation to show the source.
7. **Method & sources.** Point out the quality flags, the ranking rules, the DOIs and the AI disclosure.

## Award mapping

- **Best Use of Science**: physics-aware condition fit, partial gravity treated as a bound, descriptive fits with their domain, quality flags.
- **Best Use of Data**: first unified, traceable dataset across 24 PSI investigations, with ZIP export, dictionary and DOIs.
- **Galactic Impact**: Moon-base atmosphere gap analysis, and the Earth transfers to confined spaces.
- **Storytelling**: Flame Lab, the incident timeline, and insight cards that run from observation to design question.
