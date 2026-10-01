# GhostForge Agent World Design

## Direction

Agent World is a dark industrial operations floor, not a playful town simulation. Its virtual forge metaphor appears through carbon-steel fields, etched gridwork, ember-brass landmarks, and cyan signal light. The map earns the first viewport, while workflow topology and the event log stay compact and operational.

## Visual system

- **Ground:** `#070b10` and `#091018` with a restrained 48px instrument grid.
- **Surfaces:** `#0c131c`, `#0d151f`, and `#101821`; white borders remain at 10% or below.
- **Signal:** cyan indicates active data and focus; amber identifies source/forge structure; violet identifies dependency topology; emerald, rose, and orange are reserved for operational state.
- **Type:** GhostForge’s existing Space Grotesk display and IBM Plex Sans body variables. Data labels stay compact; monospace is not used as technical decoration.
- **Depth:** offset black shadows and inset highlights make workstations feel physical without glass effects or neon halos.

## Composition

The status strip is dense and subordinate. Filters and the view switch precede a dominant forge floor. Each reported source owns a zone; each reported session owns a workstation. Workflow topology and signal history form a side rail on wide screens and a two-column support row below the map on medium screens. Board and table modes replace the spatial canvas without changing filters.

## Interaction and state

- World, board, and table are explicit pressed-state controls.
- Workstations are keyboard-focusable summaries; table mode carries the densest comparison.
- Loading, authorization failure, empty sources, empty sessions, empty work, stale data, and command success/failure are named directly.
- Polling pauses while the document is hidden, prevents overlap, and aborts initial work on unmount.
- Motion is limited to meaningful refresh/loading feedback and small hover lift; reduced-motion removes it.

## Responsive and RTL

The forge collapses from map plus rail to a single flow without hiding content. Source zones move from two columns to one; control rows stack. All directional spacing uses logical utilities, table headings use `text-start`, and directional affordances receive RTL transforms where meaning requires it.

## Truth contract

No visible worker, source, task, count, progress value, dependency, or event is authored as production data. The frontend federation model may normalize optional connector fields, but absent fields remain “Not reported,” empty, or unknown.
