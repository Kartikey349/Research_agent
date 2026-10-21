import os
import sqlite3
from pathlib import Path
from typing import TypedDict, NotRequired

from langgraph.graph import StateGraph, START, END
from langgraph.types import interrupt
from langgraph.checkpoint.sqlite import SqliteSaver
from rich import print

from app.agents.analyst import analyst_agent
from app.agents.researcher import run_research
from app.agents.planner import planner_agent
from app.agents.writer import writer_agent


class AgentState(TypedDict):
    topic: str
    planning: NotRequired[str]
    research: NotRequired[str]
    analysis: NotRequired[str]
    report: NotRequired[str]
    feedback: NotRequired[str]
    approved: NotRequired[bool]
    revision_count: NotRequired[int]
    max_revisions: NotRequired[int]


def get_agent_output(agent, prompt: str) -> str:
    result = agent.invoke({
        "messages": [
            {"role": "user", "content": prompt}
        ]
    })
    return result["messages"][-1].content


def planner_node(state: AgentState):
    planning = get_agent_output(
        planner_agent,
        f"Create a research plan for this topic:\n{state['topic']}"
    )
    return {"planning": planning}


def researcher_node(state: AgentState):
    research = run_research(
        topic=state["topic"],
        planning=state["planning"],
    )
    return {"research": research}


def analyst_node(state: AgentState):
    analysis = get_agent_output(
        analyst_agent,
        f"""
Topic: {state['topic']}

Research findings:
{state['research']}

Analyze the evidence, key insights, contradictions,
and limitations. Preserve source URLs.
"""
    )
    return {"analysis": analysis}


def writer_node(state: AgentState):
    feedback = state.get("feedback", "")

    prompt = f"""
Write a structured research report on: {state['topic']}

Research analysis:
{state['analysis']}

Previous report, if any:
{state.get('report', 'No previous report.')}

Human feedback for this version:
{feedback or 'This is the initial version.'}

If feedback is provided, revise the report according to it.
Preserve source URLs and never invent facts or citations.
Use standard Markdown, not HTML tags.
"""

    report = get_agent_output(writer_agent, prompt)

    return {
        "report": report,
        "approved": False,
        "revision_count": state.get("revision_count", 0),
    }


def review_node(state: AgentState):
    decision = interrupt({
        "report": state["report"],
        "revision_count": state.get("revision_count", 0),
        "max_revisions": state.get("max_revisions", 3),
        "message": "Review the report. Approve it or request changes.",
    })

    approved = decision["approved"]
    count = state.get("revision_count", 0)

    return {
        "approved": approved,
        "feedback": decision.get("feedback", ""),
        "revision_count": count + (0 if approved else 1),
    }


def route_after_review(state: AgentState):
    if state.get("approved", False):
        return "end"

    if state.get("revision_count", 0) >= state.get(
        "max_revisions", 3
    ):
        return "end"

    return "writer"



DB_PATH = Path(
    os.getenv(
        "CHECKPOINT_DB_PATH",
        str(Path(__file__).resolve().parents[2] / "checkpoints.db"),
    )
)

conn = sqlite3.connect(
    str(DB_PATH),
    check_same_thread=False,
)
checkpointer = SqliteSaver(conn)
checkpointer.setup()


builder = StateGraph(AgentState)

builder.add_node("planner", planner_node)
builder.add_node("researcher", researcher_node)
builder.add_node("analyst", analyst_node)
builder.add_node("writer", writer_node)
builder.add_node("review", review_node)

builder.add_edge(START, "planner")
builder.add_edge("planner", "researcher")
builder.add_edge("researcher", "analyst")
builder.add_edge("analyst", "writer")
builder.add_edge("writer", "review")

builder.add_conditional_edges(
    "review",
    route_after_review,
    {
        "end": END,
        "writer": "writer",
    },
)

report_graph = builder.compile(
    checkpointer=checkpointer
)

def close_database():
    conn.close()
