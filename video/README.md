# GhostForge promo video

A 43-second, 1080p promo for GhostForge JARVIS, built with [Remotion](https://www.remotion.dev).
The rendered file is [`ghostforge.mp4`](ghostforge.mp4).

## Re-render

```bash
cd video
npm ci
npm run render     # writes out/ghostforge.mp4 (regenerates the soundtrack first)
npm run studio     # live preview in the browser, to edit scenes
```

Remotion downloads its own headless Chrome on first render. To use one you
already have, set `REMOTION_BROWSER_EXECUTABLE` to a Chrome **headless shell**
(full Chrome no longer supports the old headless mode Remotion uses).

## What's where

| File | Purpose |
|---|---|
| `src/timeline.json` | Scene order and length (frames at 30 fps). Shared by the video and the soundtrack. |
| `src/GhostForge.tsx` | All eight scenes: intro, surfaces, JARVIS, agent team, Job Hunter, marketplace, remote/hosted, outro. Colours are in `C`. |
| `scripts/gen-audio.mjs` | Generates `public/soundtrack.wav`: an original synthwave bed (pad, bass, arp, drums) with a whoosh and chime at each scene change. No samples or downloads, so it has no licensing strings attached. |
| `remotion.config.ts` | Optional browser override; JPEG frames for faster renders. |

Change a scene's length in `timeline.json` and both the picture and the music
follow. To add narration later, put an audio file in `public/` and add another
`<Audio>` in `GhostForge.tsx` (for example a recorded voiceover, or one made
with `@remotion/elevenlabs`).

## Before sharing

The outro says "Open source" and links to the GitHub repository, which is
private for now. Change that line in the `Outro` scene if you share the video
before the repository goes public.
