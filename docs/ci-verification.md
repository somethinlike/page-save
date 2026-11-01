# CI verification and notification diagnosis

The existing `.github/workflows/ci.yml` runs for both pushes and pull requests. A commit pushed to an open PR branch can therefore trigger two workflow runs. Each run checks Ubuntu, Windows and macOS. GitHub sends the resulting notifications according to the account's notification settings.

## Windows source-boundary test repair — November 1, 2026

The Windows runs for ATK commits `351455a` and `e5638fa` failed in `src/sidepanel-domain.test.ts` before its domain-grouping assertions executed. All ATK recipe tests passed. The same failure is visible in the October 17 Genius run, before the ATK work:

| Run | Commit | Evidence |
| --- | --- | --- |
| [Earlier Genius push](https://github.com/somethinlike/page-save/actions/runs/39012257753) | `a60b2b0` | Windows test failed with `expected -1 to be greater than 5354` |
| [ATK full instructions push](https://github.com/somethinlike/page-save/actions/runs/41297017958) | `e5638fa` | Same source-boundary failure; 173 other tests passed |

The test located a source slice using a comment marker containing a literal LF newline. A Windows CRLF checkout did not match the marker, so its end index was `-1`. The local source used LF and therefore passed.

The marker now accepts LF and CRLF. The existing full domain-grouping behavior assertions run against both source forms, including exact subdomain schemas and collapsed `www` parent schemas. This changes the test harness only. It preserves product behavior, CI event triggers and notification settings.

Local verification passed 175 tests across 12 files, plus typecheck and build. The focused test covers both line-ending forms. The sandboxed focused command exited after its banner without diagnostics; the identical command and full validation passed with the documented scoped execution route.

## After a push

Use the verified GitHub CLI to inspect the actual hosted runs, including both event types:

```powershell
gh run list --repo somethinlike/page-save --branch atk-recipe-schema --limit 8 --json databaseId,headSha,status,conclusion,event,url
gh run view <run-id> --repo somethinlike/page-save --log-failed
```

Match `headSha` to the pushed commit. A local test pass does not establish hosted CI success. If a run fails, inspect the failed step, repair the demonstrated cause within project scope, then verify the original operation again. Account-wide notification settings and workflow triggers require their own scope decision.
