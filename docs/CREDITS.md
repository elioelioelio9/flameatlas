# Credits and provenance of visual assets

Every image and model used by Fire Lab is authentic NASA material (US Government work, not subject to copyright in the US; NASA media usage guidelines apply: https://www.nasa.gov/nasa-brand-center/images-and-media/). No image is AI-generated.

## Photographs (`frontend/public/assets/photos/`)

Downloaded from the NASA Image and Video Library (images.nasa.gov); metadata in `photos/meta.json`.

| File | NASA ID | Subject | Source |
|---|---|---|---|
| nasa_GRC-1998-C-00485(_crop).jpg | GRC-1998-C-00485 | Candle flame in 1 g vs microgravity (cropped to the image area) | https://images.nasa.gov/details/GRC-1998-C-00485 |
| nasa_iss035e016429.jpg | ISS035-E-016429 | Chris Cassidy conducts a BASS flame test, 9 Apr 2013 | https://images.nasa.gov/details/iss035e016429 |
| nasa_iss040e072900.jpg | ISS040-E-072900 | BASS-II flame test, acrylic slab, Jul 2014 | https://images.nasa.gov/details/iss040e072900 |
| nasa_iss040e086481.jpg | ISS040-E-086481 | BASS-II at reduced O2, Aug 2014 | https://images.nasa.gov/details/iss040e086481 |
| nasa_jsc2023e046631.jpg | JSC2023E046631 | Plexiglass burning in Saffire-IV | https://images.nasa.gov/details/jsc2023e046631 |
| nasa_GRC-2016-C-05051.jpg | GRC-2016-C-05051 | ACME chamber insert, gas-jet burner | https://images.nasa.gov/details/GRC-2016-C-05051 |
| nasa_iss042e021318.jpg | ISS042-E-021318 | Destiny (US Lab) interior at night, 3 Dec 2014 | https://images.nasa.gov/details/iss042e021318 |
| nasa_iss062e148363.jpg | ISS062-E-148363 | Aurora australis and Earth glow from the ISS | https://images.nasa.gov/details/iss062e148363 |
| nasa_iss040e080833.jpg | ISS040-E-080833 | Sunrise over the Earth limb (Simulation backdrop, ISS) | https://images.nasa.gov/details/iss040e080833 |
| nasa_jsc2004e20304.jpg | JSC2004E20304 | Apollo 17 Station 5 panorama, Taurus-Littrow (Moon base backdrop, downscaled to 4096 px) | https://images.nasa.gov/details/jsc2004e20304 |
| nasa_PIA25176.jpg, pano_mars.webp | PIA25176 | Curiosity Mastcam 360° panorama, Gator-Back rocks — NASA/JPL-Caltech/MSSS. `pano_mars.webp` is the same image with the black mosaic gaps made transparent (no other change) | https://images.nasa.gov/details/PIA25176 |
| nasa_PIA19679.jpg | PIA19679 | Curiosity Navcam 360° panorama, Sol 1000 — NASA/JPL-Caltech (downscaled) | https://images.nasa.gov/details/PIA19679 |
| nasa_jsc2013e028042.jpg, nasa_jsc2013e028050.jpg | JSC2013E028042/-050 | ISS mockups, Space Vehicle Mockup Facility, JSC (Earth backdrop) | https://images.nasa.gov/details/jsc2013e028042 |

## Planet textures (`frontend/public/assets/textures/`)

| File | Data set | Source |
|---|---|---|
| earth.jpg | NASA Blue Marble (Visible Earth, NASA Earth Observatory) | https://visibleearth.nasa.gov/collection/1484/blue-marble |
| moon.jpg | LRO LROC WAC colour mosaic (NASA SVS CGI Moon Kit) | https://svs.gsfc.nasa.gov/4720 |
| mars.jpg | Viking MDIM 2.1 colour mosaic — NASA / JPL / USGS, public domain (via Wikimedia Commons) | https://commons.wikimedia.org/wiki/File:Mars_Viking_MDIM21_ClrMosaic_1km.jpg |

## 3-D model (`frontend/public/assets/models/`)

| File | Model | Source |
|---|---|---|
| iss.glb | International Space Station (B), NASA 3D Resources | https://science.nasa.gov/3d-resources/ |

The habitat interiors in the simulation (ISS modules, Moon base, Mars habitat) are schematics generated from the simulation grid itself (rack faces, partitions, benches, decks, hatches, handrails, lights), not photographs and not renders presented as real; the interface labels them as models. NASA 3D Resources provides no free interior model of the station (checked), so none was used.

## Software

three.js 0.187 (MIT) and its examples (GLTFLoader, DRACOLoader + Draco decoder, OrbitControls, EffectComposer, UnrealBloomPass, GTAOPass, RoomEnvironment). d3 (ISC) for the knowledge graph layout. Colour maps: polynomial fits of matplotlib viridis / inferno / plasma (CC0).
