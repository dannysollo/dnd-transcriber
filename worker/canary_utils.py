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

Models (selectable — see CANARY_VARIANTS):
    "canary-1b-flash" -> nvidia/canary-1b-flash (~883M params, default)
    "canary-1b"        -> nvidia/canary-1b (standard/non-fast variant)
    HuggingFace: https://huggingface.co/nvidia/canary-1b-flash
                 https://huggingface.co/nvidia/canary-1b

    canary-1b-v2 was tried first (newer, marginally more accurate on paper) but
    its `.nemo` checkpoint bundles an internal "external timestamps" CTC
    sub-model, and restoring it fails under nemo_toolkit 2.7.2 —
    `ASRModel.restore_from(...)` is called on the abstract base class
    internally and raises `TypeError: Can't instantiate abstract class
    ASRModel`. This is a known NeMo bug (NVIDIA-NeMo/NeMo#14947 tracks a
    related v2-loading failure). Neither flash nor standard 1b have that
    submodel (`model.timestamps_asr_model is None`), so both load cleanly —
    v2 is intentionally not offered as a selectable option until NeMo fixes
    this upstream.

    Standard canary-1b has a further limitation flash doesn't: it doesn't
    support word-level timestamps at all — `model.transcribe(timestamps=True)`
    raises "Timestamp feature is not supported in Canary prompt format.
    Please use latest canary-1b-flash or canary-180m-flash" (NeMo's own
    message). The top-level `timestamps=` flag isn't actually what trips this —
    it's a separate `timestamp` prompt *slot* (singular) whose default is baked
    into the legacy 'canary' prompt template regardless of that flag; passing
    `timestamp=False` through .transcribe()'s `**prompt` catch-all overrides
    the slot and avoids the error. transcribe_audio_canary() probes this once
    and falls back to coarse chunk-level timestamps (the VAD chunk's own
    start/end) for that variant rather than per-word timing.

    That same submodel also gates NeMo's automatic long-form chunking
    (`enable_chunking` in aed_multitask_models.py checks
    `self.timestamps_asr_model is not None`) — so despite NVIDIA's docs
    describing dynamic chunking as a general Canary capability, it's actually
    v2-only in practice. Without it, feeding a whole session-length clip in
    one forward pass OOMs the conformer encoder well before VRAM capacity is
    actually the limit. transcribe_audio_canary() below detects this at
    runtime (checking model.timestamps_asr_model, not hardcoding per variant)
    and does its own VAD-based chunk-and-stitch when needed — same approach
    worker/transcribe.py already uses for Whisper (Silero VAD speech regions,
    not blind fixed-time slicing), which also happens to be what's needed to
    avoid a separate failure mode: naive fixed-time chunking can hand the
    model a chunk that's pure silence/noise, and AED decoders (Canary same as
    Whisper) are prone to degenerate repetition-loop hallucinations on such
    input. VAD-based chunking sidesteps this because silent regions are never
    fed to the model at all.

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

Known real-world result (head-to-head against production Whisper turbo+
initial_prompt on a real proper-noun-dense session segment): canary-1b-flash
+biasing got 2/4 known names right, tying Whisper. Not a clear win, but close
enough — and cheap enough to keep available as a selectable option — that it's
worth having rather than discarding.
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


# model_name (as selected in campaign settings / worker.yaml) -> HuggingFace repo id.
# "canary-1b-v2" intentionally omitted — see module docstring.
CANARY_VARIANTS = {
    "canary-1b-flash": "nvidia/canary-1b-flash",
    "canary-1b": "nvidia/canary-1b",
}
DEFAULT_CANARY_VARIANT = "canary-1b-flash"


