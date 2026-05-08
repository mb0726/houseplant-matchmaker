"""Backfill also_known_as on lib/plants.json.

One-off script. Adds well-established alternate names so filter_plants'
name_query catches user phrasings that don't share tokens with common_name
(e.g. "Mother-in-law's Tongue" → snake_plant, "Hoya" → wax_plant).

Conservative: only adds aliases that are widely used, not obscure trade names.
"""

import json
from pathlib import Path

PLANTS_PATH = Path(__file__).parent.parent / "lib" / "plants.json"

# id → list of aliases to merge into also_known_as.
ALIASES = {
    "lipstick": ["Lipstick Plant", "Lipstick Vine", "Basket Vine"],
    "snake_plant": ["Mother-in-law's Tongue", "Sansevieria", "Saint George's Sword"],
    "zz_plant": ["ZZ Plant", "Zanzibar Gem", "Aroid Palm"],
    "spider_plant": ["Airplane Plant", "Ribbon Plant", "Spider Ivy"],
    "jade_plant": ["Lucky Plant", "Friendship Tree", "Money Tree"],
    "cast_iron_plant": ["Aspidistra", "Bar-room Plant", "Iron Plant"],
    "golden_pothos": ["Devil's Ivy", "Pothos", "Money Plant"],
    "weeping_fig": ["Ficus Tree", "Ficus", "Benjamin Fig"],
    "fiddleleaf_fig": ["Fiddle Leaf Fig", "FLF", "Fiddle-leaf Fig"],
    "moth_orchid": ["Phalaenopsis", "Phal", "Phalaenopsis Orchid"],
    "wax_plant": ["Hoya", "Porcelain Flower", "Wax Vine"],
    "velvet_leaf_vine": ["Velvet Philodendron", "Philodendron Micans", "Micans"],
    "pink_quill": ["Air Plant", "Pink Quill Plant"],
    "staghorn_fern": ["Elkhorn Fern"],
    "umbrella_plant": ["Schefflera", "Octopus Tree"],
    "birdnest_fern": ["Bird's Nest Fern", "Bird Nest Fern"],
    "china_doll": ["China Doll Plant", "Emerald Tree"],
    "lady_palm": ["Lady Finger Palm", "Bamboo Palm"],
    "japanese_aralia": ["Fatsia", "Paper Plant"],
    "burro_tail": ["Donkey Tail", "Burro's Tail", "Donkey's Tail", "Sedum"],
    "earth_star": ["Cryptanthus", "Earth Star Plant", "Starfish Plant"],
    "tricolor_peperomia": ["Rainbow Peperomia"],
    "polly_alocasia": ["African Mask Plant", "Polly Plant", "Amazonian Elephant Ear"],
    "imperial_alocasia": ["Jewel Alocasia"],
    "white_bird_of_paradise": ["Bird of Paradise", "White BoP"],
    "xanadu_philodendron": ["Xanadu", "Philodendron Xanadu"],
    "pygmy_date_palm": ["Dwarf Date Palm", "Miniature Date Palm"],
    "madagascar_palm": ["Pachypodium"],
    "medallion_calathea": ["Calathea Medallion"],
    "velvet_calathea": ["Velvet Touch Calathea", "Furry Feather"],
    "silver_calathea": ["Silver Plate Calathea"],
    "stiped_calathea": ["Pinstripe Calathea"],
    "holly_fern": ["Holly Fern", "Japanese Holly Fern"],
    "chinese_hibiscus": ["Hawaiian Hibiscus", "Hibiscus", "Tropical Hibiscus", "Shoeblack Plant"],
    "croton": ["Garden Croton", "Joseph's Coat", "Variegated Croton"],
    "false_aralia": ["Spider Aralia", "Threadleaf Aralia", "Finger Aralia"],
    "chicken_gizard_aralia": ["Parsley Panax", "Curly Aralia"],
    "bronze_anthurium": ["Anthurium", "King Anthurium"],
    "blushing_bromeliad": ["Neoregelia"],
    "silver_vase": ["Urn Plant", "Silver Vase Plant"],
    "stromante": ["Stromanthe", "Triostar Stromanthe"],
    "pellaea_falcata": ["Sickle Fern", "Australian Cliff Brake"],
    "cornstalk_plant": ["Mass Cane", "Corn Plant", "Dracaena Massangeana"],
    "janet_craig": ["Janet Craig Dracaena", "Dracaena Janet Craig"],
    "variegated_lily_turf": ["Variegated Liriope", "Big Blue Lilyturf", "Monkey Grass"],
    "majesty_palm": ["Majestic Palm"],
    "fish_tail_palm": ["Fishtail Palm", "Wine Palm"],
    "tree_maidenhair_fern": ["Tree Maidenhair"],
    "silver_ribbon_fern": ["Silver Lace Fern", "Variegated Brake Fern"],
    "cretan_brake": ["Cretan Brake Fern", "Ribbon Fern"],
    "orchid_cactus": ["Epiphyllum"],
    "tree_cereus": ["Peruvian Apple Cactus", "Cereus", "Hedge Cactus"],
    "golden_barrel": ["Golden Barrel Cactus", "Mother-in-law's Cushion"],
    "emerald_gem": ["Homalomena"],
    "phrynium": ["Never Never Plant", "Ctenanthe"],
}


def main():
    data = json.loads(PLANTS_PATH.read_text())
    by_id = {p["id"]: p for p in data}

    updated = 0
    skipped = []

    for plant_id, new_aliases in ALIASES.items():
        plant = by_id.get(plant_id)
        if not plant:
            skipped.append(plant_id)
            continue
        existing = list(plant.get("also_known_as") or [])
        existing_lower = {a.lower() for a in existing}
        merged = list(existing)
        for alias in new_aliases:
            if alias.lower() not in existing_lower:
                merged.append(alias)
                existing_lower.add(alias.lower())
        if merged != existing:
            plant["also_known_as"] = merged
            updated += 1

    PLANTS_PATH.write_text(json.dumps(data, indent=2) + "\n")

    print(f"Updated {updated} plants.")
    if skipped:
        print(f"Skipped (id not found): {skipped}")


if __name__ == "__main__":
    main()
