import strings from '@i18n';
import { listWods, putWod, setMeta } from '../db';
import { workoutHash } from '../hash';
import { registerSW } from '../pwa';
import type { Format, Wod } from '../types';
import { parseTimer } from '../validate';

registerSW();
void setMeta('lang', document.body.dataset.lang === 'fr' ? 'fr' : 'en').catch(() => undefined);

const button = document.querySelector<HTMLButtonElement>('#add-hero');
const status = document.querySelector<HTMLElement>('#add-status');

button?.addEventListener('click', () => {
  void (async () => {
    try {
      const name = button.dataset.name || '';
      const format = (button.dataset.format || 'other') as Format;
      const text = (document.querySelector('#hero-text')?.textContent || '').trim();
      const timer = parseTimer(JSON.parse(button.dataset.timer || '{}') as unknown);
      const hash = await workoutHash(name, format, text);
      const existing = (await listWods()).find((wod) => wod.hash === hash);
      if (existing) {
        if (status) status.textContent = strings.hero.duplicate;
        return;
      }
      const wod: Wod = {
        id: crypto.randomUUID(),
        name,
        format,
        timer,
        text,
        createdAt: new Date().toISOString(),
        source: 'hero',
        hash,
        results: [],
      };
      await putWod(wod);
      if (status) status.textContent = strings.hero.added;
    } catch {
      if (status) status.textContent = strings.hero.failed;
    }
  })();
});
