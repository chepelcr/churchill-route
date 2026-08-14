"""LOS SERVICIOS EXTERNOS — `src/content/services.json`.

The ids and URLs that connect this game to something outside it: AdSense/AdMob,
Play Billing, GA4, the runtime content endpoint. Every one is a string that has
to match a console entry somewhere else EXACTLY, and every one fails quietly
when it does not — an ad unit that does not exist simply never fills, and a
product id that does not match takes the payment and credits nothing.

NOTHING SECRET IS IN THAT FILE and nothing secret may go into it. It is bundled
into the client, so anything there is public by construction; a publisher id
ships in the page source of every ad-supported site on the web because the
browser has to send it. What the registry buys is that four modules stop each
holding their own copy — not concealment.

The last test is the one with teeth: it scans for a secret-looking string, so
the day somebody reaches for this file as a convenient place for a key, the
suite says no.
"""
import json
import os
import re
import unittest

from churchill.world.config import ROOT

SERVICES = os.path.join(ROOT, "src", "content", "services.json")
MONETIZE = os.path.join(ROOT, "src", "monetize")


def read(path):
    with open(path, encoding="utf-8") as fh:
        return fh.read()


def code(path):
    """Source without comments — a literal quoted in a note is documentation."""
    src = read(path)
    src = re.sub(r"/\*.*?\*/", "", src, flags=re.S)
    return re.sub(r"^\s*//.*$", "", src, flags=re.M)


class ServiceRegistryTests(unittest.TestCase):
    def setUp(self):
        self.doc = json.loads(read(SERVICES))

    def test_the_ad_ids_are_well_formed(self):
        ads = self.doc["ads"]
        self.assertRegex(ads["publisher"], r"^ca-pub-\d+$")
        self.assertRegex(ads["webClient"], r"^ca-pub-\d+$")
        for key in ("interstitialUnit", "rewardedUnit"):
            self.assertRegex(ads[key], r"^ca-app-pub-\d+/\d+$",
                             f"{key} is not an AdMob unit id")
        # The AdMob units must belong to the AdSense publisher, or they are
        # somebody else's inventory and will simply never fill.
        pub = ads["publisher"].split("-")[-1]
        for key in ("interstitialUnit", "rewardedUnit"):
            self.assertIn(pub, ads[key], f"{key} belongs to a different publisher")

    def test_the_ad_policy_is_the_one_that_was_decided(self):
        """Not a default: no banners, opt-in rewarded, and a grace period for
        somebody still deciding whether they like the game."""
        ads = self.doc["ads"]
        self.assertGreaterEqual(ads["graceRuns"], 1,
                                "a brand-new player would meet an interstitial "
                                "while deciding whether to keep playing")
        self.assertGreaterEqual(ads["interstitialEvery"], 3,
                                "an interstitial this often is the intrusive kind "
                                "the monetisation plan rules out")

    def test_analytics_ships_off(self):
        # Empty means OFF and nothing is loaded. Shipping an id by accident
        # starts collecting from players who were never told.
        self.assertEqual(self.doc["analytics"]["measurementId"], "",
                         "a GA4 id is committed; analytics ships off by default")

    def test_the_content_url_is_https(self):
        """It is the ONE thing fetched rather than bundled, so it is the only
        surface where what the game runs is not what the build produced."""
        self.assertTrue(self.doc["content"]["url"].startswith("https://"),
                        "the runtime content endpoint must be https")

    def test_the_modules_hold_no_copies(self):
        for name in os.listdir(MONETIZE):
            if not name.endswith(".js"):
                continue
            src = code(os.path.join(MONETIZE, name))
            self.assertNotRegex(src, r'"ca-(app-)?pub-\d',
                                f"{name} holds its own ad id again")
        self.assertNotRegex(code(os.path.join(ROOT, "src", "content", "remote.js")),
                            r'"https://\w', "remote.js holds its own endpoint again")

    def test_no_secret_ends_up_in_here(self):
        """THE ONE WITH TEETH.

        This file is bundled into the client, so anything in it is public. The
        ids above are meant to be — a private key, a service-account JSON or an
        API token would not be, and this is a convenient-looking place to put
        one.
        """
        blob = read(SERVICES)
        for pattern, what in [
            (r"-----BEGIN [A-Z ]*PRIVATE KEY", "a private key"),
            (r"\bAIza[0-9A-Za-z_-]{35}\b", "a Google API key"),
            (r"\bsk-[A-Za-z0-9]{20,}", "a secret key"),
            (r'"(client_secret|private_key|api_key|token|password)"', "a secret-looking field"),
        ]:
            self.assertNotRegex(blob, pattern,
                                f"{what} is in a file that ships to every player")
