// Persistent user settings (stored by the main process).
export const settings = {
  author: '',
  language: 'vi',
  theme: 'light',
  defaultZoom: 'auto',
  showFormHighlight: true,
  recentSignatures: [],
};

export async function loadSettings() {
  try {
    const s = await window.api.settings.get();
    Object.assign(settings, s || {});
  } catch {
    /* defaults */
  }
  return settings;
}

export async function saveSettings(patch) {
  Object.assign(settings, patch);
  try {
    await window.api.settings.set(patch);
  } catch {
    /* ignore */
  }
}
