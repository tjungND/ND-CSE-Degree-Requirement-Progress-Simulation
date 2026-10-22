// Entry point: load the rules (live sheet → snapshot fallback), then start the
// app. All rule logic lives in src/engine/ (pure, tested); all sheet handling
// in src/data/; this file only wires them to the page.
import './style-base.css'; // the sheet both pages share (W4, 2026-10-22)
import './style-app.css'; // this page's own rules — after the shared sheet, so its rules win ties
import { loadRulesWithCard } from './ui/loading.ts';
import { startApp } from './ui/app.ts';
import { startTheme } from './ui/theme.ts';
import { markEmbedMode, startHeightBroadcast, trackInteractions } from './ui/embed.ts';
import { clearLocal } from './ui/state.ts';
import { clearSimulation, crashRecovery, simulationStored } from './ui/simulation.ts';

const app = document.querySelector<HTMLDivElement>('#app');
if (app) {
  // ?embed=1 — the tool inside someone else's page (src/ui/embed.ts). The
  // frame sizes itself to the page (DGS 2026-09-16, "remove the scroll");
  // the dialogs and toasts are placed for a frame the page cannot scroll —
  // src/ui/embed.ts explains.
  markEmbedMode();
  // Night mode (DGS 2026-10-04): Auto / Light / Dark, src/ui/theme.ts.
  startTheme();
  startHeightBroadcast();
  trackInteractions();
  // The loading card (src/ui/loading.ts) shows progress and, on failure, suggests
  // reloading; it resolves with the live rules or the saved copy the student chose.
  loadRulesWithCard(app, new Date().toISOString()).then(({ rules, today }) => {
    app.textContent = '';
    try {
      startApp(app, rules, today);
    } catch (err) {
      // Saved data from an old version (or a bad import) must never brick the
      // page — offer a way out instead of a blank screen. With a simulation
      // stored (simulation mode, DGS 2026-10-09) the page opened in the mode
      // and drew the planning copy, so the copy is what broke it: the button
      // discards the simulation and keeps the record (review fix 2026-10-09 —
      // it used to clear the record alone and leave the simulation to crash
      // the reload). Without one, "start fresh" clears both keys.
      app.textContent = '';
      const plan = crashRecovery(simulationStored(), err instanceof Error ? err.message : undefined);
      const msg = document.createElement('p');
      msg.textContent = plan.message;
      const btn = document.createElement('button');
      btn.textContent = plan.button;
      btn.addEventListener('click', () => {
        if (plan.clears === 'all') clearLocal();
        clearSimulation();
        location.reload();
      });
      app.append(msg, btn);
    }
  });
}
