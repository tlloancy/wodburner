export interface Strings {
  untitled: string;
  formats: { fortime: string; amrap: string; emom: string; tabata: string; other: string };
  confidence: { high: string; medium: string; low: string };
  timer: {
    pause: string;
    resume: string;
    prep: string;
    work: string;
    rest: string;
    setRest: string;
    round: string;
    cap: string;
    hits: string;
    hitsOne: string;
    saved: string;
    saveFailed: string;
    announcePrep: string;
    announceWork: string;
    announceRest: string;
    announceSetRest: string;
    announceRound: string;
    announceDone: string;
    announcePaused: string;
    announceRunning: string;
    announceHits: string;
    announceHitsOne: string;
  };
  dashboard: {
    duplicate: string;
    imported: string;
    importError: string;
    cleared: string;
    confirmClear: string;
    confirmDelete: string;
    resultSaved: string;
    needName: string;
    saved: string;
  };
  scan: {
    preparing: string;
    sending: string;
    decode: string;
    size: string;
    network: string;
    invalid: string;
    offline: string;
    turnstileWait: string;
    unconfigured: string;
    saved: string;
    failed: string;
    skill: string;
    metcon: string;
  };
  hero: { added: string; duplicate: string; failed: string };
  wod: { missing: string; noResults: string };
}
