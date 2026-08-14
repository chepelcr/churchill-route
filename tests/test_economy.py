"""LA ECONOMÍA — `src/content/economy.json`.

The catalog moved out of `src/game/economy.js` on 2026-08-14: prices, names,
icons, the effect ladders, the paint swatches and the IAP product ids. What
stayed is the wallet, and `ensureEconomy` in particular, which is a MIGRATION —
it fills in the fields an old localStorage save does not have, and getting it
wrong loses somebody's coins.

Three things here are worth a gate, and one of them involves real money.
"""
import json
import os
import re
import unittest

from churchill.world.config import ROOT

CATALOG = os.path.join(ROOT, "src", "content", "economy.json")
ECONOMY_JS = os.path.join(ROOT, "src", "game", "economy.js")
VEHICLES = os.path.join(ROOT, "src", "assets", "vehicles.json")


def read(path):
    with open(path, encoding="utf-8") as fh:
        return fh.read()


class CatalogTests(unittest.TestCase):
    def setUp(self):
        self.cat = json.loads(read(CATALOG))
        self.js = read(ECONOMY_JS)

    def test_an_upgrade_has_one_more_level_than_it_has_prices(self):
        """Index 0 is 'none', so N prices buy N levels on top of it.

        Get this wrong by one and the shop sells a level whose effect is the
        same as the level below — the player pays and nothing happens.
        """
        for line, u in self.cat["upgrades"].items():
            if line.startswith("_"):
                continue
            self.assertEqual(len(u["levels"]), len(u["prices"]) + 1,
                             f"{line}: {len(u['levels'])} levels for "
                             f"{len(u['prices'])} prices")

    def test_an_upgrade_ladder_moves_in_one_direction(self):
        # A ladder that reverses means a level makes you WORSE, which no shop
        # copy explains and no player would guess.
        for line, u in self.cat["upgrades"].items():
            if line.startswith("_"):
                continue
            lv = u["levels"]
            up = all(b >= a for a, b in zip(lv, lv[1:]))
            down = all(b <= a for a, b in zip(lv, lv[1:]))
            self.assertTrue(up or down, f"{line}'s ladder changes direction: {lv}")
            self.assertTrue(all(b > a for a, b in zip(u["prices"], u["prices"][1:])),
                            f"{line}'s prices do not rise: {u['prices']}")

    def test_the_iap_product_ids_are_unique_and_well_formed(self):
        """REAL MONEY. A `productId` must match a Play Console entry exactly;
        a typo is a purchase that takes the money and credits nothing."""
        ids = [p["productId"] for p in self.cat["coinPacks"]["list"]]
        self.assertEqual(len(ids), len(set(ids)), f"duplicate product ids: {ids}")
        for p in self.cat["coinPacks"]["list"]:
            self.assertRegex(p["productId"], r"^[a-z0-9_]+$",
                             "a Play product id is lowercase, digits and underscores")
            self.assertGreater(p["coins"], 0, f"{p['productId']} credits nothing")
        # more money should never buy fewer coins
        packs = sorted(self.cat["coinPacks"]["list"], key=lambda p: p["coins"])
        rates = [p["coins"] / float(p["usd"].lstrip("$")) for p in packs]
        self.assertTrue(all(b >= a for a, b in zip(rates, rates[1:])),
                        f"a bigger pack is worse value: {rates}")

    def test_the_colours_are_unique(self):
        ids = [c["id"] for c in self.cat["colors"]["list"]]
        hexes = [c["hex"] for c in self.cat["colors"]["list"]]
        self.assertEqual(len(ids), len(set(ids)))
        self.assertEqual(len(hexes), len(set(hexes)),
                         "two swatches with the same hex are two things to buy "
                         "that look identical on the vehicle")

    def test_the_wallet_stayed_in_the_engine(self):
        # `ensureEconomy` is a save migration, not content.
        self.assertIn("export function ensureEconomy", self.js)
        self.assertNotRegex(self.js, r"COINS_PER_DELIVERY = \d",
                            "an earn rate is a literal in the module again")
        self.assertNotRegex(self.js, r'\{ id: "col_',
                            "the paint swatches are back in the module")

    def test_vehicle_prices_are_not_here(self):
        """They belong to the VEHICLE. Two hand-kept lists meant 'does this
        vehicle exist' and 'what does it cost' lived in different files and
        could disagree — a price for a key with no vehicle simply did nothing."""
        self.assertNotIn("VEHICLE_PRICES = {", self.js)
        self.assertIn("price", read(VEHICLES))
