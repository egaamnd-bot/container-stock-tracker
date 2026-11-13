import type { CapacitorConfig } from '@capacitor/cli';

/**
 * Android APK = thin native shell around the live GitHub Pages app.
 * Loading the hosted URL (not bundled files) means every web deploy reaches APK users
 * automatically — the APK only needs rebuilding for icon/name/permission changes.
 */
const config: CapacitorConfig = {
  appId: 'com.sbsopex.containerstock',
  appName: 'Stock Tracker',
  webDir: 'dist',
  server: {
    url: 'https://sbsopex.github.io/container-stock-tracker/',
    androidScheme: 'https',
    // Supabase auth/API calls stay inside the app instead of opening the browser.
    allowNavigation: ['xrkbhopqyxoahusaozkc.supabase.co'],
  },
  android: {
    backgroundColor: '#f8fafc',
  },
};

export default config;
