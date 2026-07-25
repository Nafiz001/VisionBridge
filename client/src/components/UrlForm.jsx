import { useEffect, useRef } from 'react';
import Icon from './Icon.jsx';

/**
 * Step one of the audio-first workflow: paste a link.
 * Autofocused, because for a keyboard-only user this is the only thing on the
 * page that needs doing.
 */
export function UrlForm({ onSubmit, busy, error, defaultValue = '' }) {
  const inputRef = useRef(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const handleSubmit = (event) => {
    event.preventDefault();
    const value = inputRef.current?.value?.trim();
    if (value) onSubmit(value);
  };

  return (
    <form className="panel url-form" onSubmit={handleSubmit} aria-labelledby="url-form-heading">
      <h2 id="url-form-heading">Choose a video</h2>

      <label htmlFor="youtube-url">YouTube video link</label>
      <input
        id="youtube-url"
        ref={inputRef}
        type="url"
        name="url"
        inputMode="url"
        autoComplete="url"
        spellCheck="false"
        defaultValue={defaultValue}
        placeholder="https://www.youtube.com/watch?v=..."
        aria-describedby="url-help url-error"
        aria-invalid={error ? 'true' : undefined}
        disabled={busy}
        required
      />

      <p id="url-help" className="help">
        VisionBridge will download the video, read its captions, and prepare audio descriptions for
        the moments where the screen shows something the narration does not explain. Processing a ten
        minute tutorial usually takes a few minutes.
      </p>

      <p id="url-error" className="error" role="none">
        {error || ''}
      </p>

      <button type="submit" className="primary" disabled={busy}>
        {!busy && <Icon name="sparkle" size={18} />}
        {busy ? 'Processing…' : 'Process video'}
      </button>
    </form>
  );
}

export default UrlForm;
