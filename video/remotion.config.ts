import { Config } from '@remotion/cli/config'

// Optional: point Remotion at an existing Chrome headless shell instead of
// letting it download one (useful offline or in sandboxes).
if (process.env.REMOTION_BROWSER_EXECUTABLE) Config.setBrowserExecutable(process.env.REMOTION_BROWSER_EXECUTABLE)
Config.setVideoImageFormat('jpeg')
