import os
import sys
import unittest
from pathlib import Path
from types import SimpleNamespace

os.environ.setdefault("GROQ_API_KEY", "test-groq-key")
os.environ.setdefault("TAVILY_API_KEY", "test-tavily-key")
os.environ.setdefault("MODEL", "llama-3.1-8b-instant")

sys.path.insert(
    0,
    str(Path(__file__).resolve().parents[1] / "src"),
)

from fastapi.testclient import TestClient
from langgraph.checkpoint.memory import InMemorySaver
from langgraph.graph import StateGraph, START, END

import app.graph as graph_module
import app.main as main


class StubAgent:
    """Deterministic stand-in for a LangChain agent."""

    def __init__(self, name: str) -> None:
        self.name = name
        self.prompts: list[str] = []
        self.calls = 0

    def invoke(self, payload: dict) -> dict:
        self.calls += 1
        self.prompts.append(payload["messages"][-1]["content"])
        return {
            "messages": [
                SimpleNamespace(content=f"{self.name}-{self.calls}")
            ]
        }


def build_stub_graph():
    builder = StateGraph(graph_module.AgentState)

    builder.add_node("planner", graph_module.planner_node)
    builder.add_node("researcher", graph_module.researcher_node)
    builder.add_node("analyst", graph_module.analyst_node)
    builder.add_node("writer", graph_module.writer_node)
    builder.add_node("review", graph_module.review_node)

    builder.add_edge(START, "planner")
    builder.add_edge("planner", "researcher")
    builder.add_edge("researcher", "analyst")
    builder.add_edge("analyst", "writer")
    builder.add_edge("writer", "review")

    builder.add_conditional_edges(
        "review",
        graph_module.route_after_review,
        {"end": END, "writer": "writer"},
    )

    return builder


class ReviewWorkflowTests(unittest.TestCase):
    def setUp(self) -> None:
        self.planner = StubAgent("PLAN")
        self.analyst = StubAgent("ANALYSIS")
        self.writer = StubAgent("REPORT")

        graph_module.planner_agent = self.planner
        graph_module.analyst_agent = self.analyst
        graph_module.writer_agent = self.writer
        graph_module.run_research = (
            lambda topic, planning: "RESEARCH"
        )

        self.graph = build_stub_graph().compile(
            checkpointer=InMemorySaver()
        )

        main.report_graph = self.graph
        self.client = TestClient(
            main.app,
            raise_server_exceptions=False,
        )

    def start(self) -> dict:
        response = self.client.post(
            "/research",
            json={"topic": "Testing review flow"},
        )
        self.assertEqual(response.status_code, 200)
        return response.json()

    def review(
        self,
        thread_id: str,
        approved: bool,
        feedback: str = "",
    ) -> dict:
        response = self.client.post(
            "/research/review",
            json={
                "thread_id": thread_id,
                "approved": approved,
                "feedback": feedback,
            },
        )
        return response

    def test_rejection_feedback_reaches_writer(self) -> None:
        started = self.start()

        response = self.review(
            started["thread_id"],
            approved=False,
            feedback="Add primary sources and dates",
        )

        self.assertEqual(response.status_code, 200)
        self.assertTrue(
            any(
                "Add primary sources and dates" in prompt
                for prompt in self.writer.prompts
            ),
            "writer prompt did not include the rejection feedback",
        )

    def test_rejected_report_routes_back_to_writer(self) -> None:
        started = self.start()
        first_report = started["report"]
        self.assertEqual(self.writer.calls, 1)

        response = self.review(
            started["thread_id"],
            approved=False,
            feedback="Expand the limitations section",
        )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(self.writer.calls, 2)
        self.assertIn(first_report, self.writer.prompts[1])

    def test_revised_report_and_revision_count_returned(self) -> None:
        started = self.start()
        first_report = started["report"]

        body = self.review(
            started["thread_id"],
            approved=False,
            feedback="Tighten the executive summary",
        ).json()

        self.assertEqual(body["status"], "awaiting_review")
        self.assertEqual(body["revision_count"], 1)
        self.assertNotEqual(body["report"], first_report)
        self.assertEqual(body["report"], f"REPORT-{self.writer.calls}")
        self.assertFalse(body["approved"])

    def test_multiple_rejections_increment_revision_count(self) -> None:
        started = self.start()
        thread_id = started["thread_id"]
        initial_report = started["report"]

        first = self.review(
            thread_id,
            approved=False,
            feedback="First round of changes",
        ).json()
        self.assertEqual(first["revision_count"], 1)
        self.assertEqual(first["report"], f"REPORT-{self.writer.calls}")
        self.assertNotEqual(first["report"], initial_report)

        second = self.review(
            thread_id,
            approved=False,
            feedback="Second round of changes",
        ).json()
        self.assertEqual(second["revision_count"], 2)
        self.assertEqual(self.writer.calls, 3)
        self.assertEqual(second["report"], f"REPORT-{self.writer.calls}")
        self.assertNotEqual(second["report"], first["report"])

        latest = self.client.get(f"/research/{thread_id}").json()
        self.assertEqual(latest["report"], second["report"])
        self.assertEqual(latest["revision_count"], 2)

    def test_approval_completes_workflow(self) -> None:
        started = self.start()

        body = self.review(
            started["thread_id"],
            approved=True,
        ).json()

        self.assertEqual(body["status"], "approved")
        self.assertTrue(body["approved"])
        self.assertEqual(body["revision_count"], 0)

    def test_blank_rejection_feedback_is_rejected(self) -> None:
        started = self.start()

        response = self.review(
            started["thread_id"],
            approved=False,
            feedback="   ",
        )

        self.assertEqual(response.status_code, 422)
        self.assertEqual(self.writer.calls, 1)


if __name__ == "__main__":
    unittest.main()
