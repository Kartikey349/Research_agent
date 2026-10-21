from tavily import TavilyClient
from langchain_core.tools import tool

from app.config.config import tavily_api_key

client = TavilyClient(api_key=tavily_api_key)


@tool
def tavily_search(query: str) -> str:
    """Search the web and return concise results with titles and URLs."""

    response = client.search(query=query, max_results=2)
    results = response.get("results", [])

    if not results:
        return f"No search results found for: {query}"

    formatted_results = []

    for result in results:
        formatted_results.append(
            f"Title: {result.get('title', 'Untitled')}\n"
            f"URL: {result.get('url', 'No URL')}\n"
            f"Content: {result.get('content', '')[:400]}"
        )

    return "\n\n".join(formatted_results)