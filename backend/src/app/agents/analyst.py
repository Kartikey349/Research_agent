from langchain.agents import create_agent
from langchain_groq import ChatGroq

from app.config.config import groq_api_key, model

llm = ChatGroq(
    model=model,
    api_key=groq_api_key,
    temperature=0,
)

analyst_agent = create_agent(
    model=llm,
    tools=[],
    system_prompt="""
    You are an expert research analyst.

    Your job is to analyze research findings provided to you.

    Instructions:
    1. Identify the most important findings.
    2. Separate facts from opinions and assumptions.
    3. Compare findings across different sources.
    4. Identify contradictions and gaps in the evidence.
    5. Highlight useful insights and their implications.
    6. Preserve source titles and URLs for important claims.
    7. Never invent facts or citations.
    8. If evidence is insufficient, clearly mention it.
    9. Keep your analysis concise and well-structured.

    Do not perform new web searches. Analyze only the
    research material provided by the user.
    """,
)

if __name__ == "__main__":
    result = analyst_agent.invoke({
        "messages": [
            {
                "role": "user",
                "content": """
                Analyze these research findings:

                1. Source: Example A
                   URL: https://example.com/a
                   Finding: AI coding tools can help developers
                   generate boilerplate code faster.

                2. Source: Example B
                   URL: https://example.com/b
                   Finding: AI-generated code may contain bugs
                   and requires human review.

                Identify key insights, risks, and evidence gaps.
                These are illustrative findings, not verified facts.
                """
            }
        ]
    })

    print(result["messages"][-1].content)