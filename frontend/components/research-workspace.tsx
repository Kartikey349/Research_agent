"use client";

import { type FormEvent, useEffect, useRef, useState } from "react";

import ReportMarkdown from "@/components/report-markdown";
import {
  ApiError,
  getResearchStatus,
  type ResearchResponse,
  type ResearchStatusResponse,
  startResearch,
  submitReview,
} from "@/lib/api";

interface ResearchView {
  threadId: string;
  topic: string;
  status: string;
  report: string;
  approved: boolean;
  revisionCount: number | null;
  message?: string;
}

type BusyState =
  | "starting"
  | "loading"
  | "refreshing"
  | "reviewing"
  | null;

const primaryButton =
  "inline-flex items-center justify-center gap-2 rounded-md bg-emerald-700 px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-emerald-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-700 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50";

const secondaryButton =
  "inline-flex items-center justify-center gap-2 rounded-md border border-stone-300 bg-white px-4 py-2.5 text-sm font-medium text-stone-700 transition-colors hover:bg-stone-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-700 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50";

const quietButton =
  "inline-flex items-center justify-center rounded-md px-2.5 py-1.5 text-xs font-medium text-stone-500 transition-colors hover:bg-stone-100 hover:text-stone-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-700 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50";

const statusStyles: Record<string, string> = {
  awaiting_review:
    "border-amber-200 bg-amber-50 text-amber-800",
  approved:
    "border-emerald-200 bg-emerald-50 text-emerald-800",
  completed: "border-stone-200 bg-stone-100 text-stone-700",
  in_progress: "border-sky-200 bg-sky-50 text-sky-800",
};

const statusLabels: Record<string, string> = {
  awaiting_review: "Awaiting review",
  approved: "Approved",
  completed: "Completed",
  in_progress: "In progress",
};

function mapResponse(
  response: ResearchResponse,
  revisionCount: number | null,
): ResearchView {
  return {
    threadId: response.thread_id,
    topic: response.topic,
    status: response.status,
    report: response.report ?? "",
    approved: Boolean(response.approved),
    revisionCount: response.revision_count ?? revisionCount,
    message: response.message,
  };
}

function mapStatus(response: ResearchStatusResponse): ResearchView {
  return {
    threadId: response.thread_id,
    topic: response.topic,
    status: response.status,
    report: response.report ?? "",
    approved: Boolean(response.approved),
    revisionCount: response.revision_count,
  };
}

function mergeStatus(
  current: ResearchView,
  response: ResearchStatusResponse,
): ResearchView {
  // A status request that started before a review can resolve after the
  // review response. Never let that older snapshot replace the newer
  // revised report.
  const isOlderRevision =
    current.revisionCount !== null &&
    response.revision_count < current.revisionCount;

  if (isOlderRevision) {
    return current;
  }

  return {
    ...current,
    topic: response.topic || current.topic,
    status: response.status,
    report: response.report || current.report,
    approved: Boolean(response.approved),
    revisionCount: response.revision_count,
  };
}

function getErrorMessage(error: unknown): string {
  if (error instanceof ApiError) {
    return error.message;
  }

  return "Something went wrong. Please try again.";
}

function Spinner() {
  return (
    <span
      className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-stone-300 border-t-stone-700"
      aria-hidden="true"
    />
  );
}

function StatusBadge({ status }: { status: string }) {
  const style =
    statusStyles[status] ??
    "border-stone-200 bg-stone-100 text-stone-700";
  const label =
    statusLabels[status] ?? status.replaceAll("_", " ");

  return (
    <span
      className={`inline-flex items-center rounded-full border px-2.5 py-1 text-xs font-medium capitalize ${style}`}
    >
      {label}
    </span>
  );
}

