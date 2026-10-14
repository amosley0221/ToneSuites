// Build-level app configuration (not user data).
/** GitHub repository whose Releases carry installers, the updater manifest and APKs. */
export const RELEASE_REPO = import.meta.env.VITE_RELEASE_REPO || 'amosley0221/ToneSuites';
/** How often (hours) a running app re-checks for updates. */
export const UPDATE_CHECK_HOURS = 6;
