from __future__ import annotations

from dataclasses import dataclass
from dataclasses import field
from pathlib import Path
from typing import Protocol


EUROLLM_CT2_MODEL_PATH = Path("/home/gunnar/models/EuroLLM-9B-Instruct-ct2-int8")
EUROLLM_CT2_TARGET_LANGUAGE = "Dutch"
class Translator(Protocol):
    def translate(self, source_window: str) -> str:
        ...


@dataclass
class DummyTranslator:
    mode: str = "marker"

    def translate(self, source_window: str) -> str:
        if self.mode == "echo":
            return source_window
        if self.mode == "marker":
            return f"[TRANSLATED] {source_window}" if source_window else ""
        raise ValueError(f"unsupported dummy translator mode: {self.mode!r}")


def create_eurollm_ct2_generator(
    model_path: str | Path = EUROLLM_CT2_MODEL_PATH,
    *,
    device: str = "cuda",
    compute_type: str = "int8",
):
    try:
        import ctranslate2
    except ImportError as exc:  # pragma: no cover - depends on local environment
        raise RuntimeError("ctranslate2 is required for the EuroLLM CT2 translator") from exc

    return ctranslate2.Generator(str(model_path), device=device, compute_type=compute_type)


@dataclass
class Ct2EuroLlmTranslator:
    model_path: str | Path = EUROLLM_CT2_MODEL_PATH
    device: str = "cuda"
    compute_type: str = "int8"
    target_language: str = EUROLLM_CT2_TARGET_LANGUAGE
    max_length: int = 256
    sampling_topk: int = 1
    sampling_topp: float = 1.0
    sampling_temperature: float = 1.0
    repetition_penalty: float = 1.0
    _generator: object = field(init=False, repr=False)
    _tokenizer: object = field(init=False, repr=False)
    _prompt_token_cache: dict[str, list[str]] = field(init=False, repr=False)

    def __post_init__(self) -> None:
        self.model_path = Path(self.model_path)
        self._generator = create_eurollm_ct2_generator(
            self.model_path,
            device=self.device,
            compute_type=self.compute_type,
        )
        self._tokenizer = self._load_tokenizer()
        self._prompt_token_cache = {}
        self._get_static_prompt_tokens(self._default_system_prompt())

    def translate(self, source_window: str) -> str:
        return self.translate_with_system_prompt(source_window, system_prompt=self._default_system_prompt())

    def translate_with_system_prompt(self, source_window: str, *, system_prompt: str) -> str:
        if source_window.strip() == "":
            return ""

        request_tokens = self._tokenize(self._build_request_text(source_window), add_special_tokens=False)
        results = self._generator.generate_batch(  # type: ignore[call-arg]
            [request_tokens],
            static_prompt=self._get_static_prompt_tokens(system_prompt),
            cache_static_prompt=True,
            include_prompt_in_result=False,
            max_length=self.max_length,
            sampling_topk=self.sampling_topk,
            sampling_topp=self.sampling_topp,
            sampling_temperature=self.sampling_temperature,
            repetition_penalty=self.repetition_penalty,
            end_token="<|im_end|>",
        )
        if not results or not results[0].sequences:
            return ""
        return self._decode(results[0].sequences[0]).strip()

    def _default_system_prompt(self) -> str:
        return (
            "You are a translation engine. "
            f"Translate the user's text into {self.target_language}. "
            "Return only the translation."
        )

    def _load_tokenizer(self):
        try:
            from transformers import PreTrainedTokenizerFast
        except ImportError as exc:  # pragma: no cover - depends on local environment
            raise RuntimeError("transformers is required for the EuroLLM CT2 translator") from exc

        tokenizer_file = self.model_path / "tokenizer.json"
        return PreTrainedTokenizerFast(
            tokenizer_file=str(tokenizer_file),
            bos_token="<s>",
            eos_token="<|im_end|>",
            unk_token="<unk>",
        )

    def _get_static_prompt_tokens(self, system_prompt: str) -> list[str]:
        cached = self._prompt_token_cache.get(system_prompt)
        if cached is not None:
            return cached
        tokens = self._tokenize(self._build_static_prompt_text(system_prompt), add_special_tokens=True)
        self._prompt_token_cache[system_prompt] = tokens
        return tokens

    def _build_static_prompt_text(self, system_prompt: str) -> str:
        # This matches the EuroLLM instruct prompt format from the model card.
        return (
            "<|im_start|>system\n"
            f"{system_prompt}<|im_end|>\n"
            "<|im_start|>user\n"
        )

    def _build_request_text(self, source_window: str) -> str:
        return f"{source_window}<|im_end|>\n<|im_start|>assistant\n"

    def _tokenize(self, text: str, *, add_special_tokens: bool) -> list[str]:
        encoded = self._tokenizer(text, add_special_tokens=add_special_tokens)
        return self._tokenizer.convert_ids_to_tokens(encoded["input_ids"])

    def _decode(self, tokens: list[str]) -> str:
        token_ids = self._tokenizer.convert_tokens_to_ids(tokens)
        if isinstance(token_ids, int):
            token_ids = [token_ids]
        return self._tokenizer.decode(token_ids, skip_special_tokens=True)


def build_translator(name: str, *, dummy_mode: str = "marker") -> Translator:
    if name == "dummy":
        return DummyTranslator(mode=dummy_mode)
    raise ValueError(f"unsupported translator: {name!r}")
