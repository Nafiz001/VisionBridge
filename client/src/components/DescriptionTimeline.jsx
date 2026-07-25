import { formatTime, speakTime } from '../lib/format.js';
import Icon from './Icon.jsx';

/**
 * Every description VisionBridge prepared, as a navigable list.
 *
 * This doubles as the transparency surface: a learner can review exactly what
 * the AI will say and when, and jump to any of it.
 */
export function DescriptionTimeline({ descriptions, currentTime, onJump, stats }) {
  if (!descriptions.length) {
    return (
      <section className="panel timeline" aria-labelledby="timeline-heading">
        <h2 id="timeline-heading">Audio descriptions</h2>
        <div className="timeline-empty">
          <img src="/cat-rest.png" alt="" />
          <p>
            Gemma reviewed this video and decided the narration already explains everything on
            screen, so there are no descriptions. Silence is the correct answer here — you can still
            ask questions about any frame at any time.
          </p>
        </div>
      </section>
    );
  }

  return (
    <section className="panel timeline" aria-labelledby="timeline-heading">
      <div className="panel-title-row">
        <h2 id="timeline-heading">Audio descriptions ({descriptions.length})</h2>
        {stats && (
          <p className="timeline-stat">
            {stats.accepted} of {stats.candidates} moments spoken
            {stats.explanations > 0 ? ` · ${stats.explanations} full explanations` : ''}
          </p>
        )}
      </div>

      <ol className="description-list">
        {descriptions.map((entry) => {
          const isCurrent = currentTime >= entry.time && currentTime < entry.time + 4;
          const isExplain = entry.mode === 'explain';
          const delivery = isExplain
            ? 'A full explanation — the video pauses so you hear all of it.'
            : entry.requiresPause
              ? 'The video pauses for this description.'
              : 'Spoken during a natural pause.';
          return (
            <li
              key={entry.time}
              className={
                [isCurrent ? 'current' : '', isExplain ? 'explain' : ''].filter(Boolean).join(' ') ||
                undefined
              }
            >
              <button
                type="button"
                onClick={() => onJump(entry)}
                aria-label={`At ${speakTime(entry.time)}: ${entry.description}. Confidence ${Math.round(
                  entry.confidence * 100,
                )} percent. ${delivery} Activate to jump here.`}
              >
                <span className="d-stamp" aria-hidden="true">
                  <Icon name="play" size={14} />
                  {formatTime(entry.time)}
                </span>
                <span className="d-text" aria-hidden="true">
                  {entry.description}
                </span>
                <span className="d-tags" aria-hidden="true">
                  {isExplain ? (
                    <span className="tag explain">full explanation</span>
                  ) : entry.requiresPause ? (
                    <span className="tag pause">pauses video</span>
                  ) : (
                    <span className="tag">brief</span>
                  )}
                  <span className="d-confidence">{Math.round(entry.confidence * 100)}%</span>
                </span>
              </button>
            </li>
          );
        })}
      </ol>
    </section>
  );
}

export default DescriptionTimeline;
