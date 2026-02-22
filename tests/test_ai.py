"""Unit tests for AI wrapper classes in budget/ai.py.

All tests mock client.messages.create so no real Anthropic API calls are made.
"""

from unittest.mock import MagicMock

import pytest

from budget.ai import (
    SAMPLE_ROWS,
    ColumnDetector,
    MerchantDuplicateFinder,
    QueryParser,
    TransactionEnricher,
)

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _tool_use_block(name: str, input_data: dict) -> MagicMock:
    block = MagicMock()
    block.type = "tool_use"
    block.name = name
    block.input = input_data
    block.id = "tu_123"
    return block


def _response(content: list, stop_reason: str = "tool_use") -> MagicMock:
    resp = MagicMock()
    resp.content = content
    resp.stop_reason = stop_reason
    return resp


# ---------------------------------------------------------------------------
# ColumnDetector
# ---------------------------------------------------------------------------


class TestColumnDetector:
    def test_build_csv_sample_header_and_rows(self):
        detector = ColumnDetector.__new__(ColumnDetector)
        fieldnames = ["Date", "Description", "Amount"]
        rows = [
            {
                "Date": f"2024-01-{i:02d}",
                "Description": f"Tx {i}",
                "Amount": str(-i * 10),
            }
            for i in range(1, 10)
        ]
        sample = detector._build_csv_sample(fieldnames, rows)
        lines = sample.strip().splitlines()
        # header + up to SAMPLE_ROWS data rows
        assert lines[0] == "Date,Description,Amount"
        assert len(lines) == 1 + min(SAMPLE_ROWS, len(rows))

    def test_detect_returns_mapping(self, mocker):
        detector = ColumnDetector.__new__(ColumnDetector)
        detector.client = MagicMock()
        mapping = {"description": 1, "date": 0, "amount": 2}
        detector.client.messages.create.return_value = _response(
            [_tool_use_block("map_columns", mapping)]
        )
        fieldnames = ["Date", "Description", "Amount"]
        rows = [{"Date": "2024-01-01", "Description": "Coffee", "Amount": "-5.00"}]
        result = detector.detect(fieldnames, rows)
        assert result == {"description": 1, "date": 0, "amount": 2}

    def test_detect_with_null_columns(self, mocker):
        detector = ColumnDetector.__new__(ColumnDetector)
        detector.client = MagicMock()
        mapping = {"description": None, "date": None, "amount": None}
        detector.client.messages.create.return_value = _response(
            [_tool_use_block("map_columns", mapping)]
        )
        result = detector.detect(["Col1"], [{"Col1": "x"}])
        assert result == {"description": None, "date": None, "amount": None}

    def test_build_csv_sample_fewer_than_sample_rows(self):
        detector = ColumnDetector.__new__(ColumnDetector)
        fieldnames = ["Date", "Amount"]
        rows = [
            {"Date": "2024-01-01", "Amount": "-5.00"},
            {"Date": "2024-01-02", "Amount": "-10.00"},
        ]
        sample = detector._build_csv_sample(fieldnames, rows)
        lines = sample.strip().splitlines()
        # 2 data rows (fewer than SAMPLE_ROWS=5) plus header
        assert len(lines) == 3

    def test_build_csv_sample_exactly_sample_rows(self):
        detector = ColumnDetector.__new__(ColumnDetector)
        fieldnames = ["Date", "Amount"]
        rows = [
            {"Date": f"2024-01-{i:02d}", "Amount": f"-{i}.00"}
            for i in range(1, SAMPLE_ROWS + 1)
        ]
        sample = detector._build_csv_sample(fieldnames, rows)
        lines = sample.strip().splitlines()
        assert len(lines) == SAMPLE_ROWS + 1  # header + exactly SAMPLE_ROWS data rows


# ---------------------------------------------------------------------------
# TransactionEnricher
# ---------------------------------------------------------------------------


