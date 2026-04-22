"""
parakeet_utils.py — NVIDIA Parakeet-TDT-0.6B transcription helpers.

Parakeet-TDT uses a Token-and-Duration Transducer architecture (frame-level
classification), giving inherently accurate timestamps with no hallucination
tendencies during silence. This is structurally different from Whisper's
autoregressive decoding, which can generate text when given silence.

Requirements:
    pip install nemo_toolkit[asr]
    (CUDA GPU required — no CPU/Apple Silicon fallback)

Model:
    nvidia/parakeet-tdt-0.6b (~1.2GB)
    HuggingFace: https://huggingface.co/nvidia/parakeet-tdt-0.6b

Context Biasing (proper noun boosting):
    Parakeet supports context biasing via NeMo's hotword mechanism. A list of
    words (e.g. character names, spell names, locations) is passed at
    transcription time and their log-probabilities are boosted during decoding.
    This is cleaner than Whisper's initial_prompt — it doesn't risk influencing
    the whole output, only amplifies specific tokens when the acoustics are
    ambiguous. We parse the vocab_prompt field (comma/newline separated) from
    campaign settings and pass each token as a hotword.

    Note: TDT hotword support in NeMo is less mature than CTC. We attempt it
    and fall back gracefully if the model version doesn't support it.
"""

import re


def _parse_vocab_words(vocab_prompt: str) -> list:
    """Split a comma/newline/semicolon-separated vocab string into word tokens."""
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


def load_parakeet_model():
    """Load Parakeet-TDT-0.6B via NVIDIA NeMo. Returns the model on CUDA."""
    try:
        import nemo.collections.asr as nemo_asr  # noqa: F401
    except ImportError:
        raise ImportError(
            "NeMo ASR is not installed.\n"
            "Install with: pip install nemo_toolkit[asr]\n"
            "Note: this pulls in a large set of dependencies (~2GB)."
        )

    import torch
    if not torch.cuda.is_available():
        raise RuntimeError(
            "Parakeet-TDT requires a CUDA GPU. No CUDA device found.\n"
            "Use a Whisper model (e.g. large-v3) for CPU/Apple Silicon."
        )

    # Clear any stale allocations before loading
    import gc
    gc.collect()
    torch.cuda.empty_cache()
    torch.cuda.synchronize()

    print("Loading Parakeet-TDT-0.6B (nvidia/parakeet-tdt-0.6b-v2)...")
    # Load to CPU first to avoid partial VRAM allocations on OOM failure,
    # then move to CUDA in one shot.
    model = nemo_asr.models.EncDecRNNTBPEModel.from_pretrained(
        "nvidia/parakeet-tdt-0.6b-v2",
        map_location="cpu",
    )
    model = model.cuda()
    model.eval()
    model._model_type = "parakeet"
    print("Parakeet model loaded.")
    return model


def _apply_context_biasing(model, hotwords, hotword_weight=20.0):
    """
    Attempt to apply context biasing (hotword boosting) to the Parakeet model.

    NeMo's hotword mechanism boosts the log-probability of specific token
    sequences during beam search decoding. The weight controls how strongly
    the listed words are preferred when acoustics are ambiguous.

    Weight guidelines:
        10.0 — mild nudge
        20.0 — moderate boost (good default for D&D proper nouns)
        30.0+ — strong bias (use for very unusual homebrew terms)

    Falls back gracefully if the model/NeMo version doesn't support it.
    """
    if not hotwords:
        return

    try:
        from omegaconf import OmegaConf
        # model.cfg contains top-level keys like 'decoding' or 'rnnt_decoding'
        top_cfg = OmegaConf.to_container(model.cfg, resolve=True)
        decoding_key = "decoding" if "decoding" in top_cfg else ("rnnt_decoding" if "rnnt_decoding" in top_cfg else None)
        if decoding_key is None:
            raise KeyError(f"Neither 'decoding' nor 'rnnt_decoding' found in model.cfg")
        top_cfg[decoding_key]["hotwords"] = hotwords
        top_cfg[decoding_key]["hotword_weight"] = hotword_weight
        cfg_structured = OmegaConf.create(top_cfg[decoding_key])
        model.change_decoding_strategy(cfg_structured)
        print(f"      context biasing: {len(hotwords)} hotwords, weight={hotword_weight}")
    except Exception as e:
        print(f"      context biasing unavailable ({e}), transcribing without hotwords")


_CHUNK_SECONDS = 120  # Transcribe 2-minute chunks to avoid CUDA OOM on long files


