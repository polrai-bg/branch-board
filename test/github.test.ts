import { test } from "node:test";
import assert from "node:assert/strict";
import { GitHubError, collectRepo } from "../src/lib/github.ts";
import { statusOf } from "../src/lib/merge.ts";

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

test("401 token throws GitHubError", async () => {
  const fetchImpl: typeof fetch = async () => json(401, { message: "Bad credentials" });
  await assert.rejects(() => collectRepo("token", "example-owner", "demo-repo", ["main"], { fetch: fetchImpl }), (error: unknown) => {
    assert.ok(error instanceof GitHubError);
    assert.equal(error.status, 401);
    return true;
  });
});

test("deleted PR base keeps the row with no counts, and UNKNOWN mergeable stays Open PR", async () => {
  const fetchImpl: typeof fetch = async (input, init) => {
    const url = String(input);
    if (url.includes("/compare/")) return json(404, { message: "Not Found" });
    const query = JSON.parse(String(init?.body)).query as string;
    if (query.includes("issue(number:")) {
      return json(200, { data: { repository: { i_7: { number: 7, title: "Seven", state: "OPEN" } } } });
    }
    return json(200, {
      data: {
        repository: {
          refs: {
            pageInfo: { hasNextPage: false, endCursor: null },
            nodes: [
              {
                name: "main",
                target: { oid: "base", committedDate: "2026-01-01T00:00:00Z", message: "init", author: { name: "A", user: { login: "a" } } },
                associatedPullRequests: { nodes: [] },
              },
              {
                name: "cursor/7-slug",
                target: { oid: "abc", committedDate: "2026-01-02T00:00:00Z", message: "work", author: { name: "A", user: { login: "a" } } },
                associatedPullRequests: {
                  nodes: [
                    {
                      number: 3,
                      url: "https://example.test/pull/3",
                      state: "OPEN",
                      mergeable: "UNKNOWN",
                      baseRefName: "gone",
                      updatedAt: "2026-01-02T00:00:00Z",
                      closingIssuesReferences: { nodes: [{ number: 7, title: "Seven", state: "OPEN", repository: { nameWithOwner: "example-owner/demo-repo" } }] },
                    },
                  ],
                },
              },
            ],
          },
        },
      },
    });
  };

  const { branches, issues } = await collectRepo("token", "example-owner", "demo-repo", ["main"], { fetch: fetchImpl });
  assert.equal(branches.length, 1);
  assert.equal(branches[0].name, "cursor/7-slug");
  assert.equal(branches[0].compare, null);
  assert.equal(branches[0].prs[0].mergeable, "UNKNOWN");
  assert.equal(statusOf(branches[0]), "Open PR");
  assert.equal(issues.find((issue) => issue.number === 7)?.title, "Seven");
});
