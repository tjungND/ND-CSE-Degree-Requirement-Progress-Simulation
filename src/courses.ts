// Entry point for courses.html — the public "which courses count" list. Same
// rules loader as the audit page (live sheet → snapshot fallback); no student
// data is involved on this page at all.
import './style-base.css'; // the sheet both pages share (W4, 2026-10-22)
import './style-courses.css'; // this page's own rules — after the shared sheet, so its rules win ties
import { loadRulesWithCard } from './ui/loading.ts';
import { renderCoursesPage } from './ui/courses-page.ts';
import { startTheme } from './ui/theme.ts';
import { markEmbedMode, notifyEmbedHeight, startHeightBroadcast } from './ui/embed.ts';

const app = document.querySelector<HTMLDivElement>('#app');
if (app) {
  // ?embed=1 — this page inside someone else's (src/ui/embed.ts). Marked before
  // anything renders so the loading card is already trimmed, and the height
  // broadcast starts with it so the parent frame can size itself around the
  // loading card too, not only around the finished page.
  markEmbedMode();
  // Night mode (DGS 2026-10-04): Auto / Light / Dark, src/ui/theme.ts.
  startTheme();
  startHeightBroadcast();
  // The loading card (src/ui/loading.ts) shows progress and, on failure, suggests
  // reloading; it resolves with the live rules or the saved copy the student chose.
  loadRulesWithCard(app, new Date().toISOString()).then(({ rules, today }) => {
    app.textContent = '';
    renderCoursesPage(app, rules, today);
    notifyEmbedHeight(); // the page just went from one card to its full height
  });
}
