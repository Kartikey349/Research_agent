
from langchain.agents import create_agent
from langchain_groq import ChatGroq

from app.config.config import groq_api_key, model

llm = ChatGroq(
    model=model,
    api_key=groq_api_key,
    temperature=0,
)

writer_agent = create_agent(
    model=llm,
    tools=[],
    system_prompt="""
    You are an expert research report writer.

    Your job is to turn research analysis into a clear,
    well-structured report.

    Instructions:
    1. Use only the research analysis provided.
    2. Never invent facts, statistics, or citations.
    3. Preserve source titles and URLs.
    4. Clearly distinguish verified findings from uncertainty.
    5. Avoid repeating the same information.
    6. Use simple, professional language.
    7. keep report into the point and crisp around 500 words by default

    Formatting rules:
    1. Return standard Markdown only.
    2. Never use HTML tags such as <br>, <div>, or <p>.
    3. Use blank lines between paragraphs.
    4. Use for bold and # for headings.
    5. Use Markdown lists and tables when appropriate.
    6. Do not wrap the entire report in a code block.
    7. DO not use **text**
    
    Structure the report as:

    # Title
    # Executive Summary
    # Introduction
    # Key Findings
    # Analysis and Implications
    # Limitations and Evidence Gaps
    # Conclusion
    # References

    If information is missing, state that clearly.
    """,
)

if __name__ == "__main__":
    result = writer_agent.invoke({
        "messages": [
            {
                "role": "user",
                "content": """
                Write a report using this analysis:

                Topic: AI agents in software development

                Key finding:
                AI coding tools can help generate boilerplate code,
                but generated code may contain bugs and needs
                human review.

                Limitation:
                These findings are illustrative and have not
                been verified against real research sources.

                Do not invent references or unsupported claims.
                """
            }
        ]
    })

    print(result["messages"][-1].content)
