// GhostForge JARVIS — macOS Notarization Hook
// Placeholder for electron-builder afterSign hook.
// To enable notarization, set APPLE_ID, APPLE_APP_SPECIFIC_PASSWORD,
// and APPLE_TEAM_ID environment variables, then uncomment the
// notarize call below.


exports.default = async function notarizing(context) {
  const { electronPlatformName, appOutDir } = context;

  if (electronPlatformName !== 'darwin') {
    return;
  }

  if (!process.env.APPLE_ID || !process.env.APPLE_APP_SPECIFIC_PASSWORD) {
    console.log('Skipping notarization: APPLE_ID or APPLE_APP_SPECIFIC_PASSWORD not set');
    return;
  }

  // Loaded lazily: @electron/notarize is only needed when credentials are set
  const { notarize } = require('@electron/notarize');
  const appName = context.packager.appInfo.productFilename;

  console.log(`Notarizing ${appName}...`);

  await notarize({
    appBundleId: 'com.ghostforge.jarvis',
    appPath: `${appOutDir}/${appName}.app`,
    appleId: process.env.APPLE_ID,
    appleIdPassword: process.env.APPLE_APP_SPECIFIC_PASSWORD,
    teamId: process.env.APPLE_TEAM_ID,
  });

  console.log('Notarization complete');
};
