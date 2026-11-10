export type LineKind = 'move' | 'kicker' | 'rest' | 'note' | 'pair';

export function lineKind(line: string): LineKind {
  const t = line.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
  if (/^(?:rx|inter|scale|athlete\s+[a-z])\s*:/.test(t)) return 'pair';
  if (/^(?:->|→)/.test(line) || /^consignes?\b/.test(t)) return 'note';
  if (/^\d+\s*['’′]?\s*(?:rest|repos)\b/.test(t) || /^(?:rest|repos)\b/.test(t)) return 'rest';
  if (/^\d+\s*rounds?\b/.test(t)) return 'kicker';
  return 'move';
}

export function paintBoard(host: HTMLElement, text: string): void {
  host.className = 'board';
  host.replaceChildren();
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (!line) continue;
    const kind = lineKind(line);
    const row = document.createElement('p');
    row.className = kind;
    if (kind === 'pair') {
      const cut = line.indexOf(':');
      const name = document.createElement('b');
      name.textContent = line.slice(0, cut).trim();
      row.append(name, line.slice(cut + 1).trim());
    } else if (kind === 'note') {
      row.textContent = line.replace(/^(?:->|→)\s*/, '').replace(/:\s*$/, '');
    } else row.textContent = line.replace(/:\s*$/, '');
    host.append(row);
  }
}
