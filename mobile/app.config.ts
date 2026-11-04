import type { ExpoConfig } from 'expo/config';

/**
 * Gmail sign-in uses a Google OAuth client of type "iOS" (used on both platforms; see docs/GMAIL-SETUP.md).
 * A client ID is public (it ships inside every app), so the default lives here; GOOGLE_IOS_CLIENT_ID overrides it.
 */
const DEFAULT_GOOGLE_CLIENT_ID = '1032852921049-q1p7vi7tk7890mruhdq926g1jimc9ju6.apps.googleusercontent.com';
const googleClientId = process.env.GOOGLE_IOS_CLIENT_ID?.trim() || DEFAULT_GOOGLE_CLIENT_ID;
const googleScheme = googleClientId ? googleClientId.split('.').reverse().join('.') : null;

const NAVY = '#0A1F44';

const config: ExpoConfig = {
  name: 'Shotor AI',
  slug: 'shotor-ai',
  version: '1.4.1',
  orientation: 'portrait',
  icon: './assets/icon.png',
  scheme: googleScheme ? ['shotor', googleScheme] : 'shotor',
  userInterfaceStyle: 'light',
  ios: {
    bundleIdentifier: 'com.aetherlink.shotor',
    buildNumber: '10',
    supportsTablet: true,
    deploymentTarget: '16.0',
    infoPlist: {
      ITSAppUsesNonExemptEncryption: false,
    },
  },
  android: {
    package: 'com.aetherlink.shotor',
    versionCode: 10,
    allowBackup: false, // the AI model is GBs and data is private; never back it up to the cloud
    adaptiveIcon: {
      backgroundColor: '#FFFFFF',
      foregroundImage: './assets/android-icon-foreground.png',
      monochromeImage: './assets/android-icon-monochrome.png',
    },
    permissions: ['READ_CALENDAR', 'WRITE_CALENDAR', 'POST_NOTIFICATIONS', 'USE_EXACT_ALARM', 'SCHEDULE_EXACT_ALARM', 'USE_BIOMETRIC', 'RECEIVE_BOOT_COMPLETED', 'ACCESS_NETWORK_STATE'],
    blockedPermissions: ['RECORD_AUDIO', 'READ_EXTERNAL_STORAGE', 'WRITE_EXTERNAL_STORAGE', 'SYSTEM_ALERT_WINDOW'],
    predictiveBackGestureEnabled: false,
  },
  plugins: [
    'expo-router',
    'expo-sqlite',
    'expo-web-browser',
    'expo-background-task',
    'expo-secure-store',
    [
      'expo-splash-screen',
      { image: './assets/splash-icon.png', imageWidth: 200, backgroundColor: NAVY, resizeMode: 'contain' },
    ],
    [
      'expo-calendar',
      {
        calendarPermission: 'Shotor reads your calendar on this phone to show today’s meetings and remind you before they start.',
        remindersPermission: false,
      },
    ],
    ['expo-local-authentication', { faceIDPermission: 'Use Face ID to unlock Shotor AI.' }],
    ['expo-notifications', { color: NAVY, icon: './assets/notification-icon.png' }],
    // On-device AI (llama.cpp). OpenCL lets Snapdragon (Adreno) phones use the GPU when the speed test finds it faster.
    ['llama.rn', { enableOpenCLAndHexagon: true }],
    './plugins/withReleaseSigning',
    './plugins/withShortNativePaths',
    './plugins/withShareTarget',
    [
      'expo-build-properties',
      {
        android: {
          minSdkVersion: 26,
          enableMinifyInReleaseBuilds: false,
          enableShrinkResourcesInReleaseBuilds: false,
          useLegacyPackaging: true,
          // Both JavaMail jars (company email) carry these two notices; keep one copy of each.
          packagingOptions: { pickFirst: ['META-INF/LICENSE.md', 'META-INF/NOTICE.md'] },
        },
      },
    ],
  ],
  extra: {
    googleClientId,
  },
};

export default config;
