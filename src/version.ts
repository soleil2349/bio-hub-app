/**
 * The app version, read from the Expo config at runtime.
 *
 * Why this module exists
 * ----------------------
 * The version used to be typed by hand into two places (the splash screen and
 * the About panel in Settings) as "1.3.0". By the time the app shipped 1.6.2
 * both still said 1.3.0, which makes a support conversation about "which build
 * are you running?" actively misleading. Reading `expoConfig.version` means the
 * value in `app.json` — the one AGENTS.md requires be bumped for every release —
 * is the only place it is written.
 */
import Constants from 'expo-constants';

export const APP_VERSION: string = Constants.expoConfig?.version ?? '0.0.0';

/** Android versionCode / iOS buildNumber, shown alongside the version. */
export const APP_BUILD: string =
  Constants.expoConfig?.android?.versionCode?.toString() ??
  Constants.expoConfig?.ios?.buildNumber ??
  '—';
