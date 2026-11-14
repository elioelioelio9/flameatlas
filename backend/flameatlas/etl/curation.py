"""Expert curation layer.

Everything here is either (a) a classification decision we make and display openly
(which safety need an investigation serves, its fuel phase...), or (b) a statement that is
traceable to a PSI text field or to the challenge statement. Statements derived from the
experimental tables are computed at build time (see build.py) — not typed here.
"""

from __future__ import annotations

CHALLENGE_URL = "https://www.spaceappschallenge.org/2026/challenges/flame-in-freefall/"

NEEDS = {
    "materials": "Materials & flame spread",
    "extinction": "Extinction & suppression",
    "detection": "Smoke & fire detection",
}

PILLARS = {
    "prevention": "Prevention (ignition sources, material selection, flammability limits)",
    "detection": "Detection (smoke, aerosols, gases)",
    "suppression": "Suppression (agents, ventilation, extinction limits)",
}

# --------------------------------------------------------------------------- investigations
INVESTIGATIONS: dict[str, dict] = {
    "PSI-26": dict(
        family="BASS", fuel_phases=["solid"], configuration="Fabric, PMMA rods/slabs/spheres in the MSG flow duct",
        scale="bench (cm-scale samples)", pillars=["prevention", "suppression"],
        needs={"materials": 1.0, "extinction": 0.6},
        key_variables=["material", "geometry", "thickness", "flow speed", "flow direction (opposed/concurrent)", "inert agent (N2)"],
        sensors=["video cameras", "radiometer"],
        summary=("Flame spread and extinction over realistic solid fuels (cotton-fiberglass fabric, PMMA in several "
                 "geometries, Nomex) in low-speed forced flow aboard the ISS. Built to bridge the gap between the "
                 "1-g NASA-STD-6001 Test 1 screening method and real microgravity flammability, and to test an "
                 "inert gaseous extinguishing agent."),
    ),
    "PSI-25": dict(
        family="BASS", fuel_phases=["solid"], configuration="PMMA films, slabs, rods, spherical sections; SIBAL; Nomex",
        scale="bench (cm-scale samples)", pillars=["prevention", "suppression"],
        needs={"materials": 1.0, "extinction": 0.7, "detection": 0.2},
        key_variables=["material", "thickness", "geometry", "flow speed", "O2 concentration", "one- vs two-sided burning"],
        sensors=["video cameras", "radiometer", "O2 / CO2 / CO gas analysis"],
        summary=("Ignition, flame growth, spread and extinction limits of solid fuels in low-velocity forced flow, "
                 "including reduced-oxygen runs (initial O2 13.6–22.2 % vol). Data feed the combustion models used "
                 "to design detection and suppression systems."),
    ),
    "PSI-98": dict(
        family="SAFFIRE", fuel_phases=["solid"], configuration="Large SIBAL fabric sample (~0.4 m × 0.94 m) in a flow duct inside an uncrewed Cygnus",
        scale="large (spacecraft-relevant)", pillars=["prevention", "detection"],
        needs={"materials": 1.0, "detection": 0.5},
        key_variables=["flow direction (concurrent/opposed)"],
        sensors=["2 video cameras", "thermocouples", "radiometers", "O2 and CO2 sensors", "pressure", "anemometers"],
        summary=("First large-scale spacecraft fire experiment, run in a Cygnus cargo vehicle after it left the ISS: "
                 "how fast a large fire grows in low gravity, and how low-g flammability compares with NASA's 1-g "
                 "screening test."),
    ),
    "PSI-99": dict(
        family="SAFFIRE", fuel_phases=["solid"], configuration="Nine 5 cm-wide samples, up to 29 cm long (silicone, SIBAL, PMMA, Nomex), in a Cygnus flow duct",
        scale="medium (spacecraft-relevant)", pillars=["prevention", "detection"],
        needs={"materials": 1.0, "detection": 0.4},
        key_variables=["material", "thickness", "flow direction"],
        sensors=["video cameras", "O2 / CO2 sensors"],
        summary=("Flammability of several spacecraft materials in microgravity compared side-by-side with 1-g "
                 "reference burns of the same samples."),
    ),
    "PSI-100": dict(
        family="SAFFIRE", fuel_phases=["solid"], configuration="Large SIBAL fabric sample in a Cygnus flow duct",
        scale="large (spacecraft-relevant)", pillars=["prevention", "detection"],
        needs={"materials": 1.0, "detection": 0.4},
        key_variables=["flow direction"], sensors=["video cameras", "environmental sensors"],
        summary="Repeat of the large-scale fabric fire in a Cygnus vehicle at 30 cm/s, in concurrent and opposed flow.",
    ),
    "PSI-101": dict(
        family="SAME", fuel_phases=["solid"], configuration="Heated samples producing pyrolysis smoke in a flow tube",
        scale="bench", pillars=["detection"], needs={"detection": 1.0, "materials": 0.2},
        key_variables=["material", "heater temperature (Rt/R0)", "inlet velocity", "smoke aging time"],
        sensors=["thermal precipitators (TEM grids)", "particle counters / smoke detectors"],
        summary=("Reflight of SAME: sizes of smoke particles produced by spacecraft materials (Kapton, silicone, "
                 "lamp wick, Pyrell, Teflon) in low gravity, related to smoke generation and transport conditions, "
                 "to evaluate spacecraft smoke detectors."),
    ),
    "PSI-102": dict(
        family="SAME", fuel_phases=["solid"], configuration="Heated samples producing pyrolysis smoke",
        scale="bench", pillars=["detection"], needs={"detection": 1.0, "materials": 0.2},
        key_variables=["material", "air flow", "aging duration"],
        sensors=["particle counter (modified P-Trak)", "smoke detectors", "thermal precipitators"],
        summary=("Quantified the size of smoke particulate produced in low gravity and how it relates to generation "
                 "and transport conditions — baseline data for spacecraft smoke-detector sensitivity."),
    ),
    "PSI-47": dict(
        family="SAME", fuel_phases=["aerosol"], configuration="Test-dust aerosol measured with particle counters",
        scale="bench", pillars=["detection"], needs={"detection": 0.8},
        key_variables=["instrument (P-Trak vs DustTrak)", "sampling location"],
        sensors=["modified TSI P-Trak", "DustTrak"],
        summary=("Risk-reduction test for SAME: checked that a modified commercial condensation particle counter "
                 "works in microgravity, using a test dust aerosol on the ISS."),
    ),
    "PSI-69": dict(
        family="FLEX", fuel_phases=["liquid"], configuration="Isolated fuel droplets (methanol, heptane) in the CIR/MDCA",
        scale="droplet (mm)", pillars=["suppression", "prevention"], needs={"extinction": 1.0, "materials": 0.3},
        key_variables=["fuel", "O2 mole fraction", "pressure", "CO2 / He dilution", "droplet diameter"],
        sensors=["high-speed cameras", "radiometers"],
        summary=("Flammability limits of liquid fuels in microgravity and effectiveness of gaseous suppressants "
                 "(CO2, He) — 274 droplet tests with measured burning rate, extinction diameter and end state."),
    ),
    "PSI-68": dict(
        family="FLEX", fuel_phases=["liquid"], configuration="Pure and bi-component droplets",
        scale="droplet (mm)", pillars=["suppression"], needs={"extinction": 0.6, "materials": 0.2},
        key_variables=["fuel / mixture", "O2 mole fraction", "pressure", "diluent (N2/He)", "flow velocity"],
        sensors=["cameras"],
        summary=("Extends FLEX to practical and bi-component fuels over 0.5–3 atm and 17–30 % O2, including "
                 "extinction mechanisms; the PSI table is a test matrix rather than a run list."),
    ),
    "PSI-39": dict(
        family="FLEX", fuel_phases=["liquid"], configuration="n-dodecane / iso-dodecane droplets",
        scale="droplet (mm)", pillars=["suppression"], needs={"extinction": 0.5},
        key_variables=["pressure (0.5–5 atm)", "O2", "helium dilution", "fuel mixture"],
        sensors=["cameras"],
        summary="Cool-flame behaviour of dodecane droplets versus pressure and helium dilution, including extinction diameters.",
    ),
    "PSI-159": dict(
        family="ACME", fuel_phases=["gas"], configuration="Normal and inverse spherical diffusion flames on a porous burner",
        scale="burner (cm)", pillars=["prevention"], needs={"materials": 0.4, "extinction": 0.4},
        key_variables=["fuel", "O2 (ambient or oxidizer stream, up to 85 %)", "pressure", "flow rate"],
        sensors=["cameras", "burner thermocouple"],
        summary=("Conditions under which cool diffusion flames occur for propane, butane and others. Contains the "
                 "highest-oxygen microgravity combustion tests in PSI (oxidizer streams up to 85 % O2)."),
    ),
    "PSI-10": dict(
        family="ACME", fuel_phases=["gas"], configuration="Normal and inverse spherical ethylene diffusion flames",
        scale="burner (cm)", pillars=["prevention", "detection"], needs={"detection": 0.3, "materials": 0.2},
        key_variables=["O2", "pressure", "stoichiometric mixture fraction", "flow rate"],
        sensors=["cameras", "soot diagnostics"],
        summary="Soot-inception and flame-design limits of spherical diffusion flames versus flow rate, Zst, dilution and pressure.",
    ),
    "PSI-20": dict(
        family="ACME", fuel_phases=["gas"], configuration="Gaseous fuel on porous burners emulating burning solids, quiescent ambient",
        scale="burner (25–50 mm)", pillars=["prevention", "suppression"], needs={"materials": 1.0, "extinction": 0.9},
        key_variables=["O2 concentration (21–40 %)", "pressure (exploration atmospheres)", "burner size", "fuel"],
        sensors=["cameras", "radiometer", "thermocouples"],
        summary=("Burning Rate Emulator: burning of condensed-fuel surrogates in still air as a function of material "
                 "properties, explicitly in NASA-considered crew atmospheres (14.7 psia/21 %, 10.2 psia/26.5 %, "
                 "8.2 psia/34 % O2)."),
    ),
    "PSI-21": dict(
        family="ACME", fuel_phases=["gas"], configuration="Coflow laminar diffusion flames", scale="burner",
        pillars=["detection"], needs={"detection": 0.2, "materials": 0.1}, key_variables=["fuel dilution", "coflow"],
        sensors=["cameras", "soot diagnostics"], summary="Coflow laminar diffusion flames of diluted methane/ethylene: structure and soot.",
    ),
    "PSI-22": dict(
        family="ACME", fuel_phases=["gas"], configuration="Coflow flames with an applied electric field", scale="burner",
        pillars=["prevention"], needs={"materials": 0.2},
        key_variables=["electric field / polarity", "fuel dilution"], sensors=["cameras", "ion current"],
        summary=("Electric-field effects on laminar flames. Noted by the challenge as a way to mimic partial gravity "
                 "through ion-driven forces — the only partial-gravity proxy in PSI."),
    ),
    "PSI-23": dict(
        family="ACME", fuel_phases=["gas"], configuration="Spherical diffusion flames", scale="burner",
        pillars=["prevention"], needs={"materials": 0.2, "extinction": 0.2},
        key_variables=["fuel", "O2", "dilution"], sensors=["cameras"],
        summary="Structure and response of spherical diffusion flames, including near-extinction behaviour.",
    ),
    "PSI-106": dict(
        family="MSG duct", fuel_phases=["gas"], configuration="Lifted jet flames in the SPICE flow duct", scale="burner",
        pillars=["prevention"], needs={"extinction": 0.3, "materials": 0.1},
        key_variables=["fuel dilution", "coflow"], sensors=["cameras", "pyrometry"],
        summary="Liftoff and stabilisation of jet flames in co-flow — how flames anchor or blow off.",
    ),
    "PSI-107": dict(
        family="MSG duct", fuel_phases=["gas"], configuration="Co-flow laminar jet diffusion flames", scale="burner",
        pillars=["detection", "prevention"], needs={"detection": 0.6, "materials": 0.2},
        key_variables=["fuel", "nozzle diameter", "fuel flow", "co-flow air velocity"], sensors=["cameras (Nikon NEF)"],
        summary="Laminar smoke points and soot propensity of non-buoyant jet flames versus burner size and co-flow velocity (469 runs).",
    ),
    "PSI-62": dict(
        family="Ground study", fuel_phases=["solid"], configuration="CFD (flamelet generated manifolds) vs BASS tomography",
        scale="model", pillars=["prevention"], needs={"materials": 0.8}, uses_data_from=["PSI-25", "PSI-26"],
        key_variables=["flow speed", "fuel"], sensors=[],
        summary="Develops and validates concurrent flame-spread models against BASS microgravity experiments.",
    ),
    "PSI-60": dict(
        family="Ground study", fuel_phases=["gas"], configuration="Image analysis + soot modelling of SPICE data", scale="model",
        pillars=["detection"], needs={"detection": 0.5}, uses_data_from=["PSI-107"], key_variables=["soot"], sensors=[],
        summary="Why soot formation differs so much between 1-g and 0-g flames, using SPICE images and detailed soot models.",
    ),
    "PSI-115": dict(
        family="Ground study", fuel_phases=["solid"], configuration="Modelling of smoke generation", scale="model",
        pillars=["detection"], needs={"detection": 0.8}, uses_data_from=["PSI-101", "PSI-102"],
        key_variables=["smoke particle size"], sensors=[],
        summary="Uses SAME data for advanced modelling and simulation of smoke generation in microgravity.",
    ),
    "PSI-117": dict(
        family="Ground study", fuel_phases=["liquid"], configuration="3-D CFD of droplet cool flames", scale="model",
        pillars=["suppression"], needs={"extinction": 0.4}, uses_data_from=["PSI-69", "PSI-142"],
        key_variables=["thermo-convective perturbation"], sensors=[],
        summary="CFD of how external thermal/convective perturbations affect cool-flame droplet combustion (FLEX data).",
    ),
    "PSI-142": dict(
        family="Ground study", fuel_phases=["liquid", "gas"], configuration="Counterflow flames + simulations", scale="model",
        pillars=["suppression"], needs={"extinction": 0.5}, uses_data_from=["PSI-69"],
        key_variables=["O2", "extinction limits"], sensors=[],
        summary="Cool-flame extinction limits (radiation and stretch) compared with FLEX conditions; PSI lists the published datasets.",
    ),
    "PSI-181": dict(
        family="Out of scope", fuel_phases=[], configuration="Solder joints", scale="-", pillars=[], needs={},
        in_scope=False, scope_note="Materials science (soldering): matched the keyword 'combustion' only.",
        summary="Solder microstructure in microgravity — not a combustion investigation.",
    ),
    "PSI-108": dict(
        family="Out of scope", fuel_phases=[], configuration="Thermocapillary flow", scale="-", pillars=[], needs={},
        in_scope=False, scope_note="Fluid physics: matched the keyword 'combustion' only.",
        summary="Surface-tension-driven convection — not a combustion investigation.",
    ),
}

