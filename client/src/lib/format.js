/** Formatting helpers. Spoken forms are written for the ear, not the eye. */

/** `93` -> `1:33` */
export function formatTime(seconds) {
  const total = Math.max(0, Math.floor(Number(seconds) || 0));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const secs = total % 60;
  const pad = (n) => String(n).padStart(2, '0');
  return hours ? `${hours}:${pad(minutes)}:${pad(secs)}` : `${minutes}:${pad(secs)}`;
}

/** `93` -> `1 minute 33 seconds` — what a screen reader should say. */
export function speakTime(seconds) {
  const total = Math.max(0, Math.round(Number(seconds) || 0));
  const minutes = Math.floor(total / 60);
  const secs = total % 60;
  const parts = [];
  if (minutes) parts.push(`${minutes} minute${minutes === 1 ? '' : 's'}`);
  parts.push(`${secs} second${secs === 1 ? '' : 's'}`);
  return parts.join(' ');
}

/** Rough spoken duration of a phrase, used to fit descriptions into a gap. */
export function estimateSpeechSeconds(text, rate = 1) {
  const words = String(text || '').split(/\s+/).filter(Boolean).length;
  return (words / 2.8) / Math.max(0.5, rate);
}
