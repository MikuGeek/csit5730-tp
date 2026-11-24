#import "theme.typ": map-diagram, station, link-nodes, zone

#let ambiguity = map-diagram(
  station((0,0), [Routine promotion], detail: [Approved job runs]),
  station((0,1), [Unapproved launch], detail: [Same connection pattern]),
  station((1,0.5), [8 destinations], detail: [One process · 10 seconds]),
  station((2,0.5), [Fan-out warning], detail: [Authorization unknown], kind: "decision"),
  link-nodes((0,0), (1,0.5)), link-nodes((0,1), (1,0.5)), link-nodes((1,0.5), (2,0.5)),
)

#let promotion = map-diagram(
  station((0,1), [One bulletin], detail: [Two authorized paths]),
  station((1,0), [Override withdrawn], detail: [Normal promotion ran]),
  station((1,1), [Override exercised], detail: [Exception path ran]),
  station((1,2), [Override on paper], detail: [Execution unconfirmed]),
  station((2,0), [Deployment ledger], detail: [Which build shipped?], kind: "decision"),
  station((2,1), [Approval receipt], detail: [Who signed the exception?], kind: "decision"),
  station((2,2), [Hold], detail: [No verifier read], kind: "hold"),
  ..range(3).map(row => link-nodes((0,1), (1,row))),
  ..range(3).map(row => link-nodes((1,row), (2,row))),
)

#let architecture = map-diagram(
  station((0,0), [exec], detail: [Process image]),
  station((1,0), [connect], detail: [Address + port]),
  station((2,0), [openat], detail: [Canary path]),
  station((1,1), [1 MiB ring], detail: [libbpf reader]),
  station((2,1), [Local rules], detail: [Python detector]),
  station((3,1), [Warning], detail: [On the VPS], kind: "outcome"),
  station((2,2), [Fan-out case], detail: [Pseudonymized replay]),
  station((1,2), [Pi selector], detail: [Node.js · model API], kind: "decision"),
  station((0,2), [Receipt check], detail: [Deterministic code], kind: "outcome"),
  zone((0,0), (2,0)), zone((0,2), (2,2)),
  ..range(3).map(col => link-nodes((col,0), (1,1))),
  link-nodes((1,1), (2,1)), link-nodes((2,1), (3,1)),
  link-nodes((2,1), (2,2), optional: true), link-nodes((2,2), (1,2)), link-nodes((1,2), (0,2)),
)

#let window = map-diagram(
  station((0,0), [First peer], detail: [Window starts]),
  station((1,0), [Eighth peer], detail: [Threshold crossed], kind: "decision"),
  station((2,0), [Window closes], detail: [Snapshot published]),
  station((1,1), [Local warning], detail: [Emit immediately], kind: "outcome"),
  station((2,1), [Case for replay], detail: [Same case ID], kind: "outcome"),
  link-nodes((0,0), (1,0)), link-nodes((1,0), (2,0)),
  link-nodes((1,0), (1,1)), link-nodes((2,0), (2,1)),
)

#let receipt-gate = map-diagram(
  station((0,1), [Pi selects], detail: [One source or hold], kind: "decision"),
  station((1,0), [Read receipt], detail: [At most one]),
  station((2,0), [Bound receipt], detail: [Check conformance]),
  station((1,2), [Hold or failure]),
  station((2,1), [Missing / unbound]),
  station((3,0), [Expected], detail: [Conforms], kind: "outcome"),
  station((3,1), [Suspicious], detail: [Deviates], kind: "outcome"),
  station((3,2), [Review], detail: [Alert stays open], kind: "hold"),
  link-nodes((0,1), (1,0)), link-nodes((0,1), (1,2)), link-nodes((1,0), (2,0)),
  link-nodes((1,0), (2,1)), link-nodes((2,0), (3,0)), link-nodes((2,0), (3,1)),
  link-nodes((1,2), (3,2)), link-nodes((2,1), (3,2)),
)

#let paired-test = map-diagram(
  station((0,1), [80 text views], detail: [16 held-out families]),
  station((1,0.5), [64 resolvable], detail: [One choice per pair], kind: "decision"),
  station((1,2), [16 ambiguous], detail: [Correct choice: hold], kind: "decision"),
  station((2,0), [64 conforming]),
  station((2,1), [64 deviations]),
  station((2,2), [16 unbound cases]),
  station((3,1), [144 incidents], detail: [144 VPS alerts], kind: "outcome"),
  link-nodes((0,1), (1,0.5)), link-nodes((0,1), (1,2)),
  link-nodes((1,0.5), (2,0)), link-nodes((1,0.5), (2,1)), link-nodes((1,2), (2,2)),
  ..range(3).map(row => link-nodes((2,row), (3,1))),
)
