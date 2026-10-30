import type { TestProject } from "vitest/node";
import { startExamServer } from "./exam-server.ts";

declare module "vitest" {
  interface ProvidedContext {
    /** The origin of the exam server: session hosts and the asset gate over HTTP. */
    exam: string;
  }
}

/** Starts the exam server of the end-to-end tests; it stops when the tests end. */
export default async function setup(project: TestProject): Promise<() => Promise<void>> {
  const server = await startExamServer();
  project.provide("exam", server.origin);
  return () => server.close();
}
