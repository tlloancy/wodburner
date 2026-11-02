export function canonicalWorkout(name: string, format: string, text: string): string {
  const normalizedName = name.normalize('NFC').trim().replace(/\s+/g, ' ').toLowerCase();
  const normalizedText = text
    .normalize('NFC')
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .split('\n')
    .map((line) => line.trimEnd())
    .join('\n')
    .trim();
  return `${normalizedName}\n${format}\n${normalizedText}`;
}

export async function sha256Hex(value: string | Uint8Array): Promise<string> {
  const bytes = typeof value === 'string' ? new TextEncoder().encode(value) : value;
  const digest = await crypto.subtle.digest('SHA-256', bytes as BufferSource);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

export async function workoutHash(name: string, format: string, text: string): Promise<string> {
  return sha256Hex(canonicalWorkout(name, format, text));
}
