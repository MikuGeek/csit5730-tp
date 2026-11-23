import hashlib
import ipaddress
import secrets
import struct
from collections import OrderedDict, Counter
from dataclasses import dataclass, field


CAPTURE_STATS, EXEC, CONNECT, CANARY = range(4)
WIRE = struct.Struct("=QQQIIIHH16s32s32s")
WINDOW_NS = 10_000_000_000
THRESHOLD = 8
MAX_PROCESSES = 4096
MAX_ENDPOINTS = 64
CHECKS = {"ancestry", "destinations", "both"}


def endpoint_key(address, port):
    address = ipaddress.ip_address(address)
    return bytes([address.version]) + address.packed + port.to_bytes(2, "big")


def image_name(name):
    image = name.encode()
    if not 1 <= len(image) < 31 or b"/" in image or b"\0" in image:
        raise ValueError("profile images must be basenames shorter than 31 bytes")
    return image


@dataclass(frozen=True)
class Profile:
    check: str
    parents: frozenset[bytes]
    endpoints: frozenset[bytes]


def load_profiles(document):
    services = document["services"]
    if not isinstance(services, dict) or len(services) > MAX_PROCESSES:
        raise ValueError("invalid services object")
    profiles = {}
    for name, policy in services.items():
        check = policy["check"]
        parents = frozenset(image_name(parent) for parent in policy["parents"])
        endpoints = frozenset(endpoint_key(address, port) for address, port in policy["destinations"])
        if check not in CHECKS or not parents or len(parents) > MAX_ENDPOINTS or len(endpoints) > MAX_ENDPOINTS:
            raise ValueError("invalid profile check, parents or destination count")
        if check != "ancestry" and not endpoints:
            raise ValueError("a destination check needs at least one allowed endpoint")
        profiles[image_name(name)] = Profile(check, parents, endpoints)
    return profiles


@dataclass
class Window:
    case_id: str
    deadline: int
    endpoints: set[bytes]
    image: bytes
    chain: tuple[bytes, ...]
    complete: bool = True


@dataclass
class Process:
    image: bytes = b""
    chain: tuple[bytes, ...] = ()
    recent: OrderedDict = field(default_factory=OrderedDict)
    pending: Window | None = None
    latest: int = 0


class Detector:
    def __init__(self, profiles, emit, *, salt=None, process_limit=MAX_PROCESSES):
        self.profiles = profiles
        self.emit = emit
        self.salt = secrets.token_bytes(32) if salt is None else salt
        self.process_limit = process_limit
        self.processes = OrderedDict()
        self.active = {}
        self.counts = Counter(exec=0, connect=0, canary=0)
        self.families = Counter(ipv4=0, ipv6=0)
        self.alerts = Counter(unexpected_exec=0, fanout=0, canary=0)
        self.drops = self.serial = self.evictions = self.uncorrelated = 0

    def token(self, prefix, value):
        digest = hashlib.blake2s(value, key=self.salt, person=prefix.encode(), digest_size=12)
        return f"{prefix}_{digest.hexdigest()}"

    def alert(self, rule, distinct=None):
        self.serial += 1
        self.alerts[rule] += 1
        case_id = f"case-{self.serial}"
        record = {"kind": "alert", "id": case_id, "rule": rule}
        if distinct is not None:
            record["distinct"] = distinct
        self.emit(record)
        return case_id

    def publish(self, key, process, complete=True):
        window = process.pending
        if window is None:
            return
        process.pending = None
        self.active.pop(key, None)
        policy = self.profiles.get(window.image)
        ancestry = None if not window.chain else {
            "id": "ancestry", "chain": [self.token("img", name) for name in window.chain],
        }
        destinations = {
            "id": "destinations", "endpoints": sorted(self.token("dst", item) for item in window.endpoints),
        }
        profile = None if not policy else {
            "id": "profile", "check": policy.check,
            "parents": sorted(self.token("img", name) for name in policy.parents),
            "endpoints": sorted(self.token("dst", item) for item in policy.endpoints),
        }
        self.emit({
            "kind": "case", "id": window.case_id, "rule": "fanout", "distinct": THRESHOLD,
            "service": self.token("img", window.image) if window.image else None,
            "complete": window.complete and complete and not self.drops,
            "evidence": {"ancestry": ancestry, "destinations": destinations, "profile": profile},
        })

    def advance(self, watermark):
        if watermark:
            for key, process in tuple(self.active.items()):
                if process.pending.deadline <= watermark:
                    self.publish(key, process)

    def feed(self, frame):
        now, start, parent_start, kind, pid, ppid, family, port, address, image, parent = WIRE.unpack(frame)
        if kind == CAPTURE_STATS:
            if start > self.drops:
                self.drops = start
                self.emit({"kind": "capture_gap", "drops": start})
            self.advance(now)
            return
        if kind == CANARY:
            self.counts["canary"] += 1
            self.alert("canary")
            return
        if kind not in {EXEC, CONNECT}:
            raise ValueError("unknown capture event")
        self.counts["exec" if kind == EXEC else "connect"] += 1
        if kind == CONNECT:
            if family not in {2, 10}:
                raise ValueError("invalid capture address family")
            self.families["ipv4" if family == 2 else "ipv6"] += 1
        if not pid or not start:
            self.uncorrelated += 1
            return
        key = (pid, start)
        process = self.processes.get(key)
        if process is None:
            if len(self.processes) >= self.process_limit:
                old_key, old_process = self.processes.popitem(last=False)
                self.publish(old_key, old_process, complete=False)
                self.evictions += 1
            self.processes[key] = process = Process()
        else:
            self.processes.move_to_end(key)
        late = now < process.latest
        if late and process.pending:
            process.pending.complete = False
        now = process.latest = max(now, process.latest)
        if process.pending and now >= process.pending.deadline:
            self.publish(key, process)
        if kind == EXEC:
            self.publish(key, process, complete=False)
            process.recent.clear()
            process.image = image.split(b"\0", 1)[0]
            direct_parent = parent.split(b"\0", 1)[0]
            known_parent = self.processes.get((ppid, parent_start))
            ancestors = known_parent.chain if known_parent and known_parent.image == direct_parent else ()
            process.chain = (direct_parent, *ancestors[:5]) if direct_parent else ()
            profile = self.profiles.get(process.image)
            if profile and direct_parent and direct_parent not in profile.parents:
                self.alert("unexpected_exec")
            return

        endpoint = (b"\x04" + address[:4] if family == 2 else b"\x06" + address) + port.to_bytes(2, "big")
        if process.pending:
            window = process.pending
            if len(window.endpoints) < MAX_ENDPOINTS:
                window.endpoints.add(endpoint)
            elif endpoint not in window.endpoints:
                window.complete = False
            return
        recent = process.recent
        while recent and next(iter(recent.values())) <= now - WINDOW_NS:
            recent.popitem(last=False)
        recent[endpoint] = now
        recent.move_to_end(endpoint)
        if len(recent) >= THRESHOLD:
            case_id = self.alert("fanout", distinct=len(recent))
            process.pending = Window(case_id, next(iter(recent.values())) + WINDOW_NS,
                                     set(recent), process.image, process.chain, complete=not late)
            self.active[key] = process
            recent.clear()

    def finish(self, clean):
        for key, process in tuple(self.active.items()):
            self.publish(key, process, complete=False)
        self.emit({"kind": "summary", "clean": clean, "events": self.counts, "families": self.families,
                   "alerts": self.alerts, "drops": self.drops, "evictions": self.evictions,
                   "uncorrelated": self.uncorrelated})
