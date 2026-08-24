"""
canary_utils.py — NVIDIA Canary-1B-v2 transcription helpers.

Canary is an encoder-decoder (AED) architecture — the same family as Whisper,
not Parakeet's transducer (RNNT/TDT). That matters here: NeMo's GPU-accelerated
phrase-boosting (GPU-PB) context biasing explicitly supports AED models, whereas
the earlier feature/parakeet branch's TDT hotword attempt was built on a decoding
mechanism NeMo's own docs describe as immature and prone to silently no-op'ing.

Requirements:
    pip install nemo_toolkit[asr]
    (CUDA GPU required — no CPU/Apple Silicon fallback)

Model:
    nvidia/canary-1b-v2 (~978M params, 32 encoder / 8 decoder layers)
    HuggingFace: https://huggingface.co/nvidia/canary-1b-v2
    Natively multilingual/multitask; we use it for English ASR only here.
    Long-form audio is chunked automatically (1s overlap) when batch_size=1 —
    no manual chunk-and-stitch needed, unlike Parakeet-TDT.

Context Biasing (proper noun boosting):
    Canary supports NeMo's boosting-tree context biasing at beam-search decode
    time via the `multitask_decoding` config. A list of campaign vocabulary
    phrases (character/place/faction names — multi-word phrases are fine, not
    just single tokens) is boosted so ambiguous acoustics resolve toward known
    campaign terms.

    IMPORTANT: unlike Parakeet-TDT (which output all-lowercase text needing a
    post-hoc casing fix), Canary outputs proper capitalization/punctuation
    natively. The flip side: boosted key phrases must be pre-capitalized
    exactly as you want them to appear — the boosting tree does not re-case
    what it matches.

    The exact Python config dataclass for the boosting tree isn't documented
    outside NVIDIA's CLI/YAML examples (multitask_decoding.beam.boosting_tree.*),
    so this is applied defensively: if the installed NeMo version's config
    shape doesn't match what's attempted here, we log and fall back to
    transcribing without biasing rather than failing the job.
"""

import re


def _parse_vocab_words(vocab_prompt: str) -> list:
    """Split a comma/newline/semicolon-separated vocab string into phrase tokens.

    Unlike parakeet_utils's version, casing is preserved — Canary needs
    boosted phrases pre-capitalized as-is (see module docstring).
    """
    if not vocab_prompt:
        return []
    words = re.split(r'[,\n;]+', vocab_prompt)
    seen = set()
    result = []
    for w in words:
        w = w.strip()
        if w and w not in seen:
            seen.add(w)
            result.append(w)
    return result


def load_canary_model():
    """Load Canary-1B-v2 via NVIDIA NeMo. Returns the model on CUDA."""
    try:
        from nemo.collections.asr.models import ASRModel  # noqa: F401
    except ImportError:
        raise ImportError(
            "NeMo ASR is not installed.\n"
            "Install with: pip install nemo_toolkit[asr]\n"
            "Note: this pulls in a large set of dependencies (~2GB)."
        )

    import torch
    if not torch.cuda.is_available():
        raise RuntimeError(
            "Canary requires a CUDA GPU. No CUDA device found.\n"
            "Use a Whisper model (e.g. large-v3) for CPU/Apple Silicon."
        )

    # Clear any stale allocations before loading (mirrors parakeet_utils's
    # OOM-safety convention).
    import gc
    gc.collect()
    torch.cuda.empty_cache()
    torch.cuda.synchronize()

    print("Loading Canary-1B-v2 (nvidia/canary-1b-v2)...")
    model = ASRModel.from_pretrained(model_name="nvidia/canary-1b-v2", map_location="cpu")
    model = model.cuda()
    model.eval()
    model._model_type = "canary"
    print("Canary model loaded.")
    return model


def _apply_context_biasing(model, phrases, context_score=1.0):
    """
    Attempt to apply GPU-PB context biasing (boosting tree) to the Canary model.

    depth_scaling=1.0 is NVIDIA's documented value for Canary/AED models
    (vs 2.0 for CTC/RNNT models like Parakeet). Falls back gracefully if the
    installed NeMo version's config shape differs from what's attempted here.
    """
    if not phrases:
        return

    try:
        from omegaconf import OmegaConf
        top_cfg = OmegaConf.to_container(model.cfg, resolve=True)
        decoding_key = "multitask_decoding" if "multitask_decoding" in top_cfg else "decoding"
        if decoding_key not in top_cfg:
            raise KeyError(f"No multitask_decoding/decoding key found in model.cfg")

        decoding_cfg = top_cfg[decoding_key]
        decoding_cfg["strategy"] = "beam"
        decoding_cfg.setdefault("beam", {})
        decoding_cfg["beam"]["boosting_tree"] = {
            "key_phrases_list": phrases,
            "context_score": context_score,
            "depth_scaling": 1.0,
        }
        cfg_structured = OmegaConf.create(decoding_cfg)
        model.change_decoding_strategy(cfg_structured)
        print(f"      context biasing: {len(phrases)} phrases, context_score={context_score}")
    except Exception as e:
        print(f"      context biasing unavailable ({e}), transcribing without it")