# --------------------------------------------------------------------------- habitats / scenarios
HABITATS = [
    dict(id="iss", name="ISS / Earth-normal cabin", o2_pct_min=20.5, o2_pct_max=21.5, pressure_kpa_min=97.0,
         pressure_kpa_max=103.0, gravity="microgravity", gravity_g=0.0, status="documented",
         source="PSI-20 objective (14.7 psia, 21 % O2 listed as a NASA-considered atmosphere)",
         note="Sea-level-like atmosphere."),
    dict(id="exploration_26", name="Exploration atmosphere 10.2 psia / 26.5 % O2", o2_pct_min=26.0, o2_pct_max=27.0,
         pressure_kpa_min=68.0, pressure_kpa_max=72.5, gravity="microgravity", gravity_g=0.0, status="documented",
         source="PSI-20 objective: NASA-considered atmosphere for human space missions",
         note="Intermediate atmosphere (e.g. vehicles preparing EVAs)."),
    dict(id="exploration_34", name="Exploration atmosphere 8.2 psia / 34 % O2", o2_pct_min=33.0, o2_pct_max=35.0,
         pressure_kpa_min=54.0, pressure_kpa_max=59.0, gravity="microgravity", gravity_g=0.0, status="documented",
         source="PSI-20 objective: NASA-considered atmosphere for human space missions",
         note="Reduces EVA pre-breathe time; markedly higher O2 mole fraction than Earth."),
    dict(id="lunar_base", name="Moon base / pressurized rover", o2_pct_min=30.0, o2_pct_max=35.0,
         pressure_kpa_min=54.0, pressure_kpa_max=70.3, gravity="lunar", gravity_g=0.166, status="planning_assumption",
         source=f"Challenge statement ({CHALLENGE_URL}): likely ≥30 % O2 at ≤10.2 psi",
         note="Partial gravity: no PSI combustion data yet (LUCI, FM2 planned). Microgravity and 1-g results bound it."),
    dict(id="mars_habitat", name="Mars surface habitat", o2_pct_min=26.0, o2_pct_max=35.0,
         pressure_kpa_min=54.0, pressure_kpa_max=72.5, gravity="martian", gravity_g=0.38, status="hypothetical",
         source="Assumption: same candidate exploration atmospheres as above",
         note="Atmosphere not fixed; partial gravity (0.38 g) not covered by PSI data."),
    dict(id="eva_suit", name="Spacesuit (EVA)", o2_pct_min=99.0, o2_pct_max=100.0, pressure_kpa_min=28.0,
         pressure_kpa_max=31.0, gravity="microgravity", gravity_g=0.0, status="documented",
         source=f"Challenge statement ({CHALLENGE_URL}): 100 % O2 at 4.3 psi",
         note="Pure oxygen: far outside every PSI combustion test atmosphere."),
]

