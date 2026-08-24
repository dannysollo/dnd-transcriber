"""
canary_utils.py — NVIDIA Canary transcription helpers.

Canary is an encoder-decoder (AED) architecture — the same family as Whisper,
not Parakeet's transducer (RNNT/TDT). That matters here: NeMo's GPU-accelerated
phrase-boosting (GPU-PB) context biasing explicitly supports AED models, whereas
the earlier feature/parakeet branch's TDT hotword attempt was built on a decoding
mechanism NeMo's own docs describe as immature and prone to silently no-op'ing.

Requirements:
    pip install nemo_toolkit[asr]
    (CUDA GPU required — no CPU/Apple Silicon fallback)

Model:
    nvidia/canary-1b-flash (~883M params), not canary-1b-v2.
    HuggingFace: https://huggingface.co/nvidia/canary-1b-flash
    v2 was tried first (newer, marginally more accurate) but its `.nemo`
    checkpoint bundles an internal "external timestamps" CTC sub-model that
    nemo_toolkit 2.7.2 fails to restore — `ASRModel.restore_from(...)` is
    called on the abstract base class internally and raises
    `TypeError: Can't instantiate abstract class ASRModel`. This is a known
    NeMo bug (NVIDIA-NeMo/NeMo#14947 tracks a related v2-loading failure);
    flash predates that submodel entirely (`model.timestamps_asr_model is
    None`) and loads cleanly, so it's the pragmatic choice until NeMo/the v2
    checkpoint gets fixed upstream.
    Natively multilingual/multitask; we use it for English ASR only here.

    Canary's automatic long-form chunking (1s-overlap dynamic chunking, per
    NVIDIA's docs) turns out to be gated on `self.timestamps_asr_model is not
    None` in aed_multitask_models.py — i.e. it's actually a v2-only feature,
    not a general Canary capability as the docs imply. Flash has no such
    submodel, so it silently skips chunking and OOMs the conformer encoder on
    anything longer than ~40s. We do our own chunk-and-stitch here (25s chunks,
    matching flash's training `max_duration`), same shape as Parakeet-TDT
    needed, just for a different underlying reason.

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

    Verified against the installed nemo_toolkit 2.7.2 source directly (its
    Python config API isn't documented outside NVIDIA's CLI/YAML examples):
    `AEDBeamInferConfig.boosting_tree` takes a plain dict matching
    `BoostingTreeModelConfig`'s fields, and the separate `boosting_tree_alpha`
    field (default 0.0) is the actual fusion weight — building the tree
    without setting it has zero effect on output. See `_apply_context_biasing`
    for details. Applied defensively regardless: falls back to transcribing
    without biasing if a future NeMo version changes this shape.
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


CANARY_MODEL_NAME = "nvidia/canary-1b-flash"


def load_canary_model():
    """Load Canary via NVIDIA NeMo. Returns the model on CUDA."""
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

    print(f"Loading Canary ({CANARY_MODEL_NAME})...")

    # On this WSL2 GPU passthrough setup, loading immediately after a crashed
    # CUDA process sometimes throws a bogus OOM on the CPU->CUDA transfer
    # (torch reports a nonsensical "17179869184.00 GiB memory in use" while
    # nvidia-smi shows >10GB genuinely free) — the driver hasn't finished
    # releasing the previous process's context yet. A short backoff-and-retry
    # clears it; this is a driver-state race, not a real capacity problem.
    import time
    last_err = None
    for attempt in range(3):
        model = ASRModel.from_pretrained(model_name=CANARY_MODEL_NAME, map_location="cpu")
        try:
            model = model.cuda()
            break
        except torch.OutOfMemoryError as e:
            last_err = e
            del model
            gc.collect()
            torch.cuda.empty_cache()
            wait = 5 * (attempt + 1)
            print(f"      CUDA transfer failed (attempt {attempt + 1}/3), "
                  f"retrying in {wait}s (WSL2 driver cooldown)...")
            time.sleep(wait)
    else:
        raise RuntimeError(f"Canary .cuda() failed after 3 attempts: {last_err}")

    model.eval()
    model._model_type = "canary"
    print("Canary model loaded.")
    return model


def _apply_context_biasing(model, phrases, boosting_tree_alpha=1.0, context_score=1.0, beam_size=4):
    """
    Apply GPU-PB context biasing (boosting tree) to the Canary model.

    Verified against the installed nemo_toolkit 2.7.2 source
    (nemo/collections/asr/parts/submodules/multitask_beam_decoding.py,
    nemo/collections/asr/parts/context_biasing/boosting_graph_batched.py):

    `AEDBeamInferConfig.boosting_tree` is a `BoostingTreeModelConfig` — a plain
    dict of {key_phrases_list, context_score, depth_scaling, ...} is valid here;
    `TransformerAEDBeamInfer.__init__` builds the actual GPU tree from it via
    `GPUBoostingTreeModel.from_config(...)`.

    Critically, `boosting_tree_alpha` (the fusion weight applied at decode time)
    is a SEPARATE field from `context_score` (an internal per-arc graph weight)
    and defaults to 0.0 — building the tree without setting this has no effect
    on the output at all. This needs tuning per-dataset; 1.0 is a starting point.

    depth_scaling=1.0 is NVIDIA's documented value for Canary/AED models
    (vs the dataclass default of 2.0, which is for CTC/RNNT models like Parakeet).

    Falls back gracefully if a future NeMo version changes this config shape.
    """
    if not phrases:
        return

    try:
        from omegaconf import OmegaConf
        decoding_cfg = OmegaConf.to_container(model.cfg.decoding, resolve=True)
        decoding_cfg["strategy"] = "beam"
        decoding_cfg.setdefault("beam", {})
        decoding_cfg["beam"]["beam_size"] = beam_size
        decoding_cfg["beam"]["boosting_tree"] = {
            "key_phrases_list": phrases,
            "context_score": context_score,
            "depth_scaling": 1.0,
        }
        decoding_cfg["beam"]["boosting_tree_alpha"] = boosting_tree_alpha
        model.change_decoding_strategy(OmegaConf.create(decoding_cfg))
        print(f"      context biasing: {len(phrases)} phrases, "
              f"boosting_tree_alpha={boosting_tree_alpha}, beam_size={beam_size}")
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


_CHUNK_SECONDS = 25   # canary-1b-flash was trained on utterances up to 40s
                      # (max_duration: 40.0 in its config); stay well under that
_CHUNK_BATCH = 4      # chunks per model.transcribe() call


def _extract_wav_chunk(audio, sr, start_sample, end_sample, tmp_path):
    import soundfile as sf
    sf.write(tmp_path, audio[start_sample:end_sample], sr)


def transcribe_audio_canary(model, wav_path, **kwargs):
    """
    Transcribe a WAV file using Canary and return the same dict format as
    whisper_utils.transcribe_audio: {"segments": [{start, end, text}, ...]}

    Manual chunking is required here: NeMo's automatic long-form chunking for
    AED models (`enable_chunking`) is hard-gated on `self.timestamps_asr_model
    is not None` (see aed_multitask_models.py) — a feature only canary-1b-v2's
    checkpoint bundles. canary-1b-flash has no such submodel, so without manual
    chunking a full session-length clip gets encoded in one forward pass and
    OOMs the conformer encoder well before VRAM capacity is actually the limit.

    Supported kwargs:
        initial_prompt (str): comma/newline-separated vocab phrases for
                              context biasing. Same field as Whisper's
                              vocab_prompt.
        boosting_tree_alpha (float): biasing strength (fusion weight applied
                              at decode time), default 1.0. Needs tuning.
    """
    import os
    import tempfile
    import torch
    import soundfile as sf

    initial_prompt = kwargs.get("initial_prompt") or ""
    boosting_tree_alpha = float(kwargs.get("boosting_tree_alpha", 1.0))

    phrases = _parse_vocab_words(initial_prompt)
    if phrases:
        _apply_context_biasing(model, phrases, boosting_tree_alpha)
    else:
        print("      context biasing: no vocab words configured")

    audio, sr = sf.read(wav_path, dtype="float32")
    if audio.ndim > 1:
        audio = audio.mean(axis=1)

    total_samples = len(audio)
    total_duration = total_samples / sr
    chunk_samples = int(_CHUNK_SECONDS * sr)
    num_chunks = max(1, -(-total_samples // chunk_samples))  # ceil div

    all_words = []

    with tempfile.TemporaryDirectory() as tmpdir:
        chunk_paths, time_offsets = [], []
        for i in range(num_chunks):
            start_sample = i * chunk_samples
            end_sample = min(start_sample + chunk_samples, total_samples)
            chunk_path = os.path.join(tmpdir, f"chunk_{i:04d}.wav")
            _extract_wav_chunk(audio, sr, start_sample, end_sample, chunk_path)
            chunk_paths.append(chunk_path)
            time_offsets.append(start_sample / sr)

        print(f"      canary: transcribing {num_chunks} chunk(s) "
              f"({int(total_duration)}s total, {_CHUNK_SECONDS}s each)...")

        for batch_start in range(0, num_chunks, _CHUNK_BATCH):
            batch_paths = chunk_paths[batch_start:batch_start + _CHUNK_BATCH]
            batch_offsets = time_offsets[batch_start:batch_start + _CHUNK_BATCH]
            with torch.no_grad():
                hypotheses = model.transcribe(
                    batch_paths,
                    source_lang="en",
                    target_lang="en",
                    timestamps=True,
                    batch_size=len(batch_paths),
                )
            pct = int(100 * batch_start / num_chunks)
            print(f"      canary {pct}% ({int(batch_offsets[0])}s / {int(total_duration)}s)")
            for hyp, offset in zip(hypotheses, batch_offsets):
                if hyp:
                    all_words.extend(_parse_hypothesis(hyp, time_offset=offset))

    segments = _words_to_segments(all_words)
    return {"segments": segments}
