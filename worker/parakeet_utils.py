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

    print("Loading Parakeet-TDT-0.6B (nvidia/parakeet-tdt-0.6b)...")
    model = nemo_asr.models.EncDecRNNTBPEModel.from_pretrained(
        "nvidia/parakeet-tdt-0.6b"
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
        current_cfg = OmegaConf.structured(model.cfg.decoding)
        current_cfg.rnnt_decoding.hotwords = hotwords
        current_cfg.rnnt_decoding.hotword_weight = hotword_weight
        model.change_decoding_strategy(current_cfg)
        print(f"      context biasing: {len(hotwords)} hotwords, weight={hotword_weight}")
    except Exception as e:
        print(f"      context biasing unavailable ({e}), transcribing without hotwords")


def transcribe_audio_parakeet(model, wav_path, **kwargs):
    """
    Transcribe a WAV file using Parakeet-TDT and return the same dict format
    as whisper_utils.transcribe_audio: {"segments": [{start, end, text}, ...]}

    Supported kwargs:
        initial_prompt (str): comma/newline-separated vocab words for context
                              biasing. Same field as Whisper's vocab_prompt.
        hotword_weight (float): biasing strength, default 20.0
    """
    import torch

    initial_prompt = kwargs.get("initial_prompt", "")
    hotword_weight = float(kwargs.get("hotword_weight", 20.0))

    hotwords = _parse_vocab_words(initial_prompt)
    if hotwords:
        _apply_context_biasing(model, hotwords, hotword_weight)
    else:
        print("      context biasing: no vocab words configured")

    with torch.no_grad():
        hypotheses = model.transcribe([wav_path], timestamps=True)

    hypothesis = hypotheses[0] if hypotheses else None
    if not hypothesis or not hypothesis.text.strip():
        return {"segments": []}

    word_timestamps = []
    if hasattr(hypothesis, "timestamp") and hypothesis.timestamp:
        word_timestamps = hypothesis.timestamp.get("word", [])

    if not word_timestamps:
        text = hypothesis.text.strip()
        if text and len(text) >= 3:
            return {"segments": [{"start": 0.0, "end": 0.0, "text": text}]}
        return {"segments": []}

    segments = []
    current_words = []

    for word_info in word_timestamps:
        word = word_info.get("word", "")
        start = float(word_info.get("start", 0.0))
        end = float(word_info.get("end", 0.0))
        current_words.append({"word": word, "start": start, "end": end})

        if re.search(r'[.?!]["\'\u201d\u00bb]?$', word.strip()):
            text = "".join(w["word"] for w in current_words).strip()
            if text and len(text) >= 3:
                segments.append({
                    "start": current_words[0]["start"],
                    "end": end,
                    "text": text,
                })
            current_words = []

    if current_words:
        text = "".join(w["word"] for w in current_words).strip()
        if text and len(text) >= 3:
            segments.append({
                "start": current_words[0]["start"],
                "end": current_words[-1]["end"],
                "text": text,
            })

    return {"segments": segments}
