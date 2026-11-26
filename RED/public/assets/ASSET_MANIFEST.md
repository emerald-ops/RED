# R.E.D. Asset Manifest

The game uses external GLB models alongside procedural Three.js character and creature visuals. Add an entry here **before** committing or shipping an asset; do not infer permissions from a file being publicly downloadable.

| Asset name | Source | Original author | License | Original download URL | File location |
| --- | --- | --- | --- | --- | --- |
| Forest Ground 04 (1K diffuse, OpenGL normal, roughness) | Poly Haven | Rob Tuytel, Rico Cilliers | CC0 1.0; attribution not required | https://polyhaven.com/a/forest_ground_04 | `terrain/forest_ground_04_diff_1k.jpg`, `terrain/forest_ground_04_nor_gl_1k.jpg`, `terrain/forest_ground_04_rough_1k.jpg` |
| Tyrannosaurus rex (rigged) | Blend Swap | dancg | CC BY 3.0; attribution required | https://www.blendswap.com/blends/view/73732 | `monsters/enemies/tyrannosaurus.glb` |
| Weapons - Medieval Pack 1 (Broadsword, Ornate Sword, Dagger, Bow, Staff) | Blend Swap | Smeagain | CC BY 3.0; attribution required | https://www.blendswap.com/blends/view/73738 | `weapons/medieval-pack-1/broadsword.glb`, `weapons/medieval-pack-1/ornate-sword.glb`, `weapons/medieval-pack-1/dagger.glb`, `weapons/medieval-pack-1/bow-preview.glb`, `weapons/medieval-pack-1/staff-preview.glb` |

The Ancient Wolf preview/gameplay GLB is sourced from Blend Swap #24800 and is marked CC BY-NC 3.0. Its bundled license requires author credit, but does not state the author's name; keep it local-only until that attribution is verified. The Knight preview has no verified source/license. Neither is cleared for distribution.

## Dragon bosses

The four boss GLBs are by vinish.dev and are licensed CC BY 4.0. The game credits the author in its settings screen. Each supplied model is a rigged, textured GLB with five embedded clips; the Hydra has four. All have idle, walk, roar, and attack clips. The Eastern, Ice, and Fire dragons also have a Fly clip; the Hydra has no flight clip. The Hydra skeleton has separate neck chains and head/jaw bones named A, B, and C. Its head strikes receive a small additive procedural pose offset during the embedded attack clip; this is game-authored motion, not an additional supplied clip.

| Model | Size | Triangles | Joints | Embedded clips | File |
| --- | ---: | ---: | ---: | --- | --- |
| Eastern Dragon | 4.48 MB | 102,319 | 37 | Idle, Walk, Fly, Roar, Attack | `monsters/bosses/dragons/eastern-dragon.glb` |
| Three-Headed Dragon (Hydra) | 4.49 MB | 104,013 | 45 | Idle, Walk, Roar, Attack | `monsters/bosses/dragons/three-headed-hydra.glb` |
| Ice Dragon | 3.01 MB | 65,600 | 55 | Idle, Walk, Fly, Roar, Attack | `monsters/bosses/dragons/ice-dragon.glb` |
| Fire Dragon | 3.17 MB | 68,041 | 55 | Idle, Walk, Fly, Roar, Attack | `monsters/bosses/dragons/fire-dragon.glb` |

Source: [Vinish Free 3D Dragons](https://vinish.dev/free-3d-models/dragons). The supplied models use Y-up orientation and face +Z. Clip playback supplies pose animation; in-world movement and flight height are driven by gameplay code.

## Stylized Nature MegaKit

Quaternius's Stylized Nature MegaKit is CC0. The original archive is retained in the project root; the selected runtime glTF files and their buffer dependencies are in `environment/nature-megakit/`. The archive contains 68 distinct model glTFs, with glTF, OBJ/MTL, and FBX variants, textures, and previews. Full glTF inventory:

- Trees: `CommonTree_1`–`CommonTree_5`, `DeadTree_1`–`DeadTree_5`, `Pine_1`–`Pine_5`, `TwistedTree_1`–`TwistedTree_5`.
- Foliage: `Bush_Common`, `Bush_Common_Flowers`, `Clover_1`, `Clover_2`, `Fern_1`, `Plant_1`, `Plant_1_Big`, `Plant_7`, `Plant_7_Big`.
- Grass: `Grass_Common_Short`, `Grass_Common_Tall`, `Grass_Wispy_Short`, `Grass_Wispy_Tall`.
- Flowers: `Flower_3_Group`, `Flower_3_Single`, `Flower_4_Group`, `Flower_4_Single`, `Petal_1`–`Petal_5`.
- Rocks and ground pieces: `Pebble_Round_1`–`Pebble_Round_5`, `Pebble_Square_1`–`Pebble_Square_6`, `RockPath_Round_Small_1`–`RockPath_Round_Small_3`, `RockPath_Round_Thin`, `RockPath_Round_Wide`, `RockPath_Square_Small_1`–`RockPath_Square_Small_3`, `RockPath_Square_Thin`, `RockPath_Square_Wide`, `Rock_Medium_1`–`Rock_Medium_3`.
- Other props: `Mushroom_Common`, `Mushroom_Laetiporus`.

Runtime instances currently use Pine_1, Bush_Common, Fern_1, Grass_Common_Tall, Rock_Medium_1, and Pebble_Round_1. The source models are scaled, randomly rotated, darkened, and instanced to reduce draw calls and better fit the game's Nordic palette. The pack's stylized appearance remains distinct from the existing realistic terrain; use is limited to sparse natural dressing rather than wholesale replacement.

Source: [Quaternius Stylized Nature MegaKit](https://quaternius.itch.io/stylized-nature-megakit). Attribution is not required under CC0.

For each new entry, record the source and creator as credited by the original publisher, the exact license/version and any attribution requirements, the original download page URL, and the path relative to `public/`. If any detail cannot be verified, do not include the asset in a release.

## Directory guide

- `characters/` — character models; `characters/races/` — race-specific variants
- `creatures/`, `weapons/`, `armor/` — gameplay model categories
- `environment/`, `terrain/`, `vegetation/` — world models and source textures
- `textures/`, `materials/` — reusable texture sets and material definitions
- `animations/`, `audio/`, `ui/` — animation, sound, and interface assets

Prefer GLB for self-contained glTF models; glTF with external resources is also supported by Three.js's GLTFLoader. Keep related texture sets together and register each asset's location in the manifest. The model loader resolves paths relative to the deployed page so assets work on GitHub Pages project paths.
