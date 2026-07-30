# VisionBridge

## Subtitle
Gemma 4 turns visual YouTube tutorials into accessible, pause-aware audio descriptions for blind and low-vision learners.

## Project Description

VisionBridge makes visual learning on YouTube accessible to blind and low-vision students. Many tutorials depend on code blocks, diagrams, terminal output, slides, graphs, and screen annotations that are never fully explained aloud. Screen readers can read captions, but they cannot describe what the instructor points at, builds, highlights, or draws on screen. VisionBridge fills that gap by generating short, context-aware audio descriptions only when the visual information is actually necessary.

The core design principle is simple: decide first, describe second. VisionBridge reads the transcript, finds natural pauses in the narration, and asks Gemma 4 whether a frame needs to be described. If the narration already carries the meaning, the system stays silent. If the screen contains important visual information, it generates either a brief pointer or a fuller explanation and speaks it during a safe pause. This keeps the instructor’s voice intact while adding the missing context a blind learner needs to follow the lesson.

Gemma 4 is the only generative model used in the project. It powers two key stages of the pipeline. First, a comprehension pass reads the title and full transcript to build a compact understanding of the lesson: the domain, the main concepts, the likely visual patterns, and the terminology that should be spoken clearly. Second, a per-frame decision pass combines the frame image, nearby transcript context, and that lesson summary to decide whether the moment is visually important enough to describe. This makes Gemma 4 the reasoning engine of the system, not a generic chatbot bolted onto the side.

Technically, VisionBridge works as a cache-first pipeline. The server downloads each video once, extracts captions and transcript cues, identifies candidate timestamps from natural speech gaps, and uses ffmpeg to pull frames only for those moments. Gemma 4 then evaluates each candidate and returns structured decisions that are filtered by confidence, pause availability, and duplicate suppression. The resulting timeline is written to disk and reused on future visits, so repeat playback is fast and does not re-run the expensive AI steps.

This cache-first design also solves a practical deployment problem. Cloud hosts often trigger YouTube bot-checks during yt-dlp requests, which makes live downloading unreliable. VisionBridge avoids that failure mode for known videos by allowing the processed cache to be generated locally and synced to the server. Once the downloaded video, transcript, comprehension data, and timeline exist in the cache, playback and question answering work without contacting yt-dlp again.

The user experience is designed for real access, not just a demo. VisionBridge supports keyboard navigation, screen-reader announcements, multilingual descriptions, voice search, and interactive questions about the current frame. It can speak short contextual hints during narration pauses, or pause the video for a longer explanation when the visual is too dense for a brief description. That makes it useful across coding tutorials, math lectures, science lessons, and slide-based teaching where the screen matters as much as the audio.

The biggest challenge was making the system quiet by default while still being helpful when it matters. Too much narration becomes noise; too little leaves the learner lost. VisionBridge addresses that with a strong silence-first policy, confidence thresholds, gap detection, and fallback behavior that prefers silence over guessing. A second challenge was keeping the system reliable in deployment. The project handles this with a disk cache, local preprocessing for known videos, and documentation for residential egress when live downloading is required.

The result is a practical accessibility tool that helps blind and low-vision learners independently follow tutorial content that would otherwise be difficult or impossible to use. VisionBridge shows how Gemma 4 can be integrated into a real product as the primary model for multimodal reasoning, while still preserving a natural learning experience.
