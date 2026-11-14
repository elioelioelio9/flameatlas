"""Controlled vocabulary of the Orbital Knowledge Engine.

Concepts and entities are defined here once, with their English/French surface forms. A concept is linked to a
document only when one of these forms is found in the document's text (the matching passage is stored as evidence),
never because two documents merely share vocabulary.
"""

from __future__ import annotations

CONCEPTS: dict[str, dict] = {
    "flame-spread": {"label": "Flame spread", "aliases": ["flame spread", "spread rate", "flame propagation", "propagation de flamme", "spreading flame", "spread"], "description": "Advance of a flame front over a solid surface."},
    "extinction": {"label": "Extinction", "aliases": ["extinction", "extinguish", "extinguishment", "self-extinguish", "quench", "blowoff", "blow-off", "auto-extinction", "éteindre", "eteindre", "éteint"], "description": "The flame going out, by starvation, cooling, dilution or strain."},
    "ignition": {"label": "Ignition", "aliases": ["ignition", "ignite", "igniter", "allumage", "autoignition", "auto-ignition"], "description": "Onset of combustion."},
    "oxygen-concentration": {"label": "Oxygen concentration", "aliases": ["oxygen concentration", "oxygen mole fraction", "o2 concentration", "% o2", "o2 mole fraction", "oxygen-enriched", "elevated oxygen", "reduced oxygen", "oxygène"], "description": "Amount of O2 available to the flame."},
    "pressure": {"label": "Pressure", "aliases": ["pressure", "psia", "kpa", "atmospheric pressure", "ambient pressure", "low pressure", "reduced pressure", "pression"], "description": "Total ambient pressure of the atmosphere."},
    "flow-velocity": {"label": "Forced flow", "aliases": ["flow velocity", "air flow", "airflow", "forced flow", "flow speed", "ventilation", "imposed flow", "opposed flow", "concurrent flow", "écoulement"], "description": "Gas flow imposed past the flame (ventilation or test flow)."},
    "buoyancy": {"label": "Buoyancy", "aliases": ["buoyancy", "buoyant", "natural convection", "flottabilité"], "description": "Gravity-driven flow of hot gas; absent in microgravity."},
    "microgravity": {"label": "Microgravity", "aliases": ["microgravity", "micro-gravity", "reduced gravity", "low gravity", "weightless", "microgravité", "zero-g"], "description": "Free-fall environment where buoyancy is negligible."},
    "partial-gravity": {"label": "Partial gravity", "aliases": ["partial gravity", "lunar gravity", "martian gravity", "fractional gravity", "gravité partielle"], "description": "Gravity levels between orbit and Earth (Moon 0.17 g, Mars 0.38 g)."},
    "diffusion-flame": {"label": "Diffusion flame", "aliases": ["diffusion flame", "non-premixed", "nonpremixed", "laminar flame", "jet flame", "flamme de diffusion"], "description": "Flame where fuel and oxidizer meet by diffusion."},
    "premixed-flame": {"label": "Premixed flame", "aliases": ["premixed", "pre-mixed", "flamme prémélangée"], "description": "Flame burning a mixture already containing fuel and oxidizer."},
    "droplet-combustion": {"label": "Droplet combustion", "aliases": ["droplet", "droplets", "gouttelette", "fiber-supported", "free-floated"], "description": "Burning of an isolated liquid fuel droplet."},
    "cool-flame": {"label": "Cool flame", "aliases": ["cool flame", "cool-flame", "low temperature combustion", "low-temperature chemistry", "flamme froide"], "description": "Low-temperature chemical reaction zone that can persist after hot-flame extinction."},
    "burning-rate": {"label": "Burning rate", "aliases": ["burning rate", "burn rate", "mass loss rate", "regression rate", "burning rate constant", "vitesse de combustion"], "description": "Rate at which fuel is consumed."},
    "soot": {"label": "Soot", "aliases": ["soot", "sooting", "suie", "carbonaceous"], "description": "Carbon particles produced in fuel-rich flame regions."},
    "smoke": {"label": "Smoke", "aliases": ["smoke", "fumée", "fumee", "aerosol", "aérosol", "pyrolysis products"], "description": "Airborne products of combustion or pyrolysis."},
    "particle-size": {"label": "Particle size", "aliases": ["particle size", "particle size distribution", "particulate", "particle", "particles", "taille des particules"], "description": "Size of airborne particles, which governs detector response."},
    "smoke-detection": {"label": "Smoke detection", "aliases": ["smoke detector", "detector", "detection", "détecteur", "alarm", "sensor", "capteur"], "description": "Sensing fire signatures in time to act."},
    "radiation": {"label": "Radiative heat loss", "aliases": ["radiation", "radiative", "radiative loss", "radiative heat", "rayonnement"], "description": "Heat leaving the flame as radiation, a driver of extinction in weak flames."},
    "material-flammability": {"label": "Material flammability", "aliases": ["flammability", "flammable", "inflammabilité", "material screening", "nasa-std-6001", "std-6001", "upward flammability", "flammability limit"], "description": "Whether and how a material burns in given conditions."},
    "suppressant": {"label": "Suppressant / diluent", "aliases": ["suppressant", "suppression", "diluent", "dilution", "inert", "helium", "co2", "carbon dioxide", "nitrogen", "extinguisher", "extincteur", "water mist"], "description": "Agents that weaken or extinguish a flame."},
    "electric-field": {"label": "Electric field", "aliases": ["electric field", "e-field", "electric-field", "ions", "ionic wind", "champ électrique"], "description": "Electric fields acting on charged species in a flame."},
    "heat-release": {"label": "Heat release", "aliases": ["heat release", "heat-release", "hrr", "energy release", "calorimetry"], "description": "Rate at which a fire releases energy."},
    "temperature": {"label": "Temperature", "aliases": ["temperature", "thermocouple", "flame temperature", "température"], "description": "Gas or surface temperature measurements."},
    "carbon-monoxide": {"label": "Carbon monoxide", "aliases": ["carbon monoxide", "co concentration", "co_final", "monoxyde de carbone"], "description": "Toxic product of incomplete combustion."},
    "fuel-thickness": {"label": "Fuel thickness", "aliases": ["thickness", "thick fuel", "thin fuel", "épaisseur"], "description": "Sample thickness, which controls thermal behaviour of solids."},
    "spacecraft-atmosphere": {"label": "Spacecraft atmosphere", "aliases": ["spacecraft atmosphere", "exploration atmosphere", "cabin atmosphere", "habitat atmosphere", "8.2 psia", "10.2 psia", "14.7 psia"], "description": "Pressure and composition of crewed-cabin air."},
    "fire-safety": {"label": "Spacecraft fire safety", "aliases": ["fire safety", "fire-safety", "fire hazard", "fire risk", "sécurité incendie", "fire prevention"], "description": "Preventing, detecting and suppressing fires in crewed vehicles."},
    "modeling": {"label": "Numerical modeling", "aliases": ["modeling", "modelling", "numerical model", "numerical simulation", "computational", "cfd", "modélisation"], "description": "Computational models of combustion."},
    "smoldering": {"label": "Smoldering", "aliases": ["smolder", "smoldering", "smoulder", "smouldering", "couvant"], "description": "Slow, flameless surface combustion."},
}