# --------------------------------------------------------------------------- insights (text-grounded)
# Computed insights (from tables) are appended in build.py.
TEXT_INSIGHTS = [
    dict(
        id="bre-elevated-o2-no-flow", need="extinction", pillar="suppression",
        title="Stopping ventilation may not be enough in oxygen-enriched cabins",
        observation=("In quiescent microgravity, BRE flames emulating condensed materials (e.g. PMMA, nylon) kept "
                     "burning quasi-steadily in the elevated-oxygen atmospheres considered for future spacecraft, "
                     "whereas comparable flames at 21 % O2 self-extinguished in a short time. PSI describes these "
                     "results as preliminary."),
        conditions="ACME BRE (PSI-20): porous burners 25/50 mm, CH4 or C2H4, no forced flow, O2 21–40 % in the session table.",
        design_question=("Is ventilation shutdown — an established step in fighting spacecraft fires — still a "
                         "sufficient first response at 26.5–34 % O2, or must agent discharge come sooner?"),
        limitation="Gaseous emulation of solids; per-test pressure not in the summary table; results flagged preliminary.",
        next_validation="Burn real cabin materials at exploration atmospheres in microgravity and partial gravity (e.g. FM2).",
        sources=[{"accession": "PSI-20", "field": "researchImpacts"}, {"accession": "PSI-20", "field": "objective"}],
        evidence_kind="psi_text",
    ),
    dict(
        id="bass-1g-screening-gap", need="materials", pillar="prevention",
        title="1-g material screening is not automatically conservative",
        observation=("Spacecraft material selection relies on NASA-STD-6001 Test 1, which ranks materials by 1-g "
                     "behaviour. BASS and BASS-II were built on the hypothesis that, with adequate ventilation, "
                     "materials burn as well if not better in microgravity than in normal gravity."),
        conditions="BASS / BASS-II (PSI-26, PSI-25): cm-scale fabric and PMMA samples, low-speed forced flow in the MSG.",
        design_question="Which flow speeds and flow directions must a microgravity-relevant material test include?",
        limitation="Specific materials and geometries; flow and O2 per test partly only in raw files for BASS.",
        next_validation="Extend to the materials and thicknesses of the target vehicle (SoFIE on ISS).",
        sources=[{"accession": "PSI-26", "field": "hypothesis"}, {"accession": "PSI-25", "field": "hypothesis"},
                 {"accession": "PSI-26", "field": "researchImpacts"}],
        evidence_kind="hypothesis",
    ),
    dict(
        id="same-smoke-particles", need="detection", pillar="detection",
        title="Detectors must be checked against microgravity smoke, not Earth smoke",
        observation=("SAME was designed around the hypothesis that, without buoyant flows, smoke particles from "
                     "pyrolysing materials grow larger than in 1 g; SAME and SAME-R provide quantitative data on "
                     "detector sensitivity to reduced-gravity smoke."),
        conditions="SAME / SAME-R (PSI-102, PSI-101): Kapton, silicone, lamp wick, Pyrell, Teflon; inlet flow 0–8.1 cm/s; controlled aging times.",
        design_question="Which particle-size range and smoke-aging time should a spacecraft detector be qualified for?",
        limitation="Pyrolysis (non-flaming) smoke; particle-size results are in reports/raw files, not in the summary table.",
        next_validation="Test candidate detectors against SAME-like smoke at exploration atmospheres.",
        sources=[{"accession": "PSI-102", "field": "hypothesis"}, {"accession": "PSI-101", "field": "researchImpacts"}],
        evidence_kind="hypothesis",
    ),
    dict(
        id="daft-dust-vs-smoke", need="detection", pillar="detection",
        title="Dust can look like smoke to a particle counter",
        observation=("DAFT showed that a modified commercial particle counter could be used in microgravity, "
                     "measuring a test dust aerosol released on the ISS."),
        conditions="DAFT / DAFT-2 (PSI-47): 2 sessions, Arizona Road Dust in ISS nitrogen, P-Trak vs DustTrak.",
        design_question=("On the Moon, regolith dust will enter habitats: how will detectors discriminate dust from "
                         "smoke to avoid nuisance alarms?"),
        limitation="Terrestrial test dust, not lunar regolith; feasibility test only.",
        next_validation="Characterise detector response to lunar-simulant dust versus SAME-type smoke.",
        sources=[{"accession": "PSI-47", "field": "objective"}, {"accession": "PSI-47", "field": "researchImpacts"}],
        evidence_kind="psi_text",
    ),
    dict(
        id="cool-flames-low-temperature", need="extinction", pillar="suppression",
        title="Cool flames: combustion at 500–1000 K",
        observation=("Cool diffusion flames have peak temperatures of about 500–1000 K. FLEX, CFI and CFI-G "
                     "studied them on droplets and burners in microgravity."),
        conditions="CFI-G (PSI-159), CFI (PSI-39), FLEX (PSI-69): hydrocarbon fuels, 0.5–5 atm.",
        design_question=("Could low-temperature reaction zones persist after visible flame extinction, and would "
                         "optical or heat detectors see them?"),
        limitation="Research fuels and configurations; relevance to cabin fires is an open question, not a finding.",
        next_validation="Check whether cabin-relevant fuels can sustain cool-flame chemistry in exploration atmospheres.",
        sources=[{"accession": "PSI-159", "field": "researchImpacts"}, {"accession": "PSI-39", "field": "objective"},
                 {"accession": "PSI-117", "field": "objective"}],
        evidence_kind="psi_text",
    ),
    dict(
        id="partial-gravity-gap", need="materials", pillar="prevention",
        title="No partial-gravity combustion data yet",
        observation=("PSI currently holds no combustion data at lunar or martian gravity. The challenge notes that "
                     "microgravity and normal-gravity results can bound intermediate gravity levels, and that "
                     "E-FIELD (PSI-22) mimicked partial gravity with ion-driven forces."),
        conditions="All PSI combustion investigations: microgravity (ISS, Cygnus) or ground.",
        design_question="For a Moon base, which results are bounding cases and which cannot be transferred at all?",
        limitation="Bounding is not interpolation: behaviour at 1/6 g may not lie between the two cases for every metric.",
        next_validation="LUCI and FM2 lunar-gravity experiments.",
        sources=[{"url": CHALLENGE_URL, "field": "Potential considerations"}, {"accession": "PSI-22", "field": "objective"}],
        evidence_kind="psi_text",
    ),
    dict(
        id="saffire-large-scale", need="materials", pillar="prevention",
        title="Scale matters: only SAFFIRE burned spacecraft-size samples",
        observation=("SAFFIRE-I and -III burned ~0.4 m × 0.94 m fabric samples in uncrewed Cygnus vehicles, with "
                     "O2/CO2, pressure, temperature and flame-growth measurements — the only realistic-scale fire "
                     "data in PSI."),
        conditions="SAFFIRE-I (PSI-98) at 20 cm/s; SAFFIRE-III (PSI-100) at 30 cm/s; concurrent and opposed flow.",
        design_question="How do fire growth and gas-concentration changes in a sealed vehicle inform detection and response time?",
        limitation="Two samples per mission, one material (SIBAL).",
        next_validation="Additional materials at exploration atmospheres (later SAFFIRE flights).",
        sources=[{"accession": "PSI-98", "field": "approach"}, {"accession": "PSI-100", "field": "objective"}],
        evidence_kind="psi_text",
    ),
]