def load_canary_model(model_name: str = DEFAULT_CANARY_VARIANT):
    """Load a Canary variant via NVIDIA NeMo. Returns the model on CUDA."""
    hf_repo = CANARY_VARIANTS.get(model_name)
    if hf_repo is None:
        raise ValueError(f"Unknown Canary variant {model_name!r}. Options: {list(CANARY_VARIANTS)}")

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

    print(f"Loading Canary ({hf_repo})...")

    # On this WSL2 GPU passthrough setup, loading immediately after a crashed
    # CUDA process sometimes throws a bogus OOM on the CPU->CUDA transfer
    # (torch reports a nonsensical "17179869184.00 GiB memory in use" while
    # nvidia-smi shows >10GB genuinely free) — the driver hasn't finished
    # releasing the previous process's context yet. A short backoff-and-retry
    # clears it; this is a driver-state race, not a real capacity problem.
    import time
    last_err = None
    for attempt in range(3):
        model = ASRModel.from_pretrained(model_name=hf_repo, map_location="cpu")
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
    model._canary_variant = model_name
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


_MAX_CHUNK_SECONDS = 25   # both flash and standard 1b were trained on utterances
                          # up to 40s (max_duration in their configs); stay under that
_CHUNK_BATCH = 1          # WSL2 GPU-passthrough CUDA allocator becomes unreliable
                          # (bogus OOMs with real headroom free) above batch_size=1
                          # on this hardware — see load_canary_model's docstring for
                          # the analogous .cuda()-transfer flakiness. Cheap either way:
                          # ~20 chunks/8min transcribed in ~13s single-batched.
SAMPLE_RATE = 16000


def _vad_chunks(wav_path, max_chunk_s=_MAX_CHUNK_SECONDS):
    """
    Get speech-only chunk boundaries via Silero VAD, same approach as
    worker/transcribe.py's _transcribe_via_vad_chunks: detect speech regions,
    merge ones close together, then cap each at max_chunk_s (splitting long
    continuous speech, since Canary chunks need to stay near its training
    max_duration). Silent/noise regions are never chunked at all — this is
    what avoids the AED repetition-loop hallucination class VAD chunking was
    verified to fix during testing.

    Returns (wav_tensor, [(start_s, end_s), ...]) — wav_tensor is 16kHz mono,
    ready to slice directly by sample index.
    """
    import torch
    import torchaudio
    import soundfile as sf
    from silero_vad import get_speech_timestamps, load_silero_vad

    vad_model = load_silero_vad()
    audio_np, sr = sf.read(wav_path, dtype="float32", always_2d=False)
    wav = torch.from_numpy(audio_np)
    if sr != SAMPLE_RATE:
        wav = torchaudio.functional.resample(wav, sr, SAMPLE_RATE)
    if wav.dim() > 1:
        wav = wav.mean(0)

    speech_ts = get_speech_timestamps(
        wav, vad_model, sampling_rate=SAMPLE_RATE,
        threshold=0.4, min_speech_duration_ms=300,
        min_silence_duration_ms=500, speech_pad_ms=400,
        return_seconds=True,
    )

    merged = []
    for ts in speech_ts:
        if merged and (ts["start"] - merged[-1]["end"]) < 1.5:
            merged[-1]["end"] = ts["end"]
        else:
            merged.append({"start": ts["start"], "end": ts["end"]})

    regions = []
    for r in merged:
        start = r["start"]
        while start < r["end"]:
            end = min(start + max_chunk_s, r["end"])
            regions.append((start, end))
            start = end

    return wav, regions


