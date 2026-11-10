import strings from '@i18n';
import { paintBoard } from '../board-view';
import { presentStored } from '../reflow';
import { getWod } from '../db';
import { registerSW } from '../pwa';
import { timerHref } from '../timer-link';

registerSW();
const lang = document.body.dataset.lang === 'fr' ? 'fr' : 'en';

const missing = document.querySelector<HTMLElement>('#missing');
const panel = document.querySelector<HTMLElement>('#wod-panel');
const title = document.querySelector<HTMLElement>('#wod-title');
const text = document.querySelector<HTMLElement>('#wod-text');
const results = document.querySelector<HTMLElement>('#wod-results');
const launch = document.querySelector<HTMLAnchorElement>('#launch');

async function openWod(): Promise<void> {
  const id = decodeURIComponent(location.hash.replace(/^#/, ''));
  if (!id) return;
  const wod = await getWod(id).catch(() => undefined);
  if (!wod || !panel || !title || !text || !results || !launch) return;
  if (missing) missing.hidden = true;
  panel.hidden = false;
  const view = presentStored(wod);
  title.textContent = view.name || strings.untitled;
  let who = document.querySelector<HTMLElement>('#wod-who');
  if (wod.who) {
    if (!who) {
      who = document.createElement('p');
      who.id = 'wod-who';
      who.className = 'who';
      title.after(who);
    }
    who.hidden = false;
    who.textContent = wod.who;
  } else if (who) who.hidden = true;
  if (view.text) paintBoard(text, view.text);
  else text.replaceChildren();
  const href = new URL(timerHref(lang, view.format, view.timer, view.name), location.origin);
  href.searchParams.set('wod', wod.id);
  launch.href = `${href.pathname}${href.search}`;
  results.replaceChildren();
  if (wod.results.length === 0) {
    const item = document.createElement('li');
    item.textContent = strings.wod.noResults;
    results.append(item);
    return;
  }
  const when = new Intl.DateTimeFormat(lang, { dateStyle: 'medium', timeStyle: 'short' });
  for (const result of wod.results) {
    const item = document.createElement('li');
    item.textContent = `${when.format(new Date(result.at))} — ${result.value}`;
    results.append(item);
  }
}

void openWod();
window.addEventListener('hashchange', () => void openWod());
