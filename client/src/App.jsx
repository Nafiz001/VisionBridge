/**
 * VisionBridge — accessible player shell.
 *
 * Holds the session state machine (idle -> processing -> ready) and wires the
 * pieces together: player clock, description scheduler, speech, announcements,
 * and the interactive assistant.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import api, { apiUrl } from './lib/api.js';
import { speakTime } from './lib/format.js';
import useAnnouncer from './hooks/useAnnouncer.js';
import useSettings from './hooks/useSettings.js';
import useSpeech from './hooks/useSpeech.js';
import useYouTubePlayer, { PLAYER_STATE } from './hooks/useYouTubePlayer.js';
import useDescriptionScheduler from './hooks/useDescriptionScheduler.js';
import useKeyboardShortcuts, { keyCap } from './hooks/useKeyboardShortcuts.js';
import useVoiceSearch from './hooks/useVoiceSearch.js';
import LiveRegions from './components/LiveRegions.jsx';
import Icon from './components/Icon.jsx';
import UrlForm from './components/UrlForm.jsx';
import ExampleVideos from './components/ExampleVideos.jsx';
import ProcessingStatus from './components/ProcessingStatus.jsx';
import PlayerPanel from './components/PlayerPanel.jsx';
import QuestionPanel from './components/QuestionPanel.jsx';
import DescriptionTimeline from './components/DescriptionTimeline.jsx';
import SettingsPanel from './components/SettingsPanel.jsx';
import ShortcutsDialog from './components/ShortcutsDialog.jsx';
import SearchDialog from './components/SearchDialog.jsx';
import SettingsDialog from './components/SettingsDialog.jsx';

const POLL_MS = 1200;

export default function App() {
  const { settings, update, toggle } = useSettings();
  const { polite, assertive, announce } = useAnnouncer();

  const [phase, setPhase] = useState('idle');
  const [videoId, setVideoId] = useState(null);
  const [info, setInfo] = useState(null);
  const [job, setJob] = useState(null);
  const [timeline, setTimeline] = useState(null);

  // The language the pipeline chose for this video drives which speech voice is
  // used, so speech has to know it. Defaults to English until a timeline loads.
  const activeLanguage = timeline?.language || null;
  const speech = useSpeech(
    useMemo(() => ({ ...settings, lang: activeLanguage?.code || 'en' }), [settings, activeLanguage]),
  );

  const [formError, setFormError] = useState('');
  const [modelInfo, setModelInfo] = useState(null);
  const [presets, setPresets] = useState([]);
  const [currentTime, setCurrentTime] = useState(0);
  const [muted, setMuted] = useState(false);
  const [asking, setAsking] = useState(false);
  const [askQuestion, setAskQuestion] = useState('');
  const [lastAnswer, setLastAnswer] = useState(null);
  const [showShortcuts, setShowShortcuts] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [keyHud, setKeyHud] = useState(null);

  // Voice + text search. Push-to-talk (hold W) and the dialog share this state.
  // A *spoken* search plays the top result straight away (hands-free); if there
  // was nothing to play, the dialog opens so the learner can retry or type.
  const voice = useVoiceSearch({
    announce,
    onResults: (found) => {
      if (found && found.length) {
        setSearchOpen(false);
        announce(`Playing ${found[0].title}.`, { assertive: true });
        handleSubmit(found[0].url);
      } else {
        setSearchOpen(true);
      }
    },
  });

  const playButtonRef = useRef(null);
  const lastAnnouncedPercent = useRef(-1);

  // A brief centre-screen flash of the key that was just pressed (2, J, →, …) so
  // the interaction is visible on screen recordings. Each press re-mounts the
  // element (via a bumping id) so the fade-out animation replays every time.
  const keyHudTimer = useRef(null);
  const keyHudSeq = useRef(0);
  const flashKey = useCallback((key, label) => {
    keyHudSeq.current += 1;
    setKeyHud({ id: keyHudSeq.current, cap: keyCap(key), label });
    clearTimeout(keyHudTimer.current);
    keyHudTimer.current = setTimeout(() => setKeyHud(null), 900);
  }, []);
  useEffect(() => () => clearTimeout(keyHudTimer.current), []);

  // Voice-search errors are shown as a pill on the landing page; clear them
  // after a few seconds so the pill does not linger.
  useEffect(() => {
    if (!voice.error) return undefined;
    const timer = setTimeout(() => voice.reset(), 6000);
    return () => clearTimeout(timer);
  }, [voice.error, voice.reset]);

  // True whenever VisionBridge has paused the video specifically so it can speak
  // (an extended description, an overlap hold, or a Q&A answer). The scheduler
  // and the Q&A flow both write it; the player-state handler reads it. It stays
  // true across a PAUSED→BUFFERING→PLAYING resume, so the fix does not depend on
  // catching one exact transition.
  const holdingPlaybackRef = useRef(false);
  const askingRef = useRef(false);
  askingRef.current = asking;

  /**
   * Enforce the one rule everything else serves: the instructor and VisionBridge
   * are never audible at once. If the learner forces the video to resume — the
   * play button, the space bar, or clicking the YouTube player directly — while
   * VisionBridge had paused it to speak, stop speaking rather than talk over the
   * returning narration.
   *
   * We key off "the video is supposed to be held for speech" rather than a
   * specific state transition, because YouTube resumes via PAUSED → BUFFERING →
   * PLAYING and an earlier version that watched for a direct paused→playing step
   * missed the buffering case and let the voices overlap. `holdingPlaybackRef`
   * is cleared before our own resume, so a normal end-of-description never trips
   * this; `speechSynthesis.speaking` is live ground truth for "still talking".
   */
  const handlePlayerState = useCallback(
    (playerState) => {
      const speakingNow =
        typeof window !== 'undefined' && window.speechSynthesis
          ? window.speechSynthesis.speaking
          : false;
      if (
        playerState === PLAYER_STATE.PLAYING &&
        (holdingPlaybackRef.current || askingRef.current) &&
        speakingNow
      ) {
        speech.cancel();
        announce('Playback resumed. Stopping the description so it does not overlap the narration.', {
          assertive: true,
        });
      }
    },
    [speech, announce],
  );

  const { containerRef, ready, state, duration, error: playerError, controls } = useYouTubePlayer({
    videoId: phase === 'ready' ? videoId : null,
    onStateChange: handlePlayerState,
  });

  const isPlaying = state === PLAYER_STATE.PLAYING || state === PLAYER_STATE.BUFFERING;

  /* ----------------------------------------------------------------- speech */

  /**
   * Speaks, ducking the video underneath so a description is never fighting
   * background music for the learner's attention.
   */
  const speakDucked = useCallback(
    async (text, overrides) => {
      const shouldDuck = settings.duckVideo && ready;
      let previousVolume = null;
      if (shouldDuck) {
        previousVolume = controls.getVolume();
        controls.setVolume(Math.min(previousVolume, 20));
      }
      try {
        return await speech.speak(text, overrides);
      } finally {
        if (shouldDuck && previousVolume != null) controls.setVolume(previousVolume);
      }
    },
    [controls, ready, settings.duckVideo, speech],
  );

  /** Announce to the screen reader, and optionally speak it too. */
  const report = useCallback(
    (message, options = {}) => {
      announce(message, options);
      if (settings.speakStatus) speech.speak(message);
    },
    [announce, settings.speakStatus, speech],
  );

  /* ------------------------------------------------------------- scheduling */

  const descriptions = useMemo(() => timeline?.descriptions ?? [], [timeline]);

  const scheduler = useDescriptionScheduler({
    descriptions,
    controls,
    enabled: settings.descriptionsEnabled,
    isPlaying,
    speak: speakDucked,
    holdingPlaybackRef,
    onSpoken: useCallback(
      (entry) =>
        announce(`${entry.mode === 'explain' ? 'Full description' : 'Description'}: ${entry.description}`),
      [announce],
    ),
  });

  /* ------------------------------------------------------------- lifecycle  */

  useEffect(() => {
    api
      .config()
      .then((cfg) => setModelInfo(cfg.ai))
      .catch(() => setModelInfo(null));
    api
      .presets()
      .then((data) => setPresets(data.presets || []))
      .catch(() => setPresets([]));
  }, []);

  useEffect(() => {
    announce(
      'VisionBridge. Paste a YouTube link and choose Process video. Press question mark at any time for keyboard shortcuts.',
    );
  }, [announce]);

  // Voice search: press W to start recording, press W again (or wait for the
  // auto-stop) to send it. A single tap toggles, so speaking after the press
  // works naturally. Key repeats from holding W are ignored, and W is swallowed
  // so it never leaks into a focused field.
  useEffect(() => {
    const isTyping = (el) => {
      const tag = el?.tagName?.toLowerCase();
      return tag === 'input' || tag === 'textarea' || tag === 'select' || el?.isContentEditable === true;
    };
    const isW = (event) =>
      event.key && event.key.toLowerCase() === 'w' && !event.ctrlKey && !event.metaKey && !event.altKey;

    const onKeyDown = (event) => {
      if (!isW(event)) return;
      if (event.repeat) {
        event.preventDefault();
        return;
      }
      if (isTyping(event.target)) return; // a real 'w' being typed
      event.preventDefault();
      flashKey('w', 'Search by voice');
      if (voice.voiceEnabled) voice.toggle();
      else setSearchOpen(true); // no mic/voice configured — open the typed search
    };

    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [voice.voiceEnabled, voice.toggle, flashKey]);

  // Player clock — drives the position display and the timeline highlight.
  useEffect(() => {
    if (phase !== 'ready' || !ready) return undefined;
    const timer = setInterval(() => setCurrentTime(controls.getTime()), 250);
    return () => clearInterval(timer);
  }, [phase, ready, controls]);

  useEffect(() => {
    if (playerError) report(playerError, { assertive: true });
  }, [playerError, report]);

  useEffect(() => {
    if (phase !== 'ready' || !ready) return undefined;
    report(
      `Ready. ${descriptions.length} audio description${
        descriptions.length === 1 ? '' : 's'
      } prepared. Starting playback.`,
    );
    // The processing job was itself started by a real click, but that user
    // gesture is long expired by the time the video finishes preparing, so
    // browsers are free to block this autoplay. Try it anyway, then check
    // whether it actually took — if it didn't, fall back to the accessible
    // manual-start path instead of leaving a blind learner stuck on a silent
    // player with no idea anything is wrong.
    controls.play();
    const timer = setTimeout(() => {
      const playerState = controls.getState();
      const autoplaySucceeded =
        playerState === PLAYER_STATE.PLAYING || playerState === PLAYER_STATE.BUFFERING;
      if (!autoplaySucceeded) {
        playButtonRef.current?.focus();
        report('Press space to play.', { assertive: true });
      }
    }, 1500);
    return () => clearTimeout(timer);
    // Announce/attempt once, when the player becomes usable.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, ready]);

  // Tell the learner what language descriptions will be in, and warn — rather
  // than silently mangle speech — when the device has no voice for it. Voices
  // can load asynchronously, so this re-runs as `voiceAvailable` settles.
  useEffect(() => {
    if (phase !== 'ready' || !activeLanguage || activeLanguage.isEnglish || !speech.supported) {
      return;
    }
    if (speech.voiceAvailable) {
      announce(`Descriptions and answers will be spoken in ${activeLanguage.name}.`);
    } else {
      report(
        `This video is in ${activeLanguage.name}, but no ${activeLanguage.name} speech voice is ` +
          `installed on this device, so spoken descriptions may be unclear. Microsoft Edge offers ` +
          `${activeLanguage.name} voices online, or you can install one in your system settings.`,
        { assertive: true },
      );
    }
  }, [phase, activeLanguage, speech.voiceAvailable, speech.supported, announce, report]);

  /* ------------------------------------------------------------- processing */

  const handleSubmit = useCallback(
    async (url) => {
      // Loading a new video while one is already playing/processing: stop
      // whatever the learner is currently hearing so the two don't overlap,
      // and let the old player unmount (it goes away once phase leaves 'ready').
      speech.cancel();
      controls.pause();
      setFormError('');
      setTimeline(null);
      setLastAnswer(null);
      lastAnnouncedPercent.current = -1;

      try {
        report('Looking up the video.');
        const videoInfo = await api.videoInfo(url);
        setInfo(videoInfo);
        setVideoId(videoInfo.videoId);
        setPhase('processing');
        report(
          `Found ${videoInfo.title}, ${speakTime(videoInfo.duration)} long. Processing now. This can take a few minutes.`,
        );

        const started = await api.startProcessing(url);
        setJob(started);
      } catch (err) {
        setFormError(err.message);
        setPhase('idle');
        report(err.message, { assertive: true });
      }
    },
    [report, speech, controls],
  );

  // Deep link: /?v=<id-or-url> loads that video on arrival, so a search or a
  // shared link can jump straight in.
  const deepLinkedRef = useRef(false);
  useEffect(() => {
    if (deepLinkedRef.current) return;
    const params = new URLSearchParams(window.location.search);
    const target = params.get('v') || params.get('url');
    if (target) {
      deepLinkedRef.current = true;
      handleSubmit(target);
    }
  }, [handleSubmit]);

  // Poll the processing job and narrate its progress.
  useEffect(() => {
    if (phase !== 'processing' || !job?.jobId) return undefined;
    let cancelled = false;

    const poll = async () => {
      try {
        const status = await api.jobStatus(job.jobId);
        if (cancelled) return;
        setJob(status);

        const bucket = Math.floor((status.percent || 0) / 20) * 20;
        if (bucket > lastAnnouncedPercent.current && status.status === 'running') {
          lastAnnouncedPercent.current = bucket;
          announce(`${bucket} percent. ${status.message}`);
        }

        if (status.status === 'done') {
          setTimeline(status.result);
          setPhase('ready');
          return;
        }
        if (status.status === 'error') {
          setPhase('idle');
          setFormError(status.error?.message || 'Processing failed.');
          report(`Processing failed. ${status.error?.message || ''}`, { assertive: true });
          return;
        }
        setTimeout(poll, POLL_MS);
      } catch (err) {
        if (cancelled) return;
        setPhase('idle');
        setFormError(err.message);
        report(`Processing failed. ${err.message}`, { assertive: true });
      }
    };

    const timer = setTimeout(poll, POLL_MS);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [phase, job?.jobId, announce, report]);

  const reset = useCallback(() => {
    speech.cancel();
    setPhase('idle');
    setVideoId(null);
    setTimeline(null);
    setJob(null);
    setInfo(null);
    setLastAnswer(null);
    report('Returned to the video chooser.');
  }, [report, speech]);

  /* ---------------------------------------------------------------- actions */

  const togglePlay = useCallback(() => {
    if (!ready) return;
    if (isPlaying) {
      controls.pause();
      announce('Paused.');
    } else {
      controls.play();
      announce('Playing.');
    }
  }, [ready, isPlaying, controls, announce]);

  const seekBy = useCallback(
    (delta) => {
      if (!ready) return;
      const target = Math.max(0, Math.min(controls.getTime() + delta, duration || Infinity));
      controls.seekTo(target);
      setCurrentTime(target);
      announce(`${delta > 0 ? 'Forward' : 'Back'} ${Math.abs(delta)} seconds. ${speakTime(target)}.`);
    },
    [ready, controls, duration, announce],
  );

  const seekTo = useCallback(
    (seconds) => {
      if (!ready) return;
      controls.seekTo(seconds);
      setCurrentTime(seconds);
    },
    [ready, controls],
  );

  const toggleMute = useCallback(() => {
    if (!ready) return;
    const next = !controls.isMuted();
    if (next) controls.mute();
    else controls.unMute();
    setMuted(next);
    announce(next ? 'Video muted.' : 'Video unmuted.');
  }, [ready, controls, announce]);

  const toggleDescriptions = useCallback(() => {
    const next = toggle('descriptionsEnabled');
    announce(next ? 'Audio descriptions on.' : 'Audio descriptions off.');
  }, [toggle, announce]);

  /**
   * Skip whatever VisionBridge is currently saying — a description or an answer.
   * Cancelling the speech resolves the in-flight `speak()`, which lets the
   * scheduler's (or Q&A's) cleanup resume the video if it had been paused for
   * this description. The learner is never stranded in a pause.
   */
  const skipSpeech = useCallback(() => {
    if (speech.speaking || scheduler.busy || asking) {
      speech.cancel();
      announce('Skipped.', { assertive: true });
    } else {
      announce('Nothing is being spoken right now.');
    }
  }, [speech, scheduler.busy, asking, announce]);

  const changeRate = useCallback(
    (delta) => {
      const next = Math.max(0.5, Math.min(2.5, Number((settings.rate + delta).toFixed(1))));
      update({ rate: next });
      announce(`Speech speed ${next.toFixed(1)}.`);
    },
    [settings.rate, update, announce],
  );

  /**
   * Interactive Q&A (spec §12): pause, look at the current frame, answer,
   * resume exactly where the learner left off.
   */
  const ask = useCallback(
    async ({ question, presetId }) => {
      if (!videoId || asking) return;
      const wasPlaying = isPlaying;
      const time = controls.getTime();

      setAsking(true);
      setAskQuestion(question);
      controls.pause();
      // The video is now held for the answer; if the learner force-plays while
      // it is being spoken, the player-state handler stops the speech.
      holdingPlaybackRef.current = true;
      speech.cancel();
      announce(`Asking Gemma: ${question}`, { assertive: true });

      try {
        const answer = await api.askFrame({ videoId, time, question, presetId });
        setLastAnswer({ ...answer, question });
        const spoken = answer.grounded
          ? answer.answer
          : `I am not certain about this. ${answer.answer}`;
        await speakDucked(spoken);
      } catch (err) {
        setLastAnswer({ question, answer: err.message, grounded: false, time });
        await speech.speak(`Sorry, I could not answer that. ${err.message}`);
      } finally {
        // Clear the hold before our own resume so it is not mistaken for a
        // force-play and does not cancel the answer we just finished.
        holdingPlaybackRef.current = false;
        setAsking(false);
        if (wasPlaying) controls.play();
      }
    },
    [videoId, asking, isPlaying, controls, speech, speakDucked, announce],
  );

  const askPreset = useCallback(
    (index) => {
      const preset = presets[index];
      if (preset) ask({ presetId: preset.id, question: preset.question });
    },
    [presets, ask],
  );

  /* -------------------------------------------------------------- shortcuts */

  const bindings = useMemo(
    () => [
      { keys: [' ', 'k'], label: 'Play or pause', group: 'Playback', run: togglePlay },
      { keys: ['ArrowLeft'], label: 'Back 5 seconds', group: 'Playback', run: () => seekBy(-5) },
      { keys: ['ArrowRight'], label: 'Forward 5 seconds', group: 'Playback', run: () => seekBy(5) },
      { keys: ['j'], label: 'Back 10 seconds', group: 'Playback', run: () => seekBy(-10) },
      { keys: ['l'], label: 'Forward 10 seconds', group: 'Playback', run: () => seekBy(10) },
      { keys: ['Home'], label: 'Back to the start', group: 'Playback', run: () => seekTo(0) },
      { keys: ['m'], label: 'Mute or unmute the video', group: 'Playback', run: toggleMute },
      {
        keys: ['t'],
        label: 'Say the current position',
        group: 'Playback',
        run: () => announce(`${speakTime(controls.getTime())} of ${speakTime(duration)}.`),
      },
      {
        keys: ['d'],
        label: 'Turn audio descriptions on or off',
        group: 'Descriptions',
        run: toggleDescriptions,
      },
      {
        keys: ['s'],
        label: 'Skip the description being spoken',
        group: 'Descriptions',
        run: skipSpeech,
      },
      {
        keys: ['r'],
        label: 'Replay the last description',
        group: 'Descriptions',
        run: () => {
          if (!scheduler.repeatLast()) announce('Nothing has been described yet.');
        },
      },
      {
        keys: [','],
        label: 'Speak more slowly',
        group: 'Descriptions',
        run: () => changeRate(-0.1),
      },
      {
        keys: ['.'],
        label: 'Speak faster',
        group: 'Descriptions',
        run: () => changeRate(0.1),
      },
      {
        keys: ['a'],
        label: 'Move to the question box',
        group: 'Ask about the screen',
        run: () => {
          document.getElementById('question-input')?.focus();
          announce('Question box. Type a question and press Enter.');
        },
      },
      ...[1, 2, 3, 4, 5, 6, 7, 8].map((n) => ({
        keys: [String(n)],
        label: presets[n - 1] ? presets[n - 1].label : `Question ${n}`,
        group: 'Ask about the screen',
        run: () => askPreset(n - 1),
        hidden: !presets[n - 1],
      })),
      {
        // The real voice-search behaviour lives in a dedicated keydown listener
        // below (this entry documents it in the shortcuts dialog).
        keys: ['w'],
        label: 'Search by voice — press to record, press again to search',
        group: 'General',
        run: () => {},
      },
      {
        keys: ['Escape'],
        label: 'Stop speaking',
        group: 'General',
        allowWhileTyping: true,
        run: () => {
          speech.cancel();
          setShowShortcuts(false);
        },
      },
      {
        keys: ['?', '/'],
        label: 'Show keyboard shortcuts',
        group: 'General',
        run: () => setShowShortcuts((open) => !open),
      },
    ],
    [
      togglePlay,
      seekBy,
      seekTo,
      toggleMute,
      toggleDescriptions,
      skipSpeech,
      changeRate,
      scheduler,
      presets,
      askPreset,
      speech,
      announce,
      controls,
      duration,
    ],
  );

  useKeyboardShortcuts(bindings, {
    enabled: phase === 'ready' && !showShortcuts && !searchOpen,
    onFire: ({ key, label }) => flashKey(key, label),
  });
  useKeyboardShortcuts(
    bindings.filter(
      (b) => b.keys.includes('?') || b.keys.includes('Escape') || b.keys.includes('w'),
    ),
    {
      enabled: (phase !== 'ready' || showShortcuts) && !searchOpen,
      onFire: ({ key, label }) => flashKey(key, label),
    },
  );

  /* ------------------------------------------------------------------ render */

  const settingsPanel = (
    <SettingsPanel
      settings={settings}
      update={update}
      voices={speech.voices}
      language={activeLanguage}
      voiceAvailable={speech.voiceAvailable}
      onTestVoice={() => speech.speak('This is how VisionBridge will read descriptions to you.')}
    />
  );

  return (
    <div className="app">
      <a className="skip-link" href="#main">
        Skip to main content
      </a>

      <LiveRegions polite={polite} assertive={assertive} />

      <header className="app-header">
        <div className="brand">
          <img className="brand-logo" src="/cat-headphones.png" alt="" />
          <div>
            <h1 className="wordmark">VisionBridge</h1>
            <p className="tagline">
              Making visual content accessible through intelligent audio descriptions.
            </p>
          </div>
        </div>

        <div className="header-actions">
          {phase !== 'idle' && (
            <button type="button" className="secondary" onClick={reset}>
              <Icon name="home" size={18} />
              Home
            </button>
          )}
          <button
            type="button"
            className="secondary search-open-btn"
            onClick={() => setSearchOpen(true)}
          >
            <Icon name="search" size={18} />
            Find a video
            <kbd className="kbd">W</kbd>
          </button>
          <button
            type="button"
            className="secondary icon-only"
            onClick={() => setSettingsOpen(true)}
            aria-label="Speech and display settings"
          >
            <Icon name="settings" size={20} />
          </button>
        </div>
      </header>

      <main id="main" tabIndex={-1}>
        {phase === 'idle' && (
          <div className="stage">
            <UrlForm onSubmit={handleSubmit} busy={false} error={formError} />
            <ExampleVideos onPick={handleSubmit} busy={false} />
          </div>
        )}

        {phase === 'processing' && (
          <div className="stage">
            <ProcessingStatus job={job} videoTitle={info?.title} onCancel={reset} />
          </div>
        )}

        {phase === 'ready' && (
          <div className="ready-layout">
            <PlayerPanel
              ref={playButtonRef}
              containerRef={containerRef}
              title={info?.title}
              language={activeLanguage}
              currentTime={currentTime}
              duration={duration || info?.duration || 0}
              isPlaying={isPlaying}
              descriptionsEnabled={settings.descriptionsEnabled}
              descriptionCount={descriptions.length}
              muted={muted}
              speaking={speech.speaking}
              onPlayPause={togglePlay}
              onSeek={seekTo}
              onSeekBy={seekBy}
              onToggleDescriptions={toggleDescriptions}
              onToggleMute={toggleMute}
              onSkip={skipSpeech}
              onRepeat={() => {
                if (!scheduler.repeatLast()) announce('Nothing has been described yet.');
              }}
            />

            <QuestionPanel
              presets={presets}
              onAsk={ask}
              busy={asking}
              lastAnswer={lastAnswer}
              disabled={!ready}
            />

            <DescriptionTimeline
              descriptions={descriptions}
              currentTime={currentTime}
              stats={timeline?.stats}
              onJump={(entry) => {
                scheduler.jumpTo(entry);
                announce(`Jumped to ${speakTime(entry.time)}.`);
              }}
            />

            <button type="button" className="secondary reset-btn" onClick={reset}>
              <Icon name="replay" size={18} />
              Choose a different video
            </button>
          </div>
        )}
      </main>

      <footer className="app-footer">
        <div className="footer-brand">
          <img src="/cat-face.png" alt="" />
          <p>
            Every description and answer comes from <strong>{modelInfo?.model || 'Gemma'}</strong>.
            Gemma is the only generative model.
          </p>
        </div>
        <div className="footer-actions" style={{ display: 'flex', gap: '1rem', alignItems: 'center', flexWrap: 'wrap' }}>
          <a href={apiUrl('/api/config')} target="_blank" rel="noreferrer">
            <Icon name="external" size={16} />
            Model config
          </a>
          <button type="button" className="secondary" onClick={() => setShowShortcuts(true)}>
            <Icon name="keyboard" size={18} />
            Keyboard shortcuts
          </button>
        </div>
      </footer>

      <ShortcutsDialog
        open={showShortcuts}
        onClose={() => setShowShortcuts(false)}
        bindings={bindings}
      />

      <SearchDialog
        open={searchOpen}
        onClose={() => setSearchOpen(false)}
        onPick={(url) => {
          setSearchOpen(false);
          handleSubmit(url);
        }}
        voice={voice}
      />

      <SettingsDialog open={settingsOpen} onClose={() => setSettingsOpen(false)}>
        {settingsPanel}
      </SettingsDialog>

      {(voice.listening || voice.busy || voice.error) && (
        <div className={`voice-overlay${voice.error ? ' voice-error' : ''}`} role="status">
          <img src="/cat-headphones.png" alt="" />
          <div className="voice-overlay-text">
            <strong>
              {voice.error ? 'Voice search' : voice.listening ? 'Listening…' : 'Transcribing…'}
            </strong>
            <span>
              {voice.error
                ? voice.error
                : voice.listening
                  ? 'Speak now — press W again to search'
                  : 'One moment'}
            </span>
          </div>
          {voice.listening && (
            <span className="speaking-wave" aria-hidden="true">
              <span />
              <span />
              <span />
              <span />
              <span />
            </span>
          )}
        </div>
      )}

      {/* Asking Gemma: pops up the instant a preset (or number key) is pressed,
          so there is immediate visual feedback while Gemma looks at the frame. */}
      {asking && (
        <div className="voice-overlay asking-overlay" role="status">
          <img src="/cat-face.png" alt="" />
          <div className="voice-overlay-text">
            <strong>{speech.speaking ? 'Answering…' : 'Asking Gemma…'}</strong>
            {askQuestion && <span>{askQuestion}</span>}
          </div>
          <span className="speaking-wave" aria-hidden="true">
            <span />
            <span />
            <span />
            <span />
            <span />
          </span>
        </div>
      )}

      {/* Centre-screen keystroke flash — shows which key was pressed (2, J, →)
          so shortcuts are visible on a screen recording. Decorative only. */}
      {keyHud && (
        <div className="key-hud" key={keyHud.id} aria-hidden="true">
          <kbd>{keyHud.cap}</kbd>
          {keyHud.label && <span>{keyHud.label}</span>}
        </div>
      )}
    </div>
  );
}