# --------------------------------------------------------------------------- Earth applications
EARTH_APPLICATIONS = [
    dict(id="confined-vehicles", title="Fire safety in submarines and high-altitude aircraft", domain="Confined vehicles",
         contribution=("FLEX data on flammability limits and gaseous suppressants (CO2, He) inform fire safety in "
                       "confined, controlled atmospheres."),
         validation_needed="Earth gravity, real cabin fuels and ventilation; droplet results do not transfer directly to solid fires.",
         sources=[{"accession": "PSI-69", "label": "FLEX research impacts"}]),
    dict(id="sealed-spaces", title="Fires in mines, airplanes and other sealed spaces", domain="Confined spaces",
         contribution="SAFFIRE studies fire growth and gas build-up inside a sealed vehicle.",
         validation_needed="Buoyancy-driven flows dominate on Earth; geometry and materials differ.",
         sources=[{"accession": "PSI-98", "label": "SAFFIRE-I research impacts"}]),
    dict(id="smoke-detection", title="Smoke detection in confined environments", domain="Detection",
         contribution=("SAME and DAFT characterise smoke particles and particle counters; DAFT cites submarines and "
                       "underwater laboratories."),
         validation_needed="Real terrestrial fuels, humidity, background aerosols and detector models.",
         sources=[{"accession": "PSI-47", "label": "DAFT research impacts"}, {"accession": "PSI-101", "label": "SAME-R"}]),
    dict(id="wildfire-models", title="Validated fire-spread models (e.g. wildfires)", domain="Modelling",
         contribution="BASS-II's simpler, non-buoyant flames provide clean validation cases for computer models of fuel burning.",
         validation_needed="Models validated at µg must still be validated with buoyancy and wind at field scale.",
         sources=[{"accession": "PSI-25", "label": "BASS-II research impacts"}, {"accession": "PSI-62", "label": "BASS modelling study"}]),
    dict(id="cleaner-engines", title="Cleaner, more efficient engines", domain="Energy",
         contribution="Cool-flame chemistry (CFI, CFI-G, FLEX-2) supports ultra-lean, high-efficiency engine concepts.",
         validation_needed="Engine pressures, turbulence and real fuel blends.",
         sources=[{"accession": "PSI-159", "label": "CFI-G research impacts"}, {"accession": "PSI-39", "label": "CFI research impacts"}]),
    dict(id="nasa-spinoffs", title="NASA spinoffs already in use by firefighters", domain="Spinoffs",
         contribution=("Spacesuit technology improved firefighters' air tanks and protective clothing; a shuttle smoke "
                       "detector that discriminates smoke from dust found industrial use (e.g. mining)."),
         validation_needed="Already commercialised — shown as precedent, not as a result of PSI data.",
         sources=[{"url": "https://spinoff.nasa.gov/node/9582", "label": "Fireman's air tanks"},
                  {"url": "https://spinoff.nasa.gov/node/9407", "label": "Fire detector"},
                  {"url": "https://spinoff.nasa.gov/node/9918", "label": "Fire attire"}]),
]

