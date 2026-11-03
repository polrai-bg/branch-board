# Branch Board · visual direction

Status: active. This is the design paper for the current UI shell.

## Intent

Keep Branch Board’s job clear — reconcile GitHub + local branches — while moving the shell into the same design space as today’s desktop tools.

| Reference | What to take | What not to copy |
| --- | --- | --- |
| GitKraken | Dense, scannable branch data; colored status dots; graph lanes that read as paths | Heavy chrome, loud panels, “IDE skin” overload |
| Kepler-style tools | Calm hierarchy, soft grouping, progress that feels measured | Decorative dashboards |
| Claude Desktop | Warm neutrals, soft elevation, quiet chrome, one accent used sparingly | Chat-product metaphors, marketing gradients |

The board should feel like a precise instrument on a quiet desk: paper warmth, not plastic gloss.

## Principles

1. **Warm paper, not cold glass.** Backgrounds lean beige/charcoal, never pure `#000` / `#fff`.
2. **Soft elevation.** Surfaces lift with hairline borders and a short shadow. No hard Mac-window chrome stacks.
3. **One accent.** Coral for focus and counts. Status colors stay semantic (conflict, PR, merge) and sit on the data, not the chrome.
4. **Quiet type.** System sans for UI; mono only for branch names and paths. Secondary text is muted, never gray-on-gray mush.
5. **Density with air.** Tables stay compact; group headers and task lists get breathing room.
6. **Controls as chips.** Search, selects, and filters share the same soft pill language.

## Layout

```
┌ toolbar (blurred bar) ─────────────────────────────┐
│ brand · search · hide merged · menu                │
├ alerts (if any) ───────────────────────────────────┤
├ scope filters ─────────────────────────────────────┤
├ metric chips ──────────────────────────────────────┤
│                                                    │
│  sheet (inset surface)                             │
│   inbox table / tasks list / graph / cards         │
│                                                    │
└────────────────────────────────────────────────────┘
```

The sheet sits inset from the page edge so the warm background reads as a desk, and the content as a card.

## Tokens (summary)

| Token | Light | Dark |
| --- | --- | --- |
| `--bg` | warm paper | warm charcoal |
| `--surface` | soft cream | raised charcoal |
| `--bar` | translucent paper | translucent charcoal |
| `--accent` | Claude coral | lighter coral |
| `--separator` | low-contrast warm gray | low-contrast warm edge |

Full values live in `src/app/globals.css`.

## Components

- **Toolbar** — frosted bar, brand wordmark, soft search field.
- **Chips** — idle = fill; active = coral tint.
- **Table groups** — sentence case, coral count pill, no shouting uppercase banners.
- **Status** — 6px dot + label; colors unchanged in meaning.
- **Tasks list** — AskProSe-like tree; collapsed by default; issue/PR badges on the right.
- **Graph / cards** — same surface language as the sheet.

## Out of scope

- New navigation IA
- Light/dark toggle (still follows system)
- Rebranding agents or inventing illustrations