class TestTransactionEnricher:
    def _make_enricher(self):
        e = TransactionEnricher.__new__(TransactionEnricher)
        e.client = MagicMock()
        return e

    def test_enrich_batch_success(self):
        enricher = self._make_enricher()
        results = [
            {
                "index": 0,
                "merchant_name": "Starbucks",
                "merchant_location": "Seattle, WA",
                "is_recurring": False,
                "description": "Starbucks Coffee",
                "category": "Food & Drink",
                "subcategory": "Coffee & Tea",
            }
        ]
        enricher.client.messages.create.return_value = _response(
            [_tool_use_block("enrich_transactions", {"results": results})]
        )
        batch = [
            {
                "index": 0,
                "description": "STARBUCKS #4821 SEATTLE WA",
                "amount": "-5.00",
                "date": "2024-01-15",
            }
        ]
        out = enricher._enrich_batch(batch, 0)
        assert len(out) == 1
        assert out[0]["merchant_name"] == "Starbucks"
        assert out[0]["is_recurring"] is False

    def test_enrich_batch_tool_loop(self):
        """When first response has a non-enrich_transactions tool, loop continues."""
        enricher = self._make_enricher()

        other_block = MagicMock()
        other_block.type = "tool_use"
        other_block.name = "web_search"
        other_block.id = "tu_other"
        other_block.input = {"query": "something"}

        results = [
            {
                "index": 0,
                "merchant_name": "Netflix",
                "merchant_location": None,
                "is_recurring": True,
                "description": "Netflix Subscription",
                "category": "Entertainment",
                "subcategory": "Streaming",
            }
        ]
        first_resp = _response([other_block], stop_reason="tool_use")
        second_resp = _response(
            [_tool_use_block("enrich_transactions", {"results": results})]
        )

        enricher.client.messages.create.side_effect = [first_resp, second_resp]

        batch = [
            {
                "index": 0,
                "description": "NETFLIX.COM",
                "amount": "-15.99",
                "date": "2024-01-01",
            }
        ]
        out = enricher._enrich_batch(batch, 0)
        assert out[0]["merchant_name"] == "Netflix"
        assert out[0]["is_recurring"] is True
        assert enricher.client.messages.create.call_count == 2

    def test_enrich_batch_bad_stop_reason_raises(self):
        enricher = self._make_enricher()
        # stop_reason is end_turn and no enrich_transactions block
        non_tool = MagicMock()
        non_tool.type = "text"
        enricher.client.messages.create.return_value = _response(
            [non_tool], stop_reason="end_turn"
        )
        batch = [
            {
                "index": 0,
                "description": "RANDOM",
                "amount": "-1.00",
                "date": "2024-01-01",
            }
        ]
        with pytest.raises(RuntimeError, match="did not call enrich_transactions"):
            enricher._enrich_batch(batch, 0)

    def test_enrich_batch_multiple_results(self):
        enricher = self._make_enricher()
        results = [
            {
                "index": 0,
                "merchant_name": "Starbucks",
                "merchant_location": None,
                "is_recurring": False,
                "description": "Starbucks Coffee",
                "category": "Food & Drink",
                "subcategory": "Coffee & Tea",
            },
            {
                "index": 1,
                "merchant_name": "Netflix",
                "merchant_location": None,
                "is_recurring": True,
                "description": "Netflix Subscription",
                "category": "Entertainment",
                "subcategory": "Streaming",
            },
        ]
        enricher.client.messages.create.return_value = _response(
            [_tool_use_block("enrich_transactions", {"results": results})]
        )
        batch = [
            {
                "index": 0,
                "description": "STARBUCKS #4821",
                "amount": "-5.00",
                "date": "2024-01-15",
            },
            {
                "index": 1,
                "description": "NETFLIX.COM",
                "amount": "-15.99",
                "date": "2024-01-01",
            },
        ]
        out = enricher._enrich_batch(batch, 0)
        assert len(out) == 2
        assert out[0]["merchant_name"] == "Starbucks"
        assert out[0]["is_recurring"] is False
        assert out[1]["merchant_name"] == "Netflix"
        assert out[1]["is_recurring"] is True


# ---------------------------------------------------------------------------
# QueryParser
# ---------------------------------------------------------------------------


class TestQueryParser:
    def test_parse_returns_dict(self):
        qp = QueryParser.__new__(QueryParser)
        qp.client = MagicMock()
        tool_input = {
            "date_from": "2024-01-01",
            "date_to": "2024-01-31",
            "merchant": None,
            "description": None,
            "category": None,
            "subcategory": None,
            "account": None,
            "amount_min": None,
            "amount_max": None,
            "is_recurring": None,
            "explanation": "Transactions in January 2024",
        }
        qp.client.messages.create.return_value = _response(
            [_tool_use_block("set_filters", tool_input)]
        )
        result = qp.parse("transactions in January 2024", "(no categories)")
        assert result["explanation"] == "Transactions in January 2024"
        assert result["date_from"] == "2024-01-01"

    def test_parse_passes_query_to_api(self):
        qp = QueryParser.__new__(QueryParser)
        qp.client = MagicMock()
        tool_input = {
            "merchant": "Starbucks",
            "explanation": "Transactions from Starbucks",
        }
        qp.client.messages.create.return_value = _response(
            [_tool_use_block("set_filters", tool_input)]
        )
        result = qp.parse("starbucks purchases", "Food & Drink: Restaurants")
        call_kwargs = qp.client.messages.create.call_args.kwargs
        assert call_kwargs["messages"][0]["content"] == "starbucks purchases"
        assert "Food & Drink" in call_kwargs["system"]
        assert result["merchant"] == "Starbucks"


# ---------------------------------------------------------------------------
# MerchantDuplicateFinder
# ---------------------------------------------------------------------------


class TestMerchantDuplicateFinder:
    def test_find_returns_groups(self):
        finder = MerchantDuplicateFinder.__new__(MerchantDuplicateFinder)
        finder.client = MagicMock()
        tool_input = {
            "groups": [
                {
                    "canonical_name": "Amazon",
                    "canonical_location": None,
                    "member_ids": [1, 2, 3],
                }
            ]
        }
        finder.client.messages.create.return_value = _response(
            [_tool_use_block("report_duplicate_groups", tool_input)]
        )
        result = finder.find(
            "ID 1 | AMZN | location: none | 5 transactions\nID 2 | AMAZON.COM | location: none | 3 transactions"
        )
        assert len(result["groups"]) == 1
        assert result["groups"][0]["canonical_name"] == "Amazon"
        assert result["groups"][0]["member_ids"] == [1, 2, 3]

    def test_find_empty_groups(self):
        finder = MerchantDuplicateFinder.__new__(MerchantDuplicateFinder)
        finder.client = MagicMock()
        finder.client.messages.create.return_value = _response(
            [_tool_use_block("report_duplicate_groups", {"groups": []})]
        )
        result = finder.find("ID 1 | Amazon | location: none | 10 transactions")
        assert result["groups"] == []

    def test_find_passes_text_to_api(self):
        finder = MerchantDuplicateFinder.__new__(MerchantDuplicateFinder)
        finder.client = MagicMock()
        finder.client.messages.create.return_value = _response(
            [_tool_use_block("report_duplicate_groups", {"groups": []})]
        )
        merchants_text = "ID 1 | AMZN | location: none | 5 transactions"
        finder.find(merchants_text)
        call_kwargs = finder.client.messages.create.call_args.kwargs
        assert call_kwargs["messages"][0]["content"] == merchants_text
