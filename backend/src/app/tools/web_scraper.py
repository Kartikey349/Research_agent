from bs4 import BeautifulSoup
import requests
from langchain_core.tools import tool

@tool
def web_scraper(url: str)-> str:
    """Fetch a webpage and extract its readable text content."""

    headers = {
        "User-Agent": "Mozilla/5.0 (compatible; ResearchBot/1.0)"
    }

    try:
        response = requests.get(
            url=url,
            headers=headers,
            timeout=(3, 7),
        )
        response.raise_for_status()

        soup = BeautifulSoup(response.text, "html.parser")

        for element in soup(
            ["script", "style", "nav", "footer", "header", "noscript"]
        ):
            element.decompose()

        title = soup.title.get_text(strip=True) if soup.title else "Untitled"
        text = soup.get_text(separator=" ", strip=True)

        text = soup.get_text(separator=" ", strip=True)[:2000]

        if not text:
            return f"No readable text found at {url}"


        return f"Title: {title}\nURL: {url}\n\nContent:\n{text}"

    except requests.RequestException as e:
        return f"Failed to scrape {url}: {e}"

