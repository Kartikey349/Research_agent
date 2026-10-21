import Image from "next/image";
import Link from "next/link";

import ApiStatus from "@/components/api-status";
import ResearchWorkspace from "@/components/research-workspace";

export default function Home() {
  return (
    <div className="flex min-h-screen flex-col">
      <header className="border-b border-stone-200 bg-white">
        <div className="mx-auto flex w-full max-w-3xl flex-col gap-4 px-5 py-8 sm:flex-row sm:items-end sm:justify-between sm:px-8">
          <div className="flex items-center gap-2 px-2">
            <h1 className="flex">
              <Link
                href="/"
                aria-label="Researcher home"
                className="inline-flex rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-700 focus-visible:ring-offset-4"
              >
                <Image
                  src="/logo.png"
                  alt="Researcher"
                  width={40}
                  height={40}
                  priority
                  unoptimized
                  className="h-10 w-10"
                />
              </Link>
            </h1>
            <p className="mt-1 text-sm text-stone-500">
              Turn a topic into a structured research report.
            </p>
          </div>
          <ApiStatus />
        </div>
      </header>

      <main className="mx-auto w-full max-w-3xl flex-1 px-5 py-8 sm:px-8 sm:py-10">
        <ResearchWorkspace />
      </main>

      <footer className="mx-auto w-full max-w-3xl px-5 pb-8 text-xs leading-5 text-stone-400 sm:px-8">
        AI-generated reports can contain mistakes. Verify important
        claims and sources.
      </footer>
    </div>
  );
}