export default function ResearchWorkspace() {
  const [topic, setTopic] = useState("");
  const [topicError, setTopicError] = useState<string | null>(null);
  const [lookupId, setLookupId] = useState("");
  const [lookupError, setLookupError] = useState<string | null>(null);
  const [research, setResearch] = useState<ResearchView | null>(
    null,
  );
  const [feedback, setFeedback] = useState("");
  const [feedbackError, setFeedbackError] = useState<
    string | null
  >(null);
  const [showFeedback, setShowFeedback] = useState(false);
  const [busy, setBusy] = useState<BusyState>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const isBusy = busy !== null;
  const isAwaitingReview =
    research?.status === "awaiting_review";

  const activeThreadId = research?.threadId ?? null;
  const activeStatus = research?.status ?? null;
  const pollInFlight = useRef(false);

  useEffect(() => {
    if (!activeThreadId || activeStatus !== "in_progress") {
      return;
    }

    const threadId = activeThreadId;
    let cancelled = false;

    async function poll() {
      if (pollInFlight.current) {
        return;
      }

      pollInFlight.current = true;

      try {
        const status = await getResearchStatus(threadId);

        if (cancelled) {
          return;
        }

        setResearch((current) =>
          current ? mergeStatus(current, status) : mapStatus(status),
        );
      } catch {
        // Keep the last known state. A later poll or manual
        // refresh can recover without clobbering the report.
      } finally {
        pollInFlight.current = false;
      }
    }

    const interval = window.setInterval(poll, 3000);

    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, [activeThreadId, activeStatus]);

  async function handleStart(
    event: FormEvent<HTMLFormElement>,
  ) {
    event.preventDefault();
    const trimmedTopic = topic.trim();

    if (trimmedTopic.length < 3) {
      setTopicError(
        "Enter a topic with at least 3 characters.",
      );
      return;
    }

    if (trimmedTopic.length > 200) {
      setTopicError("Keep the topic under 200 characters.");
      return;
    }

    setTopicError(null);
    setLookupError(null);
    setError(null);
    setFeedback("");
    setFeedbackError(null);
    setShowFeedback(false);
    setCopied(false);
    setBusy("starting");

    try {
      const response = await startResearch(trimmedTopic);
      setResearch(mapResponse(response, 0));
      setLookupId(response.thread_id);
    } catch (requestError) {
      setError(getErrorMessage(requestError));
    } finally {
      setBusy(null);
    }
  }

  async function handleLoad(
    event: FormEvent<HTMLFormElement>,
  ) {
    event.preventDefault();
    const threadId = lookupId.trim();

    if (!threadId) {
      setLookupError(
        "Enter a thread ID to open a saved workflow.",
      );
      return;
    }

    setLookupError(null);
    setError(null);
    setFeedback("");
    setFeedbackError(null);
    setShowFeedback(false);
    setCopied(false);
    setBusy("loading");

    try {
      const status = await getResearchStatus(threadId);
      setResearch(mapStatus(status));
      setLookupId(status.thread_id);
    } catch (requestError) {
      setError(getErrorMessage(requestError));
    } finally {
      setBusy(null);
    }
  }

  async function handleRefresh() {
    if (!research) {
      return;
    }

    setError(null);
    setBusy("refreshing");

    try {
      const status = await getResearchStatus(
        research.threadId,
      );
      setResearch((current) =>
        current ? mergeStatus(current, status) : mapStatus(status),
      );
    } catch (requestError) {
      setError(getErrorMessage(requestError));
    } finally {
      setBusy(null);
    }
  }

  async function handleReview(approved: boolean) {
    if (!research || isBusy) {
      return;
    }

    const submittedFeedback = approved ? "" : feedback.trim();

    if (!approved && !submittedFeedback) {
      setFeedbackError(
        "Describe the changes you want before requesting a revision.",
      );
      return;
    }

    setError(null);
    setFeedbackError(null);
    setBusy("reviewing");

    try {
      const response = await submitReview(
        research.threadId,
        approved,
        submittedFeedback,
      );

      // The synchronous review response is the source of truth:
      // it carries the revised report, status, and revision count.
      setResearch(mapResponse(response, null));
      setFeedback("");
      setShowFeedback(false);
    } catch (requestError) {
      // Keep the feedback so the user can retry without retyping.
      setError(getErrorMessage(requestError));
    } finally {
      setBusy(null);
    }
  }

  async function handleCopy() {
    if (!research?.report.trim()) {
      return;
    }

    try {
      await navigator.clipboard.writeText(research.report);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      setError(
        "Could not copy the report to the clipboard. Your browser may require a secure connection.",
      );
    }
  }

  return (
    <div className="space-y-6">
      {error && (
        <div
          className="flex items-start justify-between gap-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800"
          role="alert"
        >
          <p>{error}</p>
          <button
            type="button"
            className="shrink-0 text-xs font-medium underline underline-offset-2 hover:text-red-900"
            onClick={() => setError(null)}
          >
            Dismiss
          </button>
        </div>
      )}

      <section className="rounded-xl border border-stone-200 bg-white p-5 shadow-sm sm:p-6">
        <form onSubmit={handleStart} noValidate>
          <label
            htmlFor="topic"
            className="block text-sm font-medium text-stone-800"
          >
            Research topic
          </label>
          <p
            id="topic-help"
            className="mt-1 text-xs text-stone-500"
          >
            Describe the question or subject you want researched.
          </p>
          <textarea
            id="topic"
            name="topic"
            rows={3}
            maxLength={200}
            value={topic}
            onChange={(event) => {
              setTopic(event.target.value);

              if (topicError) {
                setTopicError(null);
              }
            }}
            disabled={isBusy}
            aria-invalid={Boolean(topicError)}
            aria-describedby={
              topicError ? "topic-help topic-error" : "topic-help"
            }
            placeholder="e.g. The impact of AI agents on software development"
            className="mt-3 w-full resize-y rounded-lg border border-stone-300 bg-white px-3 py-2.5 text-sm leading-6 text-stone-900 placeholder:text-stone-400 focus:border-emerald-700 focus:outline-none focus:ring-2 focus:ring-emerald-700/15 disabled:bg-stone-50"
          />
          <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
            <p className="text-xs text-stone-400">
              {topic.length}/200 characters
            </p>
            {topicError && (
              <p
                id="topic-error"
                className="text-xs font-medium text-red-700"
                role="alert"
              >
                {topicError}
              </p>
            )}
          </div>
          <button
            type="submit"
            className={`${primaryButton} mt-4`}
            disabled={isBusy}
            aria-busy={busy === "starting"}
          >
            {busy === "starting" ? (
              <>
                <Spinner />
                Generating report...
              </>
            ) : (
              "Generate Report"
            )}
          </button>
          <p className="mt-2 text-xs text-stone-400">
            Generating a report can take a minute.
          </p>
        </form>

        <div className="mt-6 border-t border-stone-200 pt-5">
          <form
            onSubmit={handleLoad}
            className="flex flex-col gap-3 sm:flex-row sm:items-end"
          >
            <div className="min-w-0 flex-1">
              <label
                htmlFor="thread-id"
                className="block text-sm font-medium text-stone-800"
              >
                Open a saved workflow
              </label>
              <p
                id="thread-help"
                className="mt-1 text-xs text-stone-500"
              >
                Paste a thread ID to reload its latest status and
                report.
              </p>
              <input
                id="thread-id"
                name="thread-id"
                type="text"
                value={lookupId}
                onChange={(event) => {
                  setLookupId(event.target.value);

                  if (lookupError) {
                    setLookupError(null);
                  }
                }}
                disabled={isBusy}
                aria-invalid={Boolean(lookupError)}
                aria-describedby={
                  lookupError
                    ? "thread-help thread-error"
                    : "thread-help"
                }
                placeholder="Enter a thread ID"
                className="mt-3 w-full rounded-lg border border-stone-300 bg-white px-3 py-2.5 font-mono text-xs text-stone-900 placeholder:font-sans placeholder:text-stone-400 focus:border-emerald-700 focus:outline-none focus:ring-2 focus:ring-emerald-700/15 disabled:bg-stone-50"
              />
            </div>
            <button
              type="submit"
              className={secondaryButton}
              disabled={isBusy}
              aria-busy={busy === "loading"}
            >
              {busy === "loading" ? (
                <>
                  <Spinner />
                  Loading...
                </>
              ) : (
                "Load workflow"
              )}
            </button>
          </form>
          {lookupError && (
            <p
              id="thread-error"
              className="mt-2 text-xs font-medium text-red-700"
              role="alert"
            >
              {lookupError}
            </p>
          )}
        </div>
      </section>

      {research && (
        <section className="rounded-xl border border-stone-200 bg-white p-5 shadow-sm sm:p-6">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="text-xs font-medium uppercase tracking-wide text-stone-400">
                Current research
              </p>
              <h2 className="mt-1 break-words text-base font-medium text-stone-900">
                {research.topic || "Untitled research"}
              </h2>
            </div>
            <StatusBadge status={research.status} />
          </div>

          <dl className="mt-4 flex flex-wrap items-baseline gap-x-5 gap-y-2 text-xs text-stone-500">
            <div className="flex min-w-0 flex-wrap items-baseline gap-1.5">
              <dt>Thread ID</dt>
              <dd className="break-all font-mono text-[11px] text-stone-700">
                {research.threadId}
              </dd>
            </div>
            {research.revisionCount !== null && (
              <div className="flex items-baseline gap-1.5">
                <dt>Revisions</dt>
                <dd className="font-medium text-stone-700">
                  {research.revisionCount}
                </dd>
              </div>
            )}
          </dl>

          {research.message && (
            <p className="mt-3 text-sm text-stone-600">
              {research.message}
            </p>
          )}

          <button
            type="button"
            className={`${secondaryButton} mt-4`}
            onClick={handleRefresh}
            disabled={isBusy}
            aria-busy={busy === "refreshing"}
          >
            {busy === "refreshing" ? (
              <>
                <Spinner />
                Refreshing...
              </>
            ) : (
              "Refresh status"
            )}
          </button>
        </section>
      )}

      {research && (
        <section className="overflow-hidden rounded-xl border border-stone-200 bg-white shadow-sm">
          <div className="flex items-center justify-between gap-4 border-b border-stone-200 px-5 py-4 sm:px-6">
            <h2 className="text-sm font-medium text-stone-800">
              Report
            </h2>
            <button
              type="button"
              className={quietButton}
              onClick={handleCopy}
              disabled={!research.report.trim()}
            >
              {copied ? "Copied" : "Copy Report"}
            </button>
          </div>
          <div className="px-5 py-6 sm:px-8 sm:py-8">
            <ReportMarkdown markdown={research.report} />
          </div>
        </section>
      )}

      {research && isAwaitingReview && (
        <section className="rounded-xl border border-amber-200 bg-white p-5 shadow-sm sm:p-6">
          <h2 className="text-base font-medium text-stone-900">
            Human review
          </h2>
          <p className="mt-1 text-sm leading-6 text-stone-600">
            Review the report above. Approve it, or request changes
            with specific feedback.
          </p>

          {!showFeedback ? (
            <div className="mt-4 flex flex-wrap gap-3">
              <button
                type="button"
                className={primaryButton}
                onClick={() => handleReview(true)}
                disabled={isBusy}
                aria-busy={busy === "reviewing"}
              >
                {busy === "reviewing" ? (
                  <>
                    <Spinner />
                    Submitting...
                  </>
                ) : (
                  "Approve Report"
                )}
              </button>
              <button
                type="button"
                className={secondaryButton}
                onClick={() => {
                  setShowFeedback(true);
                  setFeedbackError(null);
                }}
                disabled={isBusy}
              >
                Request Changes
              </button>
            </div>
          ) : (
            <div className="mt-4">
              <label
                htmlFor="feedback"
                className="block text-sm font-medium text-stone-800"
              >
                Requested changes
              </label>
              <textarea
                id="feedback"
                name="feedback"
                rows={4}
                maxLength={3000}
                value={feedback}
                onChange={(event) => {
                  setFeedback(event.target.value);

                  if (feedbackError) {
                    setFeedbackError(null);
                  }
                }}
                disabled={isBusy}
                aria-invalid={Boolean(feedbackError)}
                aria-describedby={
                  feedbackError
                    ? "feedback-help feedback-error"
                    : "feedback-help"
                }
                placeholder="Explain what should change in the next revision."
                className="mt-2 w-full resize-y rounded-lg border border-stone-300 bg-white px-3 py-2.5 text-sm leading-6 text-stone-900 placeholder:text-stone-400 focus:border-emerald-700 focus:outline-none focus:ring-2 focus:ring-emerald-700/15 disabled:bg-stone-50"
              />
              <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
                <p
                  id="feedback-help"
                  className="text-xs text-stone-400"
                >
                  {feedback.length}/3000 characters
                </p>
                {feedbackError && (
                  <p
                    id="feedback-error"
                    className="text-xs font-medium text-red-700"
                    role="alert"
                  >
                    {feedbackError}
                  </p>
                )}
              </div>
              <div className="mt-4 flex flex-wrap gap-3">
                <button
                  type="button"
                  className={primaryButton}
                  onClick={() => handleReview(false)}
                  disabled={isBusy || !feedback.trim()}
                  aria-busy={busy === "reviewing"}
                >
                  {busy === "reviewing" ? (
                    <>
                      <Spinner />
                      Revising report...
                    </>
                  ) : (
                    "Submit Revision Request"
                  )}
                </button>
                <button
                  type="button"
                  className={secondaryButton}
                  onClick={() => {
                    setShowFeedback(false);
                    setFeedbackError(null);
                  }}
                  disabled={isBusy}
                >
                  Cancel
                </button>
              </div>
            </div>
          )}
        </section>
      )}

      {research?.status === "approved" && (
        <section className="rounded-xl border border-emerald-200 bg-emerald-50 p-5 sm:p-6">
          <h2 className="text-base font-medium text-emerald-900">
            Report approved
          </h2>
          <p className="mt-1 text-sm leading-6 text-emerald-800">
            This report has been approved and the workflow is
            complete.
          </p>
        </section>
      )}

      {research?.status === "completed" &&
        !research.approved && (
          <section className="rounded-xl border border-stone-200 bg-stone-50 p-5 sm:p-6">
            <h2 className="text-base font-medium text-stone-900">
              Research completed
            </h2>
            <p className="mt-1 text-sm leading-6 text-stone-600">
              The workflow finished without approval. This usually
              means the revision limit was reached.
            </p>
          </section>
        )}

      {research?.status === "in_progress" && (
        <section className="rounded-xl border border-sky-200 bg-sky-50 p-5 sm:p-6">
          <h2 className="text-base font-medium text-sky-900">
            Research in progress
          </h2>
          <p className="mt-1 text-sm leading-6 text-sky-800">
            The workflow has not reached review yet. Use Refresh
            status to check again.
          </p>
        </section>
      )}
    </div>
  );
}
