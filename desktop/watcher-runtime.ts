import { loadSettings, subscribeSettings } from "./clop-store";
import type { PicLiteBridge } from "./clop-types";

// The main window stays alive in the tray, even when preferences is closed.
export function startSavedWatchTasks(api: PicLiteBridge) {
  let previous = "";
  let pending = Promise.resolve();
  const sync = () => {
    const settings = loadSettings();
    const profiles = settings.watchProfiles.filter((profile) => profile.enabled);
    const key = JSON.stringify([profiles, settings.pauseAutomaticOptimisations]);
    if (key === previous) return;
    previous = key;
    pending = pending.then(async () => {
      if (settings.pauseAutomaticOptimisations || !profiles.length) { await api.stopWatcher(); return; }
      const result = await api.startWatcher({ ...profiles[0], profiles });
      if (!result.ok) { previous = ""; console.error("Could not start watch tasks:", result.error); }
    }).catch((error) => { previous = ""; console.error(error); });
  };
  subscribeSettings(sync);
  window.addEventListener("storage", sync);
  window.addEventListener("piclite:plugins-changed", sync);
  sync();
}
