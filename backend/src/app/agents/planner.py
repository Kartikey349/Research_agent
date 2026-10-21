from langchain.agents import create_agent
from langchain_groq import ChatGroq

from app.config.config import groq_api_key, model

llm = ChatGroq(
    model=model,
    api_key=groq_api_key,
    temperature=0,
)


planner_agent = create_agent(
    model=llm,
    tools=[],
    system_prompt="""
    You are an expert research planning agent.

    Your job is to convert a user's topic into a clear research plan.

    Instructions:
    1. Identify the main research objective.
    2. Generate 3-5 focused research questions.
    3. Identify important aspects, comparisons, and evidence needed.
    4. Suggest useful search queries for the researcher agent.
    5. Do not answer the research questions yourself.
    6. Keep the plan concise and actionable.
    """,
)


if __name__ == "__main__":
    result = planner_agent.invoke({
        "messages": [
            {
                "role": "user",
                "content": (
                    "Create a research plan about the impact "
                    "of AI agents on software development."
                ),
            }
        ]
    })

    print(result["messages"][-1].content)