def _parse_hypothesis(hypothesis, time_offset=0.0):
    """Extract word-level timestamps from a NeMo hypothesis, offset by time_offset seconds.

    Structurally the same shape as parakeet_utils._parse_hypothesis, but Canary's
    hypothesis.text is already properly cased/punctuated, so no casing recovery
    is needed downstream.
    """
    if not hypothesis or not hypothesis.text.strip():
        return []

    word_timestamps = []
    if hasattr(hypothesis, "timestamp") and hypothesis.timestamp:
        word_timestamps = hypothesis.timestamp.get("word", [])

    if not word_timestamps:
        return []

    text_words = hypothesis.text.split()
    raw_words = [wt.get("word", "") for wt in word_timestamps]
    content_words = text_words if len(text_words) == len(word_timestamps) else raw_words

    words = []
    for content, wt in zip(content_words, word_timestamps):
        words.append({
            "word": content,
            "start": float(wt.get("start", 0.0)) + time_offset,
            "end": float(wt.get("end", 0.0)) + time_offset,
        })
    return words


_SENTENCE_GAP_THRESHOLD = 1.0   # seconds of silence between words → new segment
_MAX_SEGMENT_WORDS = 40          # force a break after this many words regardless


def _flush_segment(current_words, segments):
    if not current_words:
        return
    text = " ".join(w["word"] for w in current_words).strip()
    if text and len(text) >= 2:
        segments.append({
            "start": current_words[0]["start"],
            "end": current_words[-1]["end"],
            "text": text,
        })
    current_words.clear()


def _words_to_segments(all_words):
    """Group word-level timestamps into sentence segments (same heuristic as
    parakeet_utils: punctuation breaks, time-gap breaks, max-length breaks)."""
    segments = []
    current_words = []

    for word_info in all_words:
        word = word_info["word"]

        if current_words:
            gap = word_info["start"] - current_words[-1]["end"]
            if gap >= _SENTENCE_GAP_THRESHOLD:
                _flush_segment(current_words, segments)

        if len(current_words) >= _MAX_SEGMENT_WORDS:
            _flush_segment(current_words, segments)

        current_words.append(word_info)

        if re.search(r'[.?!]["\'”»]?$', word.strip()):
            _flush_segment(current_words, segments)

    _flush_segment(current_words, segments)
    return segments


def transcribe_audio_canary(model, wav_path, **kwargs):
    """
    Transcribe a WAV file using Canary and return the same dict format as
    whisper_utils.transcribe_audio: {"segments": [{start, end, text}, ...]}

    Long-form audio is handled by Canary's built-in dynamic chunking
    (auto-enabled for batch_size=1) — no manual chunk-and-stitch needed.

    Supported kwargs:
        initial_prompt (str): comma/newline-separated vocab phrases for
                              context biasing. Same field as Whisper's
                              vocab_prompt.
        context_score (float): biasing strength, default 1.0
    """
    import torch

    initial_prompt = kwargs.get("initial_prompt") or ""
    context_score = float(kwargs.get("context_score", 1.0))

    phrases = _parse_vocab_words(initial_prompt)
    if phrases:
        _apply_context_biasing(model, phrases, context_score)
    else:
        print("      context biasing: no vocab words configured")

    with torch.no_grad():
        hypotheses = model.transcribe(
            [wav_path],
            source_lang="en",
            target_lang="en",
            timestamps=True,
            batch_size=1,
        )

    hyp = hypotheses[0] if hypotheses else None
    all_words = _parse_hypothesis(hyp) if hyp else []

    if not all_words and hyp and hyp.text.strip():
        # Fell back to segment-level output only (no word timestamps available)
        return {"segments": [{"start": 0.0, "end": 0.0, "text": hyp.text.strip()}]}

    segments = _words_to_segments(all_words)
    return {"segments": segments}