# --------------------------------------------------------------------------- variable dictionary
VARIABLES = [
    ("test_id", "Test identifier", None, "test", "FlameAtlas id: <PSI accession>:<table>:<row index>"),
    ("accession", "PSI accession", None, "test", "PSI investigation identifier (cite with its DOI)"),
    ("record_type", "Record type", None, "test", "test (one run) | session (one day/condition) | test_matrix (planned ranges) | data_reference"),
    ("source_file", "Source file", None, "test", "PSI experimental-table file the record was parsed from"),
    ("source_row", "Source row", None, "test", "1-based row number in the source CSV (header = row 1)"),
    ("fuel", "Fuel / sample", None, "test", "Fuel or sample as written in PSI"),
    ("fuel_phase", "Fuel phase", None, "test", "solid | liquid | gas | aerosol"),
    ("material_class", "Material class", None, "test", "Normalised material family (e.g. PMMA, SIBAL fabric)"),
    ("configuration", "Configuration", None, "test", "Sample / burner geometry"),
    ("thickness_mm", "Thickness", "mm", "test", "Sample thickness, converted to mm"),
    ("o2_mole_frac", "O2 mole fraction", "-", "test", "Initial ambient O2 (oxidizer-stream O2 for inverse flames — see quality flags)"),
    ("pressure_kpa", "Pressure", "kPa", "test", "Ambient pressure converted to kPa (from mmHg, atm, bar or psia)"),
    ("flow_cm_s", "Flow velocity", "cm/s", "test", "Imposed flow / co-flow velocity (0 = quiescent)"),
    ("flow_direction", "Flow direction", None, "test", "concurrent | opposed (relative to flame spread)"),
    ("diluent", "Diluent", None, "test", "Inert gases present besides N2 (CO2, He)"),
    ("co2_mole_frac", "CO2 mole fraction", "-", "test", "Initial ambient CO2 (FLEX suppressant)"),
    ("he_mole_frac", "He mole fraction", "-", "test", "Initial ambient helium"),
    ("gravity", "Gravity", None, "test", "microgravity for all PSI flight data"),
    ("outcome", "Outcome (as reported)", None, "test", "End state as written in PSI"),
    ("outcome_class", "Outcome class", None, "test", "Normalised end state (extinction, no_ignition, self_extinguished...)"),
    ("quality", "Quality flags", None, "test", "Every interpretation made while parsing (assumed_unit, typo_corrected...)"),
    ("droplet_initial_diameter", "Initial droplet diameter", "mm", "measurement", "FLEX"),
    ("flame_extinction_diameter", "Flame extinction diameter", "mm", "measurement", "FLEX: droplet diameter at visible flame extinction"),
    ("burning_rate_constant", "Burning-rate constant K", "mm²/s", "measurement", "FLEX: d²-law burning rate (header unit 'mm' in PSI — verify)"),
    ("burn_time_s", "Burn time", "s", "measurement", "Duration of burning"),
    ("ug_burn_length", "µg burn length", "cm", "measurement", "SAFFIRE-II: length burned in microgravity"),
    ("1g_burn_length", "1-g burn length", "cm", "measurement", "SAFFIRE-II: same sample type burned in normal gravity"),
    ("ug_spread_rate", "µg spread rate", "mm/s", "measurement", "SAFFIRE-II"),
    ("1g_spread_rate", "1-g spread rate", "mm/s", "measurement", "SAFFIRE-II"),
    ("o2_final_pct", "Final O2", "% vol", "measurement", "BASS-II chamber O2 after the test"),
    ("co2_final_pct", "Final CO2", "% vol", "measurement", "BASS-II"),
    ("co_final_ppm", "Final CO", "ppm", "measurement", "BASS-II"),
    ("net_aging_time_s", "Net smoke aging time", "s", "measurement", "SAME-R"),
    ("heater_resistance_ratio", "Heater resistance ratio Rt/R0", "-", "measurement", "SAME-R: proxy for heater temperature"),
    ("weight_loss_rate", "Weight loss rate", "mg/min", "measurement", "SAME"),
    ("adiabatic_flame_temperature", "Adiabatic flame temperature", "K", "measurement", "ACME"),
    ("stoichiometric_mixture_fraction", "Zst", "-", "measurement", "ACME"),
    ("fuel_flow_mg_s", "Fuel flow", "mg/s", "measurement", "ACME, SPICE"),
    ("nozzle_diameter", "Nozzle diameter", "mm", "measurement", "SPICE"),
    ("flames_ignited", "Flames ignited", "count", "measurement", "ACME session tables"),
]

