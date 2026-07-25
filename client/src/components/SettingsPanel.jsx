import Icon from './Icon.jsx';

/**
 * Speech and display preferences.
 *
 * Adjustable speech speed and a high-contrast mode are explicit MVP
 * requirements (spec §3.4), not extras.
 */
export function SettingsPanel({ settings, update, voices, onTestVoice, language, voiceAvailable }) {
  const nonEnglish = language && !language.isEnglish;
  return (
    <section className="panel settings" aria-labelledby="settings-heading">
      <h2 id="settings-heading">Speech and display</h2>

      <div className="field">
        <label htmlFor="speech-rate">
          Speech speed <span className="field-value">{settings.rate.toFixed(2)}x</span>
        </label>
        <input
          id="speech-rate"
          type="range"
          min={0.5}
          max={2.5}
          step={0.1}
          value={settings.rate}
          onChange={(event) => update({ rate: Number(event.target.value) })}
          aria-valuetext={`${settings.rate.toFixed(1)} times normal speed`}
          aria-keyshortcuts="Comma Period"
        />
        <div className="slider-scale" aria-hidden="true">
          <span>0.5x</span>
          <span>Normal</span>
          <span>2.5x</span>
        </div>
      </div>

      <div className="field">
        <label htmlFor="speech-volume">
          Description volume <span className="field-value">{Math.round(settings.volume * 100)}%</span>
        </label>
        <input
          id="speech-volume"
          type="range"
          min={0.1}
          max={1}
          step={0.05}
          value={settings.volume}
          onChange={(event) => update({ volume: Number(event.target.value) })}
          aria-valuetext={`${Math.round(settings.volume * 100)} percent`}
        />
        <div className="slider-scale" aria-hidden="true">
          <span>10%</span>
          <span>100%</span>
        </div>
      </div>

      <div className="field">
        <label htmlFor="voice-select">
          Description voice{nonEnglish ? ` (${language.name})` : ''}
        </label>
        <select
          id="voice-select"
          value={settings.voiceURI}
          onChange={(event) => update({ voiceURI: event.target.value })}
        >
          <option value="">System default</option>
          {voices.map((voice) => (
            <option key={voice.voiceURI} value={voice.voiceURI}>
              {voice.name} ({voice.lang})
            </option>
          ))}
        </select>
        <button type="button" onClick={onTestVoice} className="secondary" style={{ marginTop: '0.6rem', width: '100%' }}>
          <Icon name="sound" size={18} />
          Test this voice
        </button>
        {nonEnglish && !voiceAvailable && (
          <p className="field-note" role="note">
            <Icon name="alert" size={16} />
            <span>
              No {language.name} voice is installed on this device, so spoken descriptions may be
              unclear. Microsoft Edge offers {language.name} voices online, or you can add one in your
              operating system’s speech settings.
            </span>
          </p>
        )}
      </div>

      <fieldset className="field">
        <legend>Behaviour</legend>

        <label className="checkbox">
          <input
            type="checkbox"
            checked={settings.descriptionsEnabled}
            onChange={(event) => update({ descriptionsEnabled: event.target.checked })}
          />
          Speak audio descriptions automatically
        </label>

        <label className="checkbox">
          <input
            type="checkbox"
            checked={settings.duckVideo}
            onChange={(event) => update({ duckVideo: event.target.checked })}
          />
          Lower the video volume while VisionBridge speaks
        </label>

        <label className="checkbox">
          <input
            type="checkbox"
            checked={settings.speakStatus}
            onChange={(event) => update({ speakStatus: event.target.checked })}
          />
          Read status messages aloud
        </label>

        <label className="checkbox">
          <input
            type="checkbox"
            checked={settings.highContrast}
            onChange={(event) => update({ highContrast: event.target.checked })}
          />
          High contrast mode
        </label>
      </fieldset>
    </section>
  );
}

export default SettingsPanel;
