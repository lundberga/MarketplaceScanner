# Project Retrospective

*A living document updated after each milestone. Lessons feed forward into future planning.*

## Milestone: v1.0 — MVP

**Shipped:** 2026-03-03
**Phases:** 8 | **Plans:** 19 | **Timeline:** 2 days

### What Was Built
- Four-marketplace scraper pipeline (Blocket, Tradera, Vinted, Sweclockers) with shared IScraper interface and unified deduplication
- Deal detection engine: threshold matching + Tradera sold-comps enrichment + auction-timing filter → DealAlert structs
- SQLite persistence layer: 5 tables (seen_listings, thresholds, sold_price_cache, user_config, scan_log) with WAL mode and absolute-path bootstrap for Windows reliability
- Discord embed alert system with per-marketplace colors, throttled delivery queue, alerted_at persistence, and seed-mode cold-start
- Full Discord slash-command surface: /threshold (set/remove/list), /pause, /resume, /dismiss — all wired to live SQLite state
- node-cron scheduler with noOverlap:true sequencing — bot polls all marketplaces autonomously

### What Worked
- **Pipeline architecture first** — building schema → scrapers → scheduler → detection → Discord in strict order meant each layer had stable contracts before the next started; zero backtracking on schema
- **IScraper interface early** — defining the shared Listing schema in Phase 2 meant Blocket (Phase 3), Vinted (Phase 5), and Sweclockers (Phase 5) plugged in without touching earlier code
- **TDD for price parsers** — parsePrice and parseAuctionEnd were written test-first; both caught real edge cases (comma-thousands vs comma-decimal, year-boundary for January dates)
- **noOverlap:true saved architectural work** — discovering node-cron v4's built-in no-overlap option eliminated the need for p-queue (which is ESM-only, incompatible with CJS)
- **Lazy require() in command handler** — startup never fails on missing command files; modules load only when command is invoked

### What Was Inefficient
- **Phase 4 verification gap** — the scheduler was implemented and wired but never formally verified (no VERIFICATION.md); discovered only at milestone audit; had to create retroactively
- **Audit body status not updated** — YAML frontmatter was updated to `passed` after gaps were resolved, but the body header still shows `gaps_found`; cosmetic inconsistency that caused confusion
- **Human verifications deferred** — live Discord rendering, Blocket network scrape, Vinted Cloudflare behavior, and guild command registration were all flagged as "pending" and not confirmed before closing v1.0; acceptable for dev speed but creates uncertainty about Phase 7/8 real-world behavior

### Patterns Established
- **Seed-mode pattern**: `countSeen === 0` → return [] without dedup writes → no alerts on cold start; all four scrapers implement this identically
- **Per-scraper try/catch isolation**: each scraper wrapped independently in runCycle.js; one failure never cascades to others
- **Injected dependencies for testability**: lookupSoldPrice injected into detectDeals; alertSender injected as 4th param to runCycle — no global state, clean unit tests
- **INSERT OR IGNORE + db.transaction**: atomic novel-listing batch with no first_seen timestamp clobber
- **Absolute paths for Windows reliability**: DB_PATH via `path.resolve(__dirname, '../data/scanner.db')` prevents SQLITE_CANTOPEN under different CWDs (pm2, Task Scheduler)

### Key Lessons
1. **Verify phases formally before moving on** — Phase 4 was wired and worked but wasn't verified; always create VERIFICATION.md before closing a phase, even if it seems obvious
2. **noOverlap:true in node-cron v4** — prefer this over external concurrency queues for simple sequential polling; ESM packages (p-queue) don't mix cleanly with CJS
3. **Year-boundary edge case in date parsers** — when parsing dates without year, always check if the candidate falls in the past and increment year if so (handles December→January transitions)
4. **Audit body vs YAML status** — when resolving gaps during audit, update both the YAML frontmatter AND the body status header to avoid confusion
5. **Discord embed title vs URL** — `.setTitle()` and `.setURL()` are separate calls; always add `.setURL()` when you want the title to be a hyperlink (common Discord bot convention)

### Cost Observations
- Model mix: balanced profile (sonnet primary)
- Notable: 8 phases shipped in 2 days with 84 commits — high velocity, minimal rework

---

## Cross-Milestone Trends

### Process Evolution

| Milestone | Phases | Plans | Key Change |
|-----------|--------|-------|------------|
| v1.0 | 8 | 19 | First milestone — established pipeline architecture, IScraper pattern, seed-mode |

### Cumulative Quality

| Milestone | Unit Tests | Verified Phases | Tech Debt Items |
|-----------|------------|-----------------|-----------------|
| v1.0 | parsePrice, parseAuctionEnd, seenListings | 8/8 (1 retroactive) | 6 (live verifications + embed URL) |

### Top Lessons (Verified Across Milestones)

1. Verify phases formally (VERIFICATION.md) before closing — don't let "it works" substitute for explicit verification
2. IScraper/shared-schema early — define the contract before writing scrapers, not after
