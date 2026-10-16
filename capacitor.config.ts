import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.artguardhub.app',
  appName: 'ArtGuard Hub',
  webDir: 'dist',
  server: {
    androidScheme: 'https',
  },
};

export default config;
