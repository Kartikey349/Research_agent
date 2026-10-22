export interface ResearchResponse {
  thread_id: string;
  topic: string;
  status: string;
  report: string;
  message?: string;
  approved?: boolean;
  revision_count?: number;
}

export interface ResearchStatusResponse {
  thread_id: string;
  topic: string;
  status: string;
  report: string;
  approved: boolean;
  revision_count: number;
}

export interface ResearchReportResponse {
  thread_id: string;
  topic: string;
  report: string;
  approved: boolean;
}

const DEFAULT_API_BASE_URL = "http://localhost:8000";

function normalizeBaseUrl(value: string | undefined): string {
  const baseUrl = value?.trim() || DEFAULT_API_BASE_URL;
  return baseUrl.replace(/\/+$/, "");
}

const API_BASE_URL = normalizeBaseUrl(
  process.env.NEXT_PUBLIC_API_URL,
);

function apiUrl(path: string): string {
  return `${API_BASE_URL}${path.startsWith("/") ? path : `/${path}`}`;
}

export class ApiError extends Error {
  status: number | null;

  constructor(message: string, status: number | null = null) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

function statusMessage(status: number): string {
  if (status === 429) {
    return "The AI provider quota has been exceeded. Please try again after the quota resets.";
  }

  if (status === 502 || status === 503) {
    return "The research service or an upstream provider is temporarily unavailable. Please try again later.";
  }

  return `The API returned an error (status ${status}).`;
}

function extractDetail(body: unknown): string | null {
  if (!body || typeof body !== "object") {
    return null;
  }

  const detail = (body as { detail?: unknown }).detail;

  if (typeof detail === "string") {
    return detail;
  }

  if (Array.isArray(detail)) {
    const messages = detail
      .map((item) => {
        if (
          item &&
          typeof item === "object" &&
          "msg" in item &&
          typeof item.msg === "string"
        ) {
          return item.msg;
        }

        return null;
      })
      .filter((message): message is string => Boolean(message));

    if (messages.length > 0) {
      return messages.join(" ");
    }
  }

  return null;
}

async function request<T>(
  path: string,
  init?: RequestInit,
): Promise<T> {
  let response: Response;

  try {
    response = await fetch(apiUrl(path), {
      ...init,
      headers: {
        "Content-Type": "application/json",
        ...(init?.headers ?? {}),
      },
      cache: "no-store",
    });
  } catch {
    throw new ApiError(
      `Could not connect to the research API at ${API_BASE_URL}. Make sure the backend is running.`,
    );
  }

  const text = await response.text();
  let data: unknown = null;

  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = null;
    }
  }

  if (!response.ok) {
    throw new ApiError(
      extractDetail(data) ?? statusMessage(response.status),
      response.status,
    );
  }

  if (data === null) {
    throw new ApiError(
      "The API returned an empty or invalid response. Please try again.",
    );
  }

  return data as T;
}

export function checkHealth(): Promise<{ status: string }> {
  return request<{ status: string }>("/health");
}

export function startResearch(topic: string): Promise<ResearchResponse> {
  return request<ResearchResponse>("/research", {
    method: "POST",
    body: JSON.stringify({ topic }),
  });
}

export function submitReview(
  threadId: string,
  approved: boolean,
  feedback: string,
): Promise<ResearchResponse> {
  return request<ResearchResponse>("/research/review", {
    method: "POST",
    body: JSON.stringify({
      thread_id: threadId,
      approved,
      feedback,
    }),
  });
}

export function getResearchStatus(
  threadId: string,
): Promise<ResearchStatusResponse> {
  return request<ResearchStatusResponse>(
    `/research/${encodeURIComponent(threadId)}`,
  );
}

export function getResearchReport(
  threadId: string,
): Promise<ResearchReportResponse> {
  return request<ResearchReportResponse>(
    `/research/${encodeURIComponent(threadId)}/report`,
  );
}
