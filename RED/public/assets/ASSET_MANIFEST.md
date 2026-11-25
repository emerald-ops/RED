# R.E.D. Asset Manifest

The game uses external GLB models alongside procedural Three.js character and creature visuals. Add an entry here **before** committing or shipping an asset; do not infer permissions from a file being publicly downloadable.

| Asset name | Source | Original author | License | Original download URL | File location |
| --- | --- | --- | --- | --- | --- |
| Forest Ground 04 (1K diffuse, OpenGL normal, roughness) | Poly Haven | Rob Tuytel, Rico Cilliers | CC0 1.0; attribution not required | https://polyhaven.com/a/forest_ground_04 | `terrain/forest_ground_04_diff_1k.jpg`, `terrain/forest_ground_04_nor_gl_1k.jpg`, `terrain/forest_ground_04_rough_1k.jpg` |
| Tyrannosaurus rex (rigged) | Blend Swap | dancg | CC BY 3.0; attribution required | https://www.blendswap.com/blends/view/73732 | `monsters/enemies/tyrannosaurus.glb` |
| Weapons - Medieval Pack 1 (Broadsword, Ornate Sword, Dagger, Bow, Staff) | Blend Swap | Smeagain | CC BY 3.0; attribution required | https://www.blendswap.com/blends/view/73738 | `weapons/medieval-pack-1/broadsword.glb`, `weapons/medieval-pack-1/ornate-sword.glb`, `weapons/medieval-pack-1/dagger.glb`, `weapons/medieval-pack-1/bow-preview.glb`, `weapons/medieval-pack-1/staff-preview.glb` |

The Ancient Wolf preview/gameplay GLB is sourced from Blend Swap #24800 and is marked CC BY-NC 3.0. Its bundled license requires author credit, but does not state the author's name; keep it local-only until that attribution is verified. The Knight preview has no verified source/license. Neither is cleared for distribution.

For each new entry, record the source and creator as credited by the original publisher, the exact license/version and any attribution requirements, the original download page URL, and the path relative to `public/`. If any detail cannot be verified, do not include the asset in a release.

## Directory guide

- `characters/` — character models; `characters/races/` — race-specific variants
- `creatures/`, `weapons/`, `armor/` — gameplay model categories
- `environment/`, `terrain/`, `vegetation/` — world models and source textures
- `textures/`, `materials/` — reusable texture sets and material definitions
- `animations/`, `audio/`, `ui/` — animation, sound, and interface assets

Prefer GLB for self-contained glTF models; glTF with external resources is also supported by Three.js's GLTFLoader. Keep related texture sets together and register each asset's location in the manifest. The model loader resolves paths relative to the deployed page so assets work on GitHub Pages project paths.
