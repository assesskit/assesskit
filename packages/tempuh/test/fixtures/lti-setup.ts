import type { TestProject } from "vitest/node";
import { startLtiServers } from "./lti-server.ts";

/** Starts the servers of the LTI browser tests: the platform's storage page and two tools; they stop when the tests end. */
export default async function setup(project: TestProject): Promise<() => Promise<void>> {
  const servers = await startLtiServers();
  project.provide("lti", servers.origins);
  return servers.close;
}
