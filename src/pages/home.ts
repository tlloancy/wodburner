import { listWods, setMeta } from '../db';
import { registerSW } from '../pwa';

registerSW();
void setMeta('lang', document.body.dataset.lang === 'fr' ? 'fr' : 'en').catch(() => undefined);

const list = document.querySelector<HTMLElement>('#recent-list');
const empty = document.querySelector<HTMLElement>('#recent-empty');

async function recent(): Promise<void> {
  if (!list || !empty) return;
  let wods;
  try {
    wods = (await listWods()).slice(0, 5);
  } catch {
    return;
  }
  if (wods.length === 0) return;
  empty.hidden = true;
  const lang = document.documentElement.lang || 'en';
  const when = new Intl.DateTimeFormat(lang, { dateStyle: 'medium', timeStyle: 'short' });
  for (const wod of wods) {
    const item = document.createElement('li');
    const link = document.createElement('a');
    link.href = `/${lang}/wod/#${encodeURIComponent(wod.id)}`;
    link.textContent = wod.name || '—';
    const time = document.createElement('time');
    time.dateTime = wod.createdAt;
    time.textContent = when.format(new Date(wod.createdAt));
    item.append(link, time);
    list.append(item);
  }
}

void recent();
