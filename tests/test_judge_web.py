from __future__ import annotations

import importlib.util
import json
import tempfile
import unittest
from pathlib import Path

HAS_FASTAPI = importlib.util.find_spec("fastapi") is not None

if HAS_FASTAPI:
    from app.judge_web import append_vote
    from app.judge_web import build_judge_items
    from app.judge_web import build_run_export_text
    from app.judge_web import build_run_summary
    from app.judge_web import create_judge_app
    from app.judge_web import JudgeService
    from fastapi.testclient import TestClient


@unittest.skipUnless(HAS_FASTAPI, "fastapi not installed")
class JudgeWebTests(unittest.TestCase):
    def test_build_judge_items_uses_only_committed_events_and_window_tail(self) -> None:
        with tempfile.TemporaryDirectory() as tmpdir:
            path = Path(tmpdir) / "judge.pc"
            path.write_text("p,preview\nc,one\np,ignored\nc,two\nc,three\n", encoding="utf-8")

            items = build_judge_items(path, window_chunks=2, max_items=3)

        self.assertEqual([item.committed_count for item in items], [1, 2, 3])
        self.assertEqual([item.source_window for item in items], ["one", "one\ntwo", "two\nthree"])

    def test_append_vote_writes_jsonl(self) -> None:
        with tempfile.TemporaryDirectory() as tmpdir:
            path = Path(tmpdir) / "results" / "votes.jsonl"
            append_vote(path, {"winner": "A", "naturalness": 4})
            lines = path.read_text(encoding="utf-8").splitlines()

        self.assertEqual(len(lines), 1)
        self.assertEqual(json.loads(lines[0]), {"winner": "A", "naturalness": 4})

    def test_build_run_summary_collapses_duplicate_rows_and_counts_variant_wins(self) -> None:
        with tempfile.TemporaryDirectory() as tmpdir:
            path = Path(tmpdir) / "results" / "votes.jsonl"
            append_vote(
                path,
                {
                    "item_index": 0,
                    "line_number": 17,
                    "winner": "tie",
                    "variant_a": "baseline",
                    "variant_b": "simple_nl",
                    "output_a": "same",
                    "output_b": "same",
                },
            )
            append_vote(
                path,
                {
                    "item_index": 1,
                    "line_number": 26,
                    "winner": "A",
                    "variant_a": "simple_nl",
                    "variant_b": "baseline",
                    "output_a": "natural wins first",
                    "output_b": "baseline loses first",
                },
            )
            append_vote(
                path,
                {
                    "item_index": 1,
                    "line_number": 26,
                    "winner": "B",
                    "variant_a": "simple_nl",
                    "variant_b": "baseline",
                    "output_a": "natural loses last",
                    "output_b": "baseline wins last",
                },
            )

            summary = build_run_summary(path)

        self.assertEqual(summary["rows_logged"], 3)
        self.assertEqual(summary["unique_items"], 2)
        self.assertEqual(summary["duplicate_rows"], 1)
        self.assertEqual(summary["duplicate_item_numbers"], [2])
        self.assertEqual(summary["variant_names"], ["baseline", "simple_nl"])
        self.assertEqual(summary["a_assignments"], {"baseline": [1], "simple_nl": [2]})
        self.assertEqual(summary["b_assignments"], {"simple_nl": [1], "baseline": [2]})
        self.assertEqual(summary["identical_item_numbers"], [1])
        self.assertEqual(summary["wins"], {"baseline": 1})
        self.assertEqual(summary["nonidentical_wins"], {"baseline": 1})
        self.assertEqual(summary["ties"], 1)
        self.assertEqual(summary["nonidentical_ties"], 0)

    def test_judge_service_uses_selected_comparison_prompt(self) -> None:
        with tempfile.TemporaryDirectory() as tmpdir:
            path = Path(tmpdir) / "judge.pc"
            path.write_text("c,one\nc,two\n", encoding="utf-8")
            service = JudgeService(
                path=path,
                window_chunks=1,
                max_items=2,
                results_path=Path(tmpdir) / "results.jsonl",
                comparison_prompt_name="superior_nl",
            )

        self.assertEqual(set(service.render_variants(0)), {"baseline", "superior_nl"})

    def test_judge_service_accepts_faithful_compact_prompt(self) -> None:
        with tempfile.TemporaryDirectory() as tmpdir:
            path = Path(tmpdir) / "judge.pc"
            path.write_text("c,one\n", encoding="utf-8")
            service = JudgeService(
                path=path,
                window_chunks=1,
                max_items=1,
                results_path=Path(tmpdir) / "results.jsonl",
                comparison_prompt_name="faithful_nl_compact",
            )

        self.assertEqual(set(service.render_variants(0)), {"baseline", "faithful_nl_compact"})

    def test_judge_service_accepts_spoken_prompt(self) -> None:
        with tempfile.TemporaryDirectory() as tmpdir:
            path = Path(tmpdir) / "judge.pc"
            path.write_text("c,one\n", encoding="utf-8")
            service = JudgeService(
                path=path,
                window_chunks=1,
                max_items=1,
                results_path=Path(tmpdir) / "results.jsonl",
                comparison_prompt_name="spoken_nl",
            )

        self.assertEqual(set(service.render_variants(0)), {"baseline", "spoken_nl"})

    def test_judge_service_accepts_syntactic_prompt(self) -> None:
        with tempfile.TemporaryDirectory() as tmpdir:
            path = Path(tmpdir) / "judge.pc"
            path.write_text("c,one\n", encoding="utf-8")
            service = JudgeService(
                path=path,
                window_chunks=1,
                max_items=1,
                results_path=Path(tmpdir) / "results.jsonl",
                comparison_prompt_name="syntactic_nl",
            )

        self.assertEqual(set(service.render_variants(0)), {"baseline", "syntactic_nl"})

    def test_build_run_export_text_lists_prompt_names_and_item_outputs(self) -> None:
        with tempfile.TemporaryDirectory() as tmpdir:
            path = Path(tmpdir) / "results" / "votes.jsonl"
            append_vote(
                path,
                {
                    "item_index": 0,
                    "line_number": 17,
                    "winner": "A",
                    "variant_a": "baseline",
                    "variant_b": "superior_nl",
                    "source_window": "source one",
                    "output_a": "baseline one",
                    "output_b": "superior one",
                },
            )
            append_vote(
                path,
                {
                    "item_index": 1,
                    "line_number": 26,
                    "winner": "B",
                    "variant_a": "superior_nl",
                    "variant_b": "baseline",
                    "source_window": "source two",
                    "output_a": "superior two",
                    "output_b": "baseline two",
                },
            )

            text = build_run_export_text(path)

        self.assertIn("prompt#1=baseline", text)
        self.assertIn("prompt#1_text=You are a translation engine. Translate the user's text into Dutch. Return only the translation.", text)
        self.assertIn("prompt#2=superior_nl", text)
        self.assertIn("prompt#2_text=You are a superior translator. Translate the text into easy to read syntactically correct Dutch. Return only the translation.", text)
        self.assertIn("item#=1", text)
        self.assertIn("item input:\nsource one", text)
        self.assertIn("item output prompt#1:\nbaseline one", text)
        self.assertIn("item output prompt#2:\nsuperior one", text)
        self.assertIn("item#=2", text)
        self.assertIn("item input:\nsource two", text)
        self.assertIn("item output prompt#1:\nbaseline two", text)
        self.assertIn("item output prompt#2:\nsuperior two", text)

    def test_summary_text_route_returns_downloadable_attachment(self) -> None:
        with tempfile.TemporaryDirectory() as tmpdir:
            path = Path(tmpdir) / "judge.pc"
            path.write_text("c,one\n", encoding="utf-8")
            results = Path(tmpdir) / "results" / "votes.jsonl"
            append_vote(
                results,
                {
                    "item_index": 0,
                    "line_number": 17,
                    "winner": "A",
                    "variant_a": "baseline",
                    "variant_b": "superior_nl",
                    "source_window": "source one",
                    "output_a": "baseline one",
                    "output_b": "superior one",
                },
            )
            app = create_judge_app(
                path=path,
                window_chunks=1,
                max_items=1,
                results_path=results,
                comparison_prompt_name="superior_nl",
            )

            client = TestClient(app)
            response = client.get("/summary.txt")

        self.assertEqual(response.status_code, 200)
        self.assertIn("attachment; filename=\"judge-summary.txt\"", response.headers["content-disposition"])
        self.assertIn("prompt#1=baseline", response.text)
        self.assertIn("prompt#1_text=You are a translation engine. Translate the user's text into Dutch. Return only the translation.", response.text)
        self.assertIn("item input:\nsource one", response.text)


if __name__ == "__main__":
    unittest.main()
