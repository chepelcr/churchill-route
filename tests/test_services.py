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
        """TWO SYSTEMS, and that is why they are two blocks. The web is H5 Games
        Ads (the `adBreak` API) and the app is AdMob: different ids, different
        placement names, a different way of asking for an ad. Flat, this is how
        an app id ends up where a web one belonged."""
        web, app = self.doc["ads"]["web"], self.doc["ads"]["app"]
        self.assertRegex(web["client"], r"^ca-pub-\d+$")
        self.assertRegex(app["applicationId"], r"^ca-app-pub-\d+~\d+$",
                         "an AdMob APPLICATION id uses `~`, a UNIT id uses `/`")
        for key, unit in app["placements"].items():
            self.assertRegex(unit, r"^ca-app-pub-\d+/\d+$",
                             f"app placement '{key}' is not an AdMob unit id")
        # Everything must belong to the same publisher, or it is somebody
        # else's inventory and will simply never fill — with no error anywhere.
        pub = web["client"].split("-")[-1]
        self.assertIn(pub, app["applicationId"], "the app belongs to a different publisher")
        for key, unit in app["placements"].items():
            self.assertIn(pub, unit, f"app placement '{key}' belongs to a different publisher")

    def test_the_app_id_matches_the_android_manifest(self):
        """THE ONE REAL DRIFT GATE HERE.

        The SDK reads the application id from `AndroidManifest.xml`, not from
        this registry — so the registry is a RECORD of it, and a record that
        can drift is worse than none. A mismatch means the app initialises
        against the wrong account and every ad silently no-fills.
        """
        manifest = os.path.join(ROOT, "android", "app", "src", "main", "AndroidManifest.xml")
        if not os.path.exists(manifest):
            self.skipTest("no Android project in this checkout")
        m = re.search(r'APPLICATION_ID"\s*\n?\s*android:value="([^"]+)"', read(manifest))
        self.assertIsNotNone(m, "the manifest declares no AdMob APPLICATION_ID")
        self.assertEqual(m.group(1), self.doc["ads"]["app"]["applicationId"],
                         "the AndroidManifest and services.json disagree about the "
                         "AdMob application id")

    def test_every_placement_the_code_asks_for_exists(self):
        """A placement the module reads and the registry does not define is
        `undefined`, which reaches the SDK as an ad request for nothing."""
        src = read(os.path.join(MONETIZE, "ads.js"))
        for key in set(re.findall(r"APP\.placements\.(\w+)", src)):
            self.assertIn(key, self.doc["ads"]["app"]["placements"],
                          f"ads.js asks for app placement '{key}'")
        for key in set(re.findall(r"WEB\.placements\.(\w+)", src)):
            self.assertIn(key, self.doc["ads"]["web"]["placements"],
                          f"ads.js asks for web placement '{key}'")

    def test_no_placement_is_dead(self):
        # The other direction: a unit id nobody asks for is inventory that will
        # never serve, and it reads as if the game shows more ads than it does.
        src = read(os.path.join(MONETIZE, "ads.js"))
        for key in self.doc["ads"]["app"]["placements"]:
            self.assertIn(f"APP.placements.{key}", src,
                          f"app placement '{key}' is configured but never used")
        for key in self.doc["ads"]["web"]["placements"]:
            self.assertIn(f"WEB.placements.{key}", src,
                          f"web placement '{key}' is configured but never used")

    def test_the_ad_policy_is_the_one_that_was_decided(self):
        """Not a default: no banners, opt-in rewarded, and a grace period for
        somebody still deciding whether they like the game."""
        pol = self.doc["ads"]["policy"]
        self.assertGreaterEqual(pol["graceRuns"], 1,
                                "a brand-new player would meet an interstitial "
                                "while deciding whether to keep playing")
        self.assertGreaterEqual(pol["interstitialEvery"], 3,
                                "an interstitial this often is the intrusive kind "
                                "the monetisation plan rules out")
        self.assertFalse(pol["banners"],
                         "A BANNER COVERS THE ROAD WHILE DRIVING. That is the "
                         "reason, and it does not change with revenue.")
        self.assertEqual(pol["rewarded"], "opt-in")

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