# --------------------------------------------------------------------------- query lexicon (FR + EN)
LEXICON = {
    "need": {
        "materials": ["material", "materials", "matériau", "matériaux", "materiau", "materiaux", "flammability",
                      "inflammabilité", "inflammabilite", "flame spread", "spread", "propagation", "fabric", "tissu",
                      "textile", "plastic", "plastique", "pmma", "nomex", "cotton", "coton", "combustibility",
                      "combustibilité", "screening", "ignition", "allumage"],
        "extinction": ["extinction", "extinguish", "extinguishment", "extincteur", "éteindre", "eteindre",
                       "suppression", "suppress", "suppressant", "agent", "co2", "helium", "hélium", "diluent",
                       "dilution", "inert", "inerte", "water mist", "brouillard", "brumisation", "blowoff",
                       "put out", "stop a fire", "stop the fire", "cut ventilation", "cutting ventilation",
                       "ventilation shutdown", "couper la ventilation", "self-extinguish", "auto-extinction"],
        "detection": ["detection", "détection", "detect", "detector", "détecteur", "detecteur", "smoke", "fumée",
                      "fumee", "fumées", "aerosol", "aérosol", "particle", "particule", "particules", "soot", "suie",
                      "alarm", "alarme", "dust", "poussière", "poussiere", "sensor", "capteur"],
    },
    "fuel_phase": {
        "solid": ["solid", "solide", "fabric", "tissu", "pmma", "plastic", "plastique", "cotton", "nomex", "cable",
                  "câble", "wire", "polymer", "polymère", "material", "matériau", "silicone", "kapton", "teflon"],
        "liquid": ["liquid", "liquide", "droplet", "gouttelette", "goutte", "heptane", "methanol", "méthanol",
                   "dodecane", "octane", "ethanol", "fuel spill"],
        "gas": ["gas", "gaz", "gaseous", "gazeux", "methane", "méthane", "ethylene", "éthylène", "propane", "butane",
                "jet flame", "burner", "brûleur"],
    },
    "gravity": {
        "lunar": ["moon", "lune", "lunar", "lunaire", "artemis", "rover"],
        "martian": ["mars", "martian", "martien", "martienne"],
        "microgravity": ["microgravity", "microgravité", "micro-gravity", "µg", "0g", "zero-g", "iss", "orbit",
                         "orbite", "station", "gateway", "orion", "spacecraft", "vaisseau", "cabin", "cabine"],
        "earth": ["earth", "terre", "1g", "1-g", "normal gravity", "gravité normale", "terrestre"],
    },
    "habitat": {
        "lunar_base": ["moon base", "base lunaire", "lunar base", "rover", "pressurized rover", "rover pressurisé"],
        "mars_habitat": ["mars habitat", "base martienne", "mars base"],
        "iss": ["iss", "space station", "station spatiale"],
        "eva_suit": ["spacesuit", "combinaison", "eva suit", "suit"],
    },
    "synonyms": {
        "fumée": "smoke", "fumee": "smoke", "suie": "soot", "poussière": "dust", "poussiere": "dust",
        "détecteur": "detector", "detecteur": "detector", "matériau": "material", "matériaux": "material",
        "propagation": "spread", "extincteur": "extinguish", "éteindre": "extinguish", "gouttelette": "droplet",
        "goutte": "droplet", "oxygène": "oxygen", "oxygene": "oxygen", "pression": "pressure",
        "ventilation": "flow", "écoulement": "flow", "ecoulement": "flow", "flamme": "flame", "feu": "fire",
        "incendie": "fire", "tissu": "fabric", "plastique": "plastic", "lune": "moon", "inflammabilité": "flammability",
        "inflammabilite": "flammability", "allumage": "ignition", "gaz": "gas", "liquide": "liquid", "solide": "solid",
        "capteur": "sensor", "particules": "particle", "particule": "particle", "hélium": "helium",
        "brûleur": "burner", "épaisseur": "thickness", "vitesse": "velocity",
    },
}