def _extract_wav_chunk(audio, sr, start_sample, end_sample, tmp_path):
    """Write a slice of audio to a temp WAV file."""
    import soundfile as sf
    chunk = audio[start_sample:end_sample]
    sf.write(tmp_path, chunk, sr)


def _parse_hypothesis(hypothesis, time_offset=0.0):
    """Extract word-level timestamps from a NeMo hypothesis, offset by time_offset seconds."""
    if not hypothesis or not hypothesis.text.strip():
        return []

    word_timestamps = []
    if hasattr(hypothesis, "timestamp") and hypothesis.timestamp:
        word_timestamps = hypothesis.timestamp.get("word", [])

    if not word_timestamps:
        return []

    words = []
    for wt in word_timestamps:
        words.append({
            "word": wt.get("word", ""),
            "start": float(wt.get("start", 0.0)) + time_offset,
            "end": float(wt.get("end", 0.0)) + time_offset,
        })
    return words


def _words_to_segments(all_words):
    """Group word-level timestamps into sentence segments at .?! boundaries."""
    segments = []
    current_words = []

    for word_info in all_words:
        word = word_info["word"]
        current_words.append(word_info)

        if re.search(r'[.?!]["\'\u201d\u00bb]?$', word.strip()):
            text = " ".join(w["word"] for w in current_words).strip()
            if text and len(text) >= 3:
                segments.append({
                    "start": current_words[0]["start"],
                    "end": current_words[-1]["end"],
                    "text": text,
                })
            current_words = []

    if current_words:
        text = " ".join(w["word"] for w in current_words).strip()
        if text and len(text) >= 3:
            segments.append({
                "start": current_words[0]["start"],
                "end": current_words[-1]["end"],
                "text": text,
            })

    return segments


def transcribe_audio_parakeet(model, wav_path, **kwargs):
    """
    Transcribe a WAV file using Parakeet-TDT and return the same dict format
    as whisper_utils.transcribe_audio: {"segments": [{start, end, text}, ...]}

    Audio is split into _CHUNK_SECONDS chunks to avoid CUDA OOM on long files.
    Timestamps are offset per-chunk so the final segments have absolute times.

    Supported kwargs:
        initial_prompt (str): comma/newline-separated vocab words for context
                              biasing. Same field as Whisper's vocab_prompt.
        hotword_weight (float): biasing strength, default 20.0
    """
    import os
    import tempfile
    import torch
    import soundfile as sf

    initial_prompt = kwargs.get("initial_prompt", "")
    hotword_weight = float(kwargs.get("hotword_weight", 20.0))

    hotwords = _parse_vocab_words(initial_prompt)
    if hotwords:
        _apply_context_biasing(model, hotwords, hotword_weight)
    else:
        print("      context biasing: no vocab words configured")

    # Load the full audio to split into chunks
    audio, sr = sf.read(wav_path, dtype="float32")
    if audio.ndim > 1:
        audio = audio.mean(axis=1)  # stereo → mono

    total_samples = len(audio)
    total_duration = total_samples / sr
    chunk_samples = int(_CHUNK_SECONDS * sr)
    num_chunks = max(1, int(total_samples / chunk_samples) + (1 if total_samples % chunk_samples else 0))

    all_words = []

    with tempfile.TemporaryDirectory() as tmpdir:
        # Write all chunks upfront — then transcribe in ONE call to avoid
        # NeMo's CUDA graph state being re-initialized between calls (which
        # causes cudaErrorIllegalAddress on the second chunk).
        chunk_paths = []
        time_offsets = []
        for i in range(num_chunks):
            start_sample = i * chunk_samples
            end_sample = min(start_sample + chunk_samples, total_samples)
            time_offset = start_sample / sr
            chunk_path = os.path.join(tmpdir, f"chunk_{i:04d}.wav")
            _extract_wav_chunk(audio, sr, start_sample, end_sample, chunk_path)
            chunk_paths.append(chunk_path)
            time_offsets.append(time_offset)

        print(f"      parakeet: transcribing {num_chunks} chunk(s) ({int(total_duration)}s total)...")
        with torch.no_grad():
            hypotheses = model.transcribe(chunk_paths, timestamps=True, batch_size=1)

        for i, (hyp, time_offset) in enumerate(zip(hypotheses, time_offsets)):
            pct = int(100 * i / num_chunks)
            print(f"      parakeet {pct}% ({int(time_offset)}s / {int(total_duration)}s)")
            if hyp:
                words = _parse_hypothesis(hyp, time_offset=time_offset)
                all_words.extend(words)

    segments = _words_to_segments(all_words)
    return {"segments": segments}
