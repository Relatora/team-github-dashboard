# Monetization

How this could be turned into revenue, what it would take, and where the real
constraints are. Written to be useful rather than optimistic: the section on
compliance is the one most likely to decide whether a deal closes.

---

## 1. The wedge

The product argument is narrow and defensible, and it is not "another
engineering analytics tool".

GitHub cannot answer: *how much real work did this team do across everything we
own, over an arbitrary range, with the noise removed?* Four structural reasons,
none of which GitHub is likely to fix, because they follow from what GitHub is
for:

1. **Everything is scoped to one repository.** Insights, Contributors, and Code
   Frequency live inside a repo. Getting an org-wide picture by hand means
   opening every repository and adding up the numbers, per person, every time.
2. **Raw line counts cannot be filtered.** Code Frequency counts committed
   `node_modules`, lock files, minified bundles, and merge commits, which
   re-show a diff already counted. One dependency bump adds tens of thousands of
   "lines" and there is no setting to exclude any of it.
3. **Commit search only indexes default branches.** Teams that develop on
   `develop` are substantially invisible.
4. **Insights are gated and shallow.** Several views need admin or maintainer
   access and are limited to recent windows.

The cleaned-versus-raw contrast is the whole demo. On real data one author's year
reads **+178,796 cleaned against +419,311 raw**. Showing both numbers side by
side, with the difference explained, is more persuasive than any feature list,
because the buyer immediately recognizes the second number as the one they have
been mistrusting.

**Do not position this as a productivity or performance-ranking tool.** That
market is crowded, the buyer is skeptical, and it walks straight into the legal
constraints in section 7. Position it as *making invisible work visible*: the
engineer whose quarter went into three unglamorous repositories nobody was
watching.

## 2. Who feels the pain

| Buyer | The moment they need this | Willingness to pay |
|---|---|---|
| **Engineering managers** at 20 to 200 engineers | Performance cycles, headcount cases, quarterly reviews. They currently assemble this by hand or not at all | Medium. Real pain, but usually no discretionary budget |
| **Agencies and contract shops** | Every client invoice. They must evidence what was delivered, and disputes are expensive | **Highest.** This is directly attached to getting paid |
| **Fractional CTOs and technical advisors** | Reporting to a board or founder on a team they do not sit with daily | High. It is their deliverable |
| **Technical due diligence** in M&A | Assessing whether a codebase was built by a functioning team or one departed contractor | High per engagement, but episodic |
| **Individual engineers** | Their own performance review or promotion case | Low, but excellent as a free tier that seeds the org |

**The agency segment is the one to lead with.** The value is denominated in
invoices rather than in "insight", the buyer is the owner rather than a committee,
the sales cycle is short, and the compliance objection in section 7 is much
weaker when the people being measured are contractors whose billable output is
already the contract's subject.

## 3. Licensing

**Recommendation: open core under AGPL-3.0, with a commercial licence sold
separately.**

- **AGPL** means a competitor cannot take this, host it, and compete without
  publishing their changes. That is precisely the risk for a self-hostable
  analytics tool, and it is why Grafana, Sentry, and MongoDB all moved this way.
- **Companies avoid AGPL by policy**, often without evaluating whether it
  actually binds them. That reflex is the product: the commercial licence exists
  to sell them the exemption, and it converts buyers who never intended to
  redistribute anything.
- The **source stays readable**, which matters when you are asking someone to
  point the tool at their entire private codebase. A closed binary asking for
  `repo` scope on an org token is a much harder sell.

Alternatives, and why they are worse here:

- **Fully proprietary** loses the trust advantage exactly where it costs most:
  at the token permission dialog.
- **MIT or Apache** invites a hosted competitor with none of the build cost.
- **BSL** (converting to open source after four years) is a reasonable second
  choice, but it is less well understood by legal teams and generates more
  questions than AGPL, which is a known quantity.

Whatever is chosen, do it **before** taking outside contributions. Relicensing
later requires every contributor's agreement, and a single unreachable one can
freeze the whole plan. Add a CLA or a DCO now if there is any chance of this.

## 4. Packaging

| Tier | Price | Contents |
|---|---|---|
| **Community** | Free, AGPL | Self-hosted, one organization, unlimited users, full scanning, full export |
| **Team** | ~$8 to $12 per tracked developer per month, minimum ~$100 | Hosted. Scheduled scans, multi-org, saved report templates, email delivery, retained history |
| **Business** | ~$20 to $25 per tracked developer per month | SSO/SAML, audit log, API access, custom categorization rules, data residency choice |
| **Enterprise** | Annual contract | Self-hosted commercial licence, support SLA, GitHub Enterprise Server support, invoicing |

**Price per tracked developer, not per viewer.** The value scales with how many
people are being reported on, and per-seat pricing punishes exactly the behaviour
you want: managers sharing the dashboard widely.

Anchor against the incumbents. LinearB, Swarmia, and Jellyfish are commonly in
the $30 to $60 per developer per month range and are sold as full engineering
intelligence platforms. Sitting well under that, doing one thing properly, is a
coherent position. **Do not attempt to match their feature surface.** DORA
metrics, sprint analytics, and PR cycle time are their ground, and competing
there means a much larger build with no differentiation.

## 5. Distribution

Roughly in order of effort against return:

1. **The cleaned-versus-raw comparison as public content.** A blog post titled
   something like "GitHub says I wrote 419,311 lines. I wrote 178,796" with the
   real methodology is a genuinely interesting technical argument, and it is the
   product demo. This is the cheapest acquisition channel available and it plays
   to the strength of the thing already built.
2. **Open source on GitHub.** The repository is the landing page for a developer
   tool. `WHY_THIS_OVER_GITHUB.md` already reads as marketing copy.
3. **A GitHub Marketplace App.** Installation via OAuth instead of a personal
   access token removes the largest friction in onboarding, and Marketplace is
   where the buyer is already looking. This is the largest engineering
   investment on the list and probably the highest return.
4. **Docker image and a one-click deploy template.** Self-hosting must be
   genuinely easy or the free tier does not seed anything.
5. **Agency and consultancy channels.** Direct outreach, because the segment is
   small, identifiable, and has budget.

## 6. Adjacent revenue

- **Managed hosting** for organizations that want the open source version
  without operating it. Highest margin, lowest build cost.
- **White label for agencies**, so client reports carry their brand. The agency
  segment will ask for this unprompted.
- **Custom report templates** as a services engagement, especially for board
  reporting.
- **A read-only API** for teams pulling into their own BI. Cheap, since the
  aggregation layer already exists.
- **GitHub Enterprise Server support.** The scanner already goes through one
  configurable API base, so this is close to a configuration change and it
  unlocks the segment that can most afford it.

## 7. Compliance, and why it is a sales problem

**This is the section to read before writing any marketing copy.**

Per-developer metrics are legally constrained in ways per-team metrics are not.
Getting this wrong does not surface as a moral objection. It surfaces as a deal
dying in legal review after months of work.

- **GDPR.** Commit data tied to a named individual is personal data. Processing
  it for employment purposes requires a lawful basis, and legitimate interest is
  the usual one, which demands a documented balancing test. Employees have
  access and objection rights over it.
- **Article 22** restricts decisions with legal or similarly significant effects
  made solely by automated processing. Performance management qualifies. A tool
  positioned as producing a ranking invites exactly this objection.
- **Works councils.** In Germany, Austria, the Netherlands, and much of the
  Nordics, deploying a system capable of monitoring employee performance
  typically requires works council agreement. This can add months, and it can
  simply fail. A German enterprise deal will be asked this question.
- **Some US states** require notice for electronic employee monitoring.

The practical consequences for the product:

1. **Lead with team-level and project-level reporting.** Per-person is available,
   defaults conservative, and is never the headline.
2. **Ship an aggregate-only mode** that suppresses individual attribution
   entirely. This is a checkbox in the interface and it unblocks an entire class
   of buyer.
3. **Keep the honesty argument front and centre.** The most defensible framing
   is that this tool exists because raw GitHub numbers are *misleading*, and
   cleaned counting makes them less unfair. That is a genuinely pro-engineer
   position and it survives a works council conversation. "Rank your developers"
   does not.
4. **Publish the methodology.** Anyone measured by this should be able to read
   exactly what is counted and what is excluded. That is both the right thing
   and the strongest answer to a transparency objection.
5. **Document retention and deletion.** Be able to answer "how do we delete a
   departed employee's data" before it is asked.
6. **Get counsel before selling into the EU.** This document is not legal advice.

## 8. What to build, in order

Only the work that unlocks revenue, not the full wishlist.

**To sell anything at all**
- Multi-tenancy. Organization scoping on every table and every query. This is the
  single largest piece of work and everything hosted depends on it.
- GitHub App installation instead of personal access tokens.
- A real job queue. The in-process store in `lib/jobs/store.ts` cannot survive
  more than one instance, and this is documented in ARCHITECTURE.md.

**To sell to a team**
- Billing (Stripe), organization-level plans and seat counting.
- Scheduled scans and emailed reports.
- Aggregate-only mode, per section 7.

**To sell to an enterprise**
- SSO and SAML. Swappable behind the auth facade already in `lib/auth/guard.ts`.
- Audit log.
- Data residency, which means regional deployments.
- GitHub Enterprise Server support.

**Efficiency, once volume matters**
- Webhook-driven incremental sync instead of polling scans. The current design
  walks branches on a schedule, which is correct for a single organization and
  will not scale to hundreds. Webhooks turn a periodic full walk into an event
  stream, and they are what makes per-customer cost sane.

## 9. An honest assessment

**What is genuinely strong.** The cleaned-versus-raw insight is real, specific,
and demonstrable with numbers from actual use. The rate-limit and resume
engineering is the unglamorous part that most competitors get wrong and that
makes the difference between a tool that finishes and one that hangs. Branch
walking finds work GitHub's own graph does not.

**What is weak.** This is one feature, not a platform. The incumbents have five
years of head start on the surrounding surface. The buyer for engineering
analytics is notoriously hard to reach and slow to commit, and "measure the
developers" is a phrase that makes engineers hostile, which matters because
engineers are the ones who evaluate the tool.

**The most likely path to real revenue** is not the SaaS ladder in section 4. It
is the agency and contractor segment, sold as evidence for invoicing, where the
value is concrete, the buyer decides alone, and the compliance objection largely
evaporates. That is a smaller market and a faster one, and it funds the rest.

**The second most likely path** is that this stays open source, builds a
reputation, and is worth more as a portfolio artifact and a hiring signal than
as a product. That is a legitimate outcome and worth deciding on deliberately
rather than by default.