def transcribe_audio_canary(model, wav_path, **kwargs):
    """
    Transcribe a WAV file using Canary and return the same dict format as
    whisper_utils.transcribe_audio: {"segments": [{start, end, text}, ...]}

    Uses the model's built-in long-form chunking when available (currently
    only true for canary-1b-v2, which isn't a selectable option here — see
    module docstring), detected dynamically via `model.timestamps_asr_model`
    rather than hardcoded per variant so this stays correct if that changes
    upstream. Otherwise does its own VAD-based chunk-and-stitch.

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

    initial_prompt = kwargs.get("initial_prompt") or ""
    boosting_tree_alpha = float(kwargs.get("boosting_tree_alpha", 1.0))

    phrases = _parse_vocab_words(initial_prompt)
    if phrases:
        _apply_context_biasing(model, phrases, boosting_tree_alpha)
    else:
        print("      context biasing: no vocab words configured")

    has_native_chunking = getattr(model, "timestamps_asr_model", None) is not None

    if has_native_chunking:
        print("      canary: using built-in long-form chunking")
        with torch.no_grad():
            hypotheses = model.transcribe(
                [wav_path], source_lang="en", target_lang="en",
                timestamps=True, batch_size=1,
            )
        hyp = hypotheses[0] if hypotheses else None
        all_words = _parse_hypothesis(hyp) if hyp else []
        segments = _words_to_segments(all_words)
        return {"segments": segments}

    # Manual VAD-based chunking path (flash, standard 1b)
    import soundfile as sf
    wav, regions = _vad_chunks(wav_path)
    total_duration = len(wav) / SAMPLE_RATE

    if not regions:
        print("      canary: VAD found no speech in this file")
        return {"segments": []}

    print(f"      canary: transcribing {len(regions)} VAD-chunk(s) "
          f"({int(total_duration)}s total, silence skipped)...")

    # Word-level timestamps aren't supported by every Canary variant (e.g. plain
    # canary-1b raises "Timestamp feature is not supported in Canary prompt
    # format" — only the flash checkpoints support it). Probe once rather than
    # hardcoding per variant, so this stays correct if that changes upstream.
    word_timestamps_supported = True
    all_words = []
    coarse_segments = []

    with tempfile.TemporaryDirectory() as tmpdir:
        for i, (start, end) in enumerate(regions):
            s, e = int(start * SAMPLE_RATE), int(end * SAMPLE_RATE)
            chunk_path = os.path.join(tmpdir, f"chunk_{i:04d}.wav")
            sf.write(chunk_path, wav[s:e].numpy(), SAMPLE_RATE)

            with torch.no_grad():
                if word_timestamps_supported:
                    try:
                        hypotheses = model.transcribe(
                            [chunk_path], source_lang="en", target_lang="en",
                            timestamps=True, batch_size=1,
                        )
                    except ValueError as e:
                        if "Timestamp feature is not supported" not in str(e):
                            raise
                        word_timestamps_supported = False
                        print(f"      canary: model doesn't support word timestamps "
                              f"({model._canary_variant}) — falling back to "
                              f"chunk-level timestamps")
                if not word_timestamps_supported:
                    # `timestamps=False` (the output-format flag) doesn't avoid this —
                    # the ValueError comes from a separate prompt *slot* default baked
                    # into the legacy 'canary' prompt template, and passing `timestamps=`
                    # explicitly (even False) still triggers NeMo to populate that slot's
                    # truthy default. Passing ONLY `timestamp=False` (singular, via
                    # .transcribe()'s **prompt catch-all) overrides the slot directly and
                    # is what actually avoids the error — verified empirically; leave the
                    # top-level `timestamps=` kwarg out entirely here.
                    hypotheses = model.transcribe(
                        [chunk_path], source_lang="en", target_lang="en",
                        timestamp=False, batch_size=1,
                    )

            if i % 5 == 0:
                pct = int(100 * i / len(regions))
                print(f"      canary {pct}% ({int(start)}s / {int(total_duration)}s)")

            hyp = hypotheses[0] if hypotheses else None
            if not hyp:
                continue
            if word_timestamps_supported:
                all_words.extend(_parse_hypothesis(hyp, time_offset=start))
            elif hyp.text.strip():
                # Coarse fallback: one segment per VAD chunk, using the chunk's
                # own (accurate) boundaries rather than word-level timing.
                coarse_segments.append({"start": start, "end": end, "text": hyp.text.strip()})

    if word_timestamps_supported:
        segments = _words_to_segments(all_words)
    else:
        segments = coarse_segments
    return {"segments": segments}
