import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";

const components: Components = {
  a: ({ href, children, title }) => (
    <a
      href={href}
      title={title}
      target="_blank"
      rel="noopener noreferrer"
    >
      {children}
    </a>
  ),
  table: ({ children }) => (
    <div className="table-scroll">
      <table>{children}</table>
    </div>
  ),
};

export default function ReportMarkdown({
  markdown,
}: {
  markdown: string;
}) {
  if (!markdown.trim()) {
    return (
      <p className="report-empty">
        No report text is available yet. Refresh the status or try again.
      </p>
    );
  }

  return (
    <div className="report-markdown">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={components}
      >
        {markdown}
      </ReactMarkdown>
    </div>
  );
}
