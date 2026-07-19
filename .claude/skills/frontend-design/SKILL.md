---
name: frontend-design
description: Guidance for distinctive, intentional visual design when building new UI or reshaping an existing one. Helps with aesthetic direction, typography, and making choices that don't read as templated defaults.
license: Complete terms in LICENSE.txt
source: https://github.com/anthropics/skills/blob/main/skills/frontend-design/SKILL.md
---

# Frontend Design

Approach this as the design lead at a small studio known for giving every client a visual identity that could not be mistaken for anyone else's. This client has already rejected proposals that felt templated, and is paying for a distinctive point of view: make deliberate, opinionated choices about palette, typography, and layout that are specific to this brief, and take one real aesthetic risk you can justify.

## Ground it in the subject

If the brief does not pin down what the product or subject is, pin it yourself before designing: name one concrete subject, its audience, and the page's single job, and state your choice. If there's any information in your memory about the human's preferences, context about what they're building, or designs you've made before – use that as a hint. The subject's own world, its materials, instruments, artifacts, and vernacular, is where distinctive choices come from. Build with the brief's real content and subject matter throughout.

## Design principles

For web designs, the hero is a thesis. Open with the most characteristic thing in the subject's world, in whatever form makes sense for it: a headline, an image, an animation, a live demo, an interactive moment.

Typography carries the personality of the page. Pair the display and body faces deliberately, not the same families you would reach for on any other project, and set a clear type scale with intentional weights, widths, and spacing.

Structure is information. Structural devices, numbering, eyebrows, dividers, labels, should encode something true about the content, not decorate it.

Leverage motion deliberately. Think about where and if animation can serve the subject: a page-load sequence, a scroll-triggered reveal, hover micro-interactions, ambient atmosphere.

Match complexity to the vision. Maximalist directions need elaborate execution; minimal directions need precision in spacing, type, and detail.

## Process: brainstorm, explore, plan, critique, build, critique again

Work in two passes:

1. **Brainstorm** a compact token system: Color (4–6 named hex values), Type (2+ roles: display + body), Layout (ASCII wireframes), Signature (the single unique element this page will be remembered by).

2. **Review** that plan against the brief before building. If any part reads like a generic default, revise it. Only after confirming relative uniqueness, write the code.

Avoid these common AI design defaults unless they genuinely fit the brief:
- Warm cream background (#F4F1EA) + high-contrast serif + terracotta accent
- Near-black background + single bright acid-green or vermilion accent
- Broadsheet-style with hairline rules + dense newspaper columns

## Restraint and self-critique

Spend your boldness in one place. Let the signature element be the one memorable thing, keep everything around it quieter. A page with ten bold ideas has none.

## Writing

Copy can make a design feel as templated as the design itself. Avoid:
- Generic hero lines ("Build faster. Ship smarter.")
- Bullet lists of features that could apply to any product
- "Powerful", "seamless", "intuitive", "robust"

Instead, write copy that could only be for this product, for this audience, at this moment.

## RTL / Arabic considerations (GhostForge-specific)

When building for Arabic/RTL audiences:
- Use `dir="rtl"` on root elements
- Prefer logical CSS properties (`margin-inline-start` over `margin-left`)
- Choose Arabic-optimised typefaces: Cairo, Tajawal, Noto Sans Arabic
- Mirror layout direction but keep images/icons unmirrored unless they have directional meaning
- Test with real Arabic content, not placeholder text
