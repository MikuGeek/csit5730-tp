#import "@preview/touying:0.8.0": config-colors, config-common, config-page, themes
#import "@preview/lilaq:0.6.0" as lq
#import "@preview/fletcher:0.5.8" as fl
#import themes.simple: simple-theme, title-slide

#let primary = rgb("#49459B")
#let on-primary = white
#let primary-container = rgb("#E3DFFF")
#let tertiary = rgb("#006A60")
#let tertiary-container = rgb("#B2F1E4")
#let surface = rgb("#FBF8FF")
#let surface-container = rgb("#F0EDF6")
#let on-surface = rgb("#1B1B22")
#let secondary = rgb("#58586B")
#let outline = rgb("#C8C5D0")
#let unit = 8pt
#let serif = "IBM Plex Serif"
#let role(size, weight, fill, body) = text(font: serif, size: size, weight: weight, fill: fill, body)
#let display = role.with(62pt, "bold", on-primary)
#let headline = role.with(34pt, "semibold", on-surface)
#let label = role.with(14pt, "semibold", primary)
#let body-type = role.with(20pt, "regular", on-surface)
#let caption = role.with(16pt, "regular", secondary)
#let metric = role.with(36pt, "semibold", tertiary)
#let arrow = role(23pt, "semibold", primary, [→])
#let panel(body, fill: surface-container) = block(width: 100%, radius: 2 * unit, inset: 2 * unit, fill: fill, body)
#let chip(body) = box(radius: 3 * unit, inset: (x: 1.5 * unit, y: unit / 2), fill: primary-container, label(body))

#let deck(body) = {
  show: simple-theme.with(
    aspect-ratio: "16-9", header-right: [CSIT5730  /  SUGGESTION 2],
    footer: [TraceTriage], footer-right: context counter(page).display("1 / 1", both: true), subslide-preamble: none,
    config-common(slide-level: 1, new-section-slide-fn: none),
    config-colors(primary: primary, neutral-light: secondary),
    config-page(fill: surface, margin: (x: 5 * unit, top: 7 * unit, bottom: 5 * unit)),
  )
  set text(font: serif, size: 20pt, fill: on-surface, hyphenate: false)
  body
}

#let cover(title, subtitle, incident, question, stages) = title-slide(config: config-page(fill: primary) + config-common(freeze-slide-counter: false))[
  #align(left, stack(dir: ttb, spacing: 2.5 * unit,
    chip([CSIT5730  /  SUGGESTION 2]), display(title),
    role(28pt, "regular", on-primary, subtitle),
    panel(fill: primary-container, stack(dir: ttb, spacing: unit,
      label([OPENING CASE  /  FAN-OUT]), body-type(incident),
      role(23pt, "semibold", primary, question))),
    role(16pt, "semibold", on-primary, stages),
  ))
]
#let claim(body) = block(below: 3 * unit, headline(body))
#let note(body) = block(above: 2 * unit, caption(body))
#let evidence(..items) = block(above: 2 * unit, width: 100%,
  stroke: (top: 1pt + outline), inset: (top: 1.5 * unit), grid(
    columns: items.pos().map(_ => 1fr), column-gutter: 3 * unit,
    ..items.pos().map(((tag, detail)) => stack(dir: ttb, spacing: unit,
      role(14pt, "semibold", tertiary, tag), role(17pt, "regular", on-surface, detail))),
  ))
#let excerpt(tag, body) = block(above: 1.5 * unit, width: 100%,
  fill: primary-container, stroke: (left: 3pt + primary), inset: 1.4 * unit,
  grid(columns: (auto, 1fr), column-gutter: 2 * unit, align: horizon,
    label(tag), role(17pt, "regular", on-surface, body)))
#let card(tag, title, detail) = panel(stack(dir: ttb, spacing: unit,
  label(tag), role(22pt, "semibold", on-surface, title), caption(detail),
))
#let flow(..items) = grid(columns: items.pos().map(_ => 1fr).intersperse(auto),
  gutter: unit / 2, align: horizon, ..items.pos().intersperse(arrow))
#let map-diagram(..parts) = align(center, fl.diagram(
  spacing: (5 * unit, 5.5 * unit), node-shape: rect, node-corner-radius: unit,
  node-inset: unit, edge-stroke: 1.5pt + primary, label-size: 12pt, ..parts,
))
#let station(pos, title, detail: none, kind: "step") = {
  let (fill, ink) = (step: (surface-container, on-surface), decision: (primary-container, primary),
    outcome: (tertiary-container, tertiary), hold: (rgb("#FFE3BC"), rgb("#633C00"))).at(kind)
  fl.node(pos, align(center, stack(dir: ttb, spacing: unit / 2,
    role(18pt, "semibold", ink, title), if detail != none { role(14pt, "regular", on-surface, detail) })),
    fill: fill, stroke: 0.7pt + ink.transparentize(55%))
}
#let link-nodes(from, to, optional: false) = fl.edge(from, to, if optional { "--|>" } else { "-|>" })
#let zone(..cells) = fl.node(enclose: cells.pos(), inset: unit, stroke: (paint: outline, dash: "dashed"), fill: none)
#let ledger(headings, ..entries) = table(
  columns: headings.slice(0,-1).map(_ => auto) + (1fr,), align: left + horizon, stroke: none,
  inset: (x: 2 * unit, y: 1.3 * unit),
  fill: (_, row) => if row == 0 { primary-container } else if calc.odd(row) { surface-container } else { surface },
  table.header(..headings.map(label)), ..entries.pos().flatten().map(body-type),
)
#let comparison(unit-label, ticks, entries, result, reading) = {
  let positions = range(entries.len())
  let ceiling = ticks.last()
  let values = entries.map(entry => entry.at(1))
  assert(values.all(value => value >= 0 and value <= ceiling))
  grid(columns: (2.2fr, 1fr), gutter: 3 * unit, align: horizon,
    stack(dir: ttb, spacing: 2 * unit, label(unit-label), {
      set text(size: 14pt)
      lq.diagram(width: 100%, height: 19 * unit, legend: none,
        xlim: (-0.5, entries.len() - 0.5), ylim: (0, ceiling * 1.22),
        xaxis: (ticks: positions.zip(entries.map(entry => entry.first())), subticks: none, mirror: false),
        yaxis: (ticks: ticks.map(tick => (tick, str(tick))), subticks: none, mirror: false), grid: none,
        lq.bar(positions, values, width: 0.52, fill: (secondary, primary, tertiary)),
        ..positions.map(index => lq.place(index, values.at(index) + ceiling * 0.08,
          label(entries.at(index).last()))),
      )
    }),
    panel(fill: tertiary-container, stack(dir: ttb, spacing: unit, metric(result), body-type(reading))),
  )
}