# entities: bodies, vehicles, facilities
ENTITIES: dict[str, dict] = {
    "iss": {"label": "International Space Station", "kind": "spacecraft", "aliases": ["international space station", "iss", "space station", "station spatiale"]},
    "cygnus": {"label": "Cygnus cargo vehicle", "kind": "spacecraft", "aliases": ["cygnus"]},
    "space-shuttle": {"label": "Space Shuttle", "kind": "spacecraft", "aliases": ["space shuttle", "shuttle", "sts-"]},
    "moon": {"label": "Moon", "kind": "planetary body", "aliases": ["moon", "lunar", "lune", "lunaire", "artemis"]},
    "mars": {"label": "Mars", "kind": "planetary body", "aliases": ["mars", "martian", "martien", "martienne", "martiens"]},
    "earth": {"label": "Earth", "kind": "planetary body", "aliases": ["earth", "terrestrial", "normal gravity", "1-g", "1g", "terre"]},
    "cir": {"label": "Combustion Integrated Rack", "kind": "facility", "aliases": ["combustion integrated rack", "cir"]},
    "msg": {"label": "Microgravity Science Glovebox", "kind": "facility", "aliases": ["microgravity science glovebox", "msg", "glovebox"]},
    "mdca": {"label": "Multi-user Droplet Combustion Apparatus", "kind": "facility", "aliases": ["multi-user droplet combustion", "mdca"]},
    "acme-insert": {"label": "ACME chamber insert", "kind": "facility", "aliases": ["acme insert", "chamber insert"]},
    "nasa-glenn": {"label": "NASA Glenn Research Center", "kind": "organization", "aliases": ["glenn research center", "nasa glenn", "grc"]},
    "drop-tower": {"label": "Drop tower", "kind": "facility", "aliases": ["drop tower", "zero gravity research facility", "2.2 second", "5.2 second"]},
}

RELATIONS: dict[str, str] = {
    "references": "Explicitly cites or links to the target (PSI 'related' field, a wikilink, or a reference list).",
    "mentions": "The target concept or entity appears in the document's text; the matching passage is the evidence.",
    "describes": "The source is a publication or note whose subject is the target investigation.",
    "measures": "The source reports values of the target quantity (test tables or extracted numbers with units).",
    "supports": "The source is cited as evidence for the target finding.",
    "contradicts": "The source reports a result opposing the target statement (curated, with the passage).",
    "extends": "The source continues the target programme (same family, later flight).",
    "depends_on": "The source relies on the target (hardware used, or flight data re-used by a ground study).",
    "shares_concept": "Inferred: both documents mention at least two of the same concepts (listed in the evidence).",
    "contains_related_data": "Inferred: both sides hold data for the same quantity, or test conditions fall inside the target envelope.",
}

NODE_TYPES = {
    "document": "Investigations, publications, reports, uploaded files and notes",
    "concept": "Scientific concepts and phenomena",
    "entity": "Spacecraft, planetary bodies, facilities, organisations",
    "data": "Measured quantities, parameters and atmosphere envelopes",
    "research": "Findings, hypotheses and design questions",
}

# units recognised in free text (value + unit)
UNIT_PATTERNS = [
    ("pressure", r"(?:kpa|psia|psi|atm|bar|mbar|hpa|pa|torr|mmhg)"),
    ("velocity", r"(?:cm/s|mm/s|m/s|km/s)"),
    ("temperature", r"(?:°c|° c|deg c|k(?![a-z])|°f)"),
    ("length", r"(?:mm|cm|µm|um|nm|m(?![a-z/]))"),
    ("time", r"(?:ms|s(?![a-z])|sec|seconds|min|minutes|h(?![a-z]))"),
    ("concentration", r"(?:%\s*o2|% o2|%|ppm|ppb)"),
    ("mass", r"(?:mg|kg|g(?![a-z]))"),
    ("gravity", r"(?:g(?=\b))"),
]
QUANTITY_CONCEPT = {"pressure": "pressure", "velocity": "flow-velocity", "temperature": "temperature", "concentration": "oxygen-concentration", "length": "fuel-thickness"}
