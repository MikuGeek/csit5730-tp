#import "@preview/touying:0.8.0": config-colors, config-common, config-page, themes
#import "@preview/lilaq:0.6.0" as lq
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
    footer: [TraceTriage], subslide-preamble: none,
    config-common(slide-level: 1, new-section-slide-fn: none),
    config-colors(primary: primary, neutral-light: secondary),
    config-page(fill: surface, margin: (x: 5 * unit, top: 7 * unit, bottom: 5 * unit)),
  )
  set text(font: serif, size: 20pt, fill: on-surface, hyphenate: false)
  body
}

#let cover(title, subtitle) = title-slide(config: config-page(fill: primary))[
  #align(left, stack(dir: ttb, spacing: 2 * unit,
    chip([CSIT5730  /  SUGGESTION 2]), display(title),
    role(28pt, "regular", on-primary, subtitle),
  ))
]
#let claim(body) = block(below: 3 * unit, headline(body))
#let note(body) = block(above: 2 * unit, caption(body))
#let card(tag, title, detail) = panel(stack(dir: ttb, spacing: unit,
  label(tag), role(22pt, "semibold", on-surface, title), caption(detail),
))
#let flow(..items) = grid(columns: items.pos().map(_ => 1fr).intersperse(auto),
  gutter: unit / 2, align: horizon, ..items.pos().intersperse(arrow))
#let rows(..pairs) = stack(dir: ttb, spacing: unit, ..pairs.pos().map(pair => panel(
  grid(columns: (1.45fr, auto, 1fr), column-gutter: 2 * unit, align: horizon,
    body-type(pair.first()), arrow, role(20pt, "semibold", primary, pair.last())),
)))
#let lane(tag, ..steps) = panel(grid(columns: (auto, 1fr), gutter: 2 * unit, align: horizon,
  chip(tag), align(center, steps.pos().map(body-type).intersperse(box(inset: (x: unit), arrow)).sum()),
))
#let lanes(..items) = stack(dir: ttb, spacing: unit, ..items.pos())
#let ledger(headings, ..entries) = table(
  columns: headings.map(_ => auto), align: left + horizon, stroke: none,
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
      lq.diagram(width: 100%, height: 16 * unit, legend: none,
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
