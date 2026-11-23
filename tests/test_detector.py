import ipaddress
import json
import unittest

from ids.detector import CAPTURE_STATS, CANARY, CONNECT, EXEC, WIRE, WINDOW_NS, Detector, load_profiles


def frame(kind, stamp=1, start=100, pid=20, family=2, port=39100, image=b"", parent=b"", parent_pid=10,
          parent_start=50, address="127.0.0.1"):
    return WIRE.pack(stamp, start, parent_start, kind, pid, parent_pid, family, port,
                     ipaddress.ip_address(address).packed, image, parent)


class DetectorTests(unittest.TestCase):
    def setUp(self):
        self.records = []
        self.profiles = load_profiles({"services": {"client": {"check": "ancestry", "parents": ["approved"],
                                                                "destinations": []}}})
        self.detector = Detector(self.profiles, self.records.append, salt=b"fixture")

    def send(self, kind, **fields):
        self.detector.feed(frame(kind, **fields))

    def fanout(self, **fields):
        for offset in range(8):
            self.send(CONNECT, port=39100 + offset, **fields)

    def find(self, kind):
        return [record for record in self.records if record["kind"] == kind]

    def test_canary_and_unexpected_exec_are_immediate(self):
        self.send(EXEC, image=b"client", parent=b"approved")
        self.send(EXEC, image=b"client", parent=b"other")
        self.send(CANARY)
        self.assertEqual([row["rule"] for row in self.find("alert")], ["unexpected_exec", "canary"])

    def test_distinct_address_families_and_frozen_snapshot(self):
        self.send(EXEC, image=b"client", parent=b"approved")
        for offset in range(4):
            self.send(CONNECT, port=offset)
            self.send(CONNECT, family=10, address="::1", port=offset)
        self.assertEqual(self.find("alert")[0]["distinct"], 8)
        self.assertFalse(self.find("case"))
        self.send(CONNECT, stamp=WINDOW_NS - 5, port=1234)
        self.send(CAPTURE_STATS, stamp=WINDOW_NS + 1, start=0)
        (case,) = self.find("case")
        self.assertTrue(case["complete"])
        self.assertEqual(len(case["evidence"]["destinations"]["endpoints"]), 9)
        payload = json.dumps(case)
        for raw in ("client", "approved", "127.0.0.1", "::1"):
            self.assertNotIn(raw, payload)

    def test_repeated_and_old_destinations_do_not_count(self):
        for offset in range(7):
            for stamp in range(2):
                self.send(CONNECT, stamp=stamp + 1, port=offset)
        self.send(CONNECT, stamp=WINDOW_NS + 2, port=100)
        self.assertFalse(self.find("alert"))

    def test_pid_reuse_does_not_merge(self):
        for offset in range(4):
            self.send(CONNECT, start=100, port=offset)
            self.send(CONNECT, start=200, port=offset + 4)
        self.assertFalse(self.find("alert"))

    def test_reexec_does_not_merge_or_certify_pending_case(self):
        self.send(EXEC, image=b"client", parent=b"approved")
        self.fanout()
        self.send(EXEC, stamp=2, image=b"other", parent=b"approved")
        (case,) = self.find("case")
        self.assertFalse(case["complete"])

    def test_drop_invalidates_window_without_erasing_local_alert(self):
        self.fanout()
        self.send(CAPTURE_STATS, stamp=WINDOW_NS + 1, start=3)
        self.assertEqual(self.find("capture_gap"), [{"kind": "capture_gap", "drops": 3}])
        self.assertTrue(self.find("alert"))
        self.assertFalse(self.find("case")[0]["complete"])

    def test_state_and_window_are_bounded(self):
        self.detector.process_limit = 1
        self.fanout()
        for offset in range(100):
            self.send(CONNECT, port=offset)
        self.send(EXEC, start=200)
        (case,) = self.find("case")
        self.assertEqual(len(self.detector.processes), 1)
        self.assertEqual(len(case["evidence"]["destinations"]["endpoints"]), 64)
        self.assertFalse(case["complete"])

    def test_shutdown_retains_incomplete_incidents(self):
        self.fanout()
        self.detector.finish(clean=True)
        self.assertFalse(self.find("case")[0]["complete"])
        self.assertTrue(self.find("summary")[0]["clean"])


if __name__ == "__main__":
    unittest.main()
