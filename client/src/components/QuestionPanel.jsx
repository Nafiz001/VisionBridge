import { useEffect, useRef } from 'react';
import Icon from './Icon.jsx';

/**
 * Interactive assistant (spec §12).
 *
 * Presets are numbered so a keyboard user can fire the common questions with a
 * single keystroke, and the free-text box is there for everything else. Each
 * preset carries a decorative icon hinting at the kind of content it asks about.
 */

/** Preset id → decorative icon. Falls back to a generic prompt icon. */
const PRESET_ICONS = {
  'whats-on-screen': 'eye',
  'read-code': 'code',
  'read-terminal': 'terminal',
  'describe-diagram': 'diagram',
  'explain-graph': 'chart',
  'explain-formula': 'sigma',
  'which-button': 'cursor',
  'what-changed': 'sparkle',
};

export function QuestionPanel({ presets, onAsk, busy, lastAnswer, disabled }) {
  const inputRef = useRef(null);
  const answerRef = useRef(null);

  useEffect(() => {
    // Move focus to the answer once it arrives so a screen-reader user can
    // read it at their own pace, and re-read it with their reading keys.
    if (lastAnswer && answerRef.current) answerRef.current.focus();
  }, [lastAnswer]);

  const submit = (event) => {
    event.preventDefault();
    const value = inputRef.current?.value?.trim();
    if (!value) return;
    onAsk({ question: value });
    inputRef.current.value = '';
  };

  return (
    <section className="panel questions" aria-labelledby="questions-heading">
      <h2 id="questions-heading">Ask about the screen</h2>
      <p className="help" id="questions-help">
        VisionBridge pauses the video, looks at the exact frame on screen, answers, and then resumes
        playback. Press the number key shown before a question to ask it instantly.
      </p>

      <ul className="preset-list" aria-label="Common questions">
        {presets.map((preset, index) => (
          <li key={preset.id}>
            <button
              type="button"
              onClick={() => onAsk({ presetId: preset.id, question: preset.question })}
              disabled={busy || disabled}
              aria-keyshortcuts={index < 9 ? String(index + 1) : undefined}
            >
              <span className="preset-head">
                <span className="key-hint" aria-hidden="true">
                  {index < 9 ? index + 1 : '•'}
                </span>
                <Icon name={PRESET_ICONS[preset.id] || 'help'} size={18} />
              </span>
              <span className="preset-label">{preset.label}</span>
            </button>
          </li>
        ))}
      </ul>

      <form onSubmit={submit} className="question-form">
        <div className="field">
          <label htmlFor="question-input">Ask your own question about the current frame</label>
          <input
            id="question-input"
            ref={inputRef}
            type="text"
            maxLength={300}
            disabled={busy || disabled}
            aria-describedby="questions-help"
            placeholder="Type your question… (max 300 chars)"
          />
        </div>
        <button type="submit" className="primary" disabled={busy || disabled}>
          {busy ? 'Asking…' : 'Ask'}
          {!busy && <Icon name="sparkle" size={16} />}
        </button>
      </form>

      {lastAnswer && (
        <div
          className={`answer${lastAnswer.grounded ? '' : ' unverified'}`}
          ref={answerRef}
          tabIndex={-1}
          role="region"
          aria-label="Answer from Gemma"
        >
          <img className="answer-avatar" src="/cat-face.png" alt="" />
          <p className="answer-question">
            You asked: <strong>{lastAnswer.question}</strong>
          </p>
          <p className="answer-text">{lastAnswer.answer}</p>
          <p className={`answer-meta ${lastAnswer.grounded ? 'ok' : 'warn'}`}>
            <Icon name={lastAnswer.grounded ? 'check' : 'alert'} size={16} />
            {lastAnswer.grounded
              ? `Grounded in the frame at ${Math.round(lastAnswer.time)} seconds.`
              : 'Gemma could not confirm this from the current frame — treat it with caution.'}
          </p>
        </div>
      )}
    </section>
  );
}

export default QuestionPanel;
