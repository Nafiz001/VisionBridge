/**
 * Progress while the timeline is being generated.
 *
 * The progress bar is a real ARIA progressbar, and the same information is
 * repeated as text, so it is legible whether the learner is reading, listening,
 * or both.
 */
export function ProcessingStatus({ job, videoTitle, onCancel }) {
  const percent = Math.max(0, Math.min(100, job?.percent ?? 0));
  const stageLabels = {
    queued: 'Getting ready',
    metadata: 'Reading video details',
    transcript: 'Extracting the transcript',
    gaps: 'Finding natural pauses',
    download: 'Downloading the video',
    describe: 'Gemma is deciding where descriptions are needed',
    cached: 'Loading the saved timeline',
    done: 'Finished',
    error: 'Something went wrong',
  };

  return (
    <section className="panel processing" aria-labelledby="processing-heading">
      <h2 id="processing-heading">Processing video</h2>
      {videoTitle && <p className="video-title">{videoTitle}</p>}

      <div
        className="progress"
        role="progressbar"
        aria-valuenow={percent}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuetext={`${percent} percent. ${job?.message || ''}`}
        aria-labelledby="processing-heading"
      >
        <div className="progress-fill" style={{ width: `${percent}%` }} />
      </div>

      <p className="processing-stage">
        <strong>{stageLabels[job?.stage] || 'Working'}</strong> — {percent}%
      </p>
      <p className="processing-message">{job?.message}</p>

      <button type="button" onClick={onCancel} className="secondary">
        Cancel and choose another video
      </button>
    </section>
  );
}

export default ProcessingStatus;
