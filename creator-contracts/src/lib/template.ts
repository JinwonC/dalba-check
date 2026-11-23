// Contract template: the deal fields a manager fills in, the default clause
// blocks, and the helpers that turn them into text. Pure functions only, so
// this file is safe to import from both server and client components.

export const CLIENT_NAME = "d'Alba Global Co., Ltd";

export type Item = { product: string; count: number };

export type Kind = "video" | "live";

export type Fields = {
  /** Video collaboration (default) or livestream hosting. Decides the clauses, summary and invoice layout. */
  kind?: Kind;
  // Livestream contracts only:
  liveSchedule?: string; // "Date and Time" line, free text
  sessionLength?: string; // e.g. "Minimum 1 hour per session"
  hourlyRate?: number;
  hours?: number; // agreed total hours; fee = hourlyRate x hours
  talentName: string; // "Talent / Agency" row, usually the handle
  handle: string; // without @
  creatorEmail: string;
  country: string;
  effectiveDate: string; // yyyy-mm-dd
  startDate: string;
  endDate: string;
  items: Item[]; // products in this contract and how many videos each gets
  deliverableCount: number; // total across items (kept in sync when saving)
  deliverableType: string;
  paidUsageDays: number;
  product: string; // all product names joined (kept in sync when saving)
  currency: "USD" | "GBP" | "EUR";
  fee: number;
  commissionPct: number;
  invoiceDescription: string;
};

export type Billing = {
  beneficiaryName: string;
  beneficiaryAddress: string;
  bankName: string;
  bankAddress: string;
  branchCode: string;
  swift: string;
  accountNumber: string;
  routingNumber: string;
  iban: string;
};

export type Signature = {
  signature: string;
  name: string;
  title: string;
  signedAt: string; // ISO
  ip: string;
  userAgent: string;
  docHash: string;
};

export type Clause = { id: string; title: string; body: string };

export const COUNTRIES = ["US", "UK", "DE", "ES", "FR", "Other"];

export const EMPTY_BILLING: Billing = {
  beneficiaryName: "",
  beneficiaryAddress: "",
  bankName: "",
  bankAddress: "",
  branchCode: "",
  swift: "",
  accountNumber: "",
  routingNumber: "",
  iban: "",
};

export function defaultFields(): Fields {
  return {
    talentName: "",
    handle: "",
    creatorEmail: "",
    country: "US",
    effectiveDate: "",
    startDate: "",
    endDate: "",
    items: [{ product: "", count: 10 }],
    deliverableCount: 10,
    deliverableType: "TikTok shoppable videos",
    paidUsageDays: 30,
    product: "",
    currency: "USD",
    fee: 0,
    commissionPct: 20,
    invoiceDescription: "TikTok Shop Video Content Package",
  };
}

// Clause body syntax: "## " starts a sub-heading, "- " a bullet, anything else
// is a paragraph. {{placeholders}} are filled from the deal fields.
export const DEFAULT_CLAUSES: Clause[] = [
  {
    id: "services",
    title: "Services & Deliverables",
    body: `## (a) Deliverables
Talent shall create content that highlights d'Alba's {{product}}.
Talent will be creating specific content with the agreed product via written communication on TikTok (email to suffice).
- d'Alba to provide product, creative brief, link, and extra guidance if needed.
- Talent is required to provide Spark Ad authorization codes for all published videos within 3 business days of each video's publication, valid for 365 days.`,
  },
  {
    id: "schedule",
    title: "Schedule",
    body: `## (a) Time frame
{{deliverables}} to go live from {{start_date}}
- Talent must have the content ready by the mutually agreed date communicated beforehand with all the reasonable requested edits made. Agreed Date for TikTok Content will be shared by the brand beforehand in a timely manner.
- Content should be completed by {{end_date}} (Posting pace: up to 2 videos per day).
## (b) Approval/Draft
- Talent is required to submit draft content and obtain Client approval prior to publication.
- Client has the right to request up to one (1) round of revisions and editions per post; provided there shall be no limit to approvals to correct inaccuracies and factual errors and that Talent shall not be required to edit the Deliverable unless Talent has failed to follow the material terms of the brief and/or approved concept. Revisions may include eliminating a certain portion of the draft. Additionally, Talent agrees that Client shall have the right to edit the raw video footage before publication, and Talent agrees to post the final version as edited by Client.
Feedback must be provided by Client within a reasonable time prior to the intended publication of the relevant Deliverable, provided Talent sent draft on schedule. In the event Client does not respond with approval or feedback for disapproval within three (3) days, which results in Talent missing the requested publication date, Talent shall be paid in full and will post at another time mutually determined by Talent and Client.
- Content Requirements: Must adhere to guidelines (PIP usage, skin change testimonials, B&A photos, personal storytelling, and product cut-transitions, etc).
If rescheduling is needed, Agency or Talent must contact the Client in advance with an explanation.`,
  },
  {
    id: "additional",
    title: "Additional Terms and Conditions",
    body: `- All published Posts are to remain live on the Talent's feed and will not be taken down or made private by the Talent unless directed to do so by Client for a minimum of 12 months from the date of first publication.
- The Paid Usage period shall commence from the date the advertisement is launched/executed (i.e., the Spark Ads/GMV Max ad start date)
- {{count}} Videos in total.
## (a) Confidentiality
The parties agree not to utilize or disclose any confidential or proprietary information obtained while performing under the terms of this Agreement to any third party, other than (i) to the parties' agents and representatives; (ii) to carry out the terms of this Agreement; or (iii) as required by law or court order. Such confidential and proprietary information includes but is not limited to all trade secrets, know-how, Intellectual Property, computer software/programs, customer lists, client lists, business plans, vendor lists, promotional and marketing materials, finances, pricing, fees and commissions, audience and social media follower metrics, contracts, and agreements wherein Brand/Company and/or Influencer is a party and such information that is generally not known to the public.
## (b) Compliance
Talent agrees to observe and comply with all local, state, and federal laws, rules, and government regulations, including but not limited to the Federal Trade Commission's Endorsement and Testimonial guidelines available for review online at FTC Endorsement Guides and the FTC's Native Advertising Guidelines. By executing this Agreement, Talent acknowledges that they have been given an opportunity to visit the links provided herein and review all the materials. Influencer also warrants that they periodically check for updates and take all steps to remain informed about the subject matter of this section of the Agreement.
* http://www.ftc.gov/os/2009/10/091005revisedendorsementguides.pdf
** https://www.ftc.gov/tips-advice/business-center/guidance/native-advertising-guide-businesses
## (c) Force Majeure
- Any delay or failure of Talent to perform their obligations hereunder shall be excused to the extent that it is caused by an event or condition beyond their reasonable control such as, by way of example but not limitation, death, serious illness or injury, governmental action, acts of God, epidemic, pandemic or similarly widespread virus or disease, flood, storm or other natural disasters, fire, explosion, war, civil disorder or labor dispute ("Force Majeure").
- Upon the occurrence of any Force Majeure event, Talent shall promptly notify the Brand of said occurrence, the anticipated duration of the Force Majeure events, and the proposed steps taken to remedy or ameliorate the problem. The parties shall then negotiate in good faith to resolve the issue or as a last resort, terminate this Agreement.
## (d) Cancellation
In the event of cancellation with cause (i.e., a material uncured breach by Talent), Client will pay Talent a pro-rata portion of the compensation based on the percentage attributable to Services rendered up to date of the cancellation and shall cease all further use of any Talent Attributes (as defined). Client will have the right to terminate this Agreement with written notice in the event that Talent breaches any material term of this Agreement, and such breach remains uncured five (5) business days after written notice from Client specifying such breach in reasonable detail, and Talent will not be entitled to any further payment under this Agreement, except Talent shall receive a pro-rata portion of the compensation based on the percentage attributable to Services rendered up to date of the cancellation.
Talent will have the right to terminate this Agreement with written notice in the event that Client breaches any material term of this Agreement (including, without limitation, any failure to make payment when due), and such breach remains uncured five (5) business days after written notice from Talent specifying such breach in reasonable detail, and Client shall immediately remit the Fee, in whole or the outstanding remainder, and shall immediately cease use of the Deliverable(s).`,
  },
  {
    id: "fees",
    title: "Fees & Compensation",
    body: `## (a) Total Fees
- {{fee_terms}} to be paid to Talent net thirty (30) days provided that (i) Talent fully and faithfully performs all obligations hereunder and in the Agreement, and (ii) Talent submits a written invoice to Client within 2 weeks after all videos have been posted successfully. Client shall cover all bank wire (if applicable) transaction fees when submitting payment.`,
  },
];

/** Livestream hosting agreement (from the d'Alba Live Contract Format). */
export const LIVE_CLAUSES: Clause[] = [
  {
    id: "live-services",
    title: "Services & Deliverables",
    body: `## (a) Deliverables
- During each livestream, Talent shall highlight agreed products via written communication on email, Lark, Whatsapp. The product selection is subject to flexible adjustment based on d'Alba's needs and prior discussion between both parties.
- d'Alba to provide product, creative brief, link, and extra guidance if needed.`,
  },
  {
    id: "live-schedule",
    title: "Schedule",
    body: `## (a) Time frame
- Talent shall be available to host the TikTok livestream on the mutually agreed date and time, as communicated in advance by the Brand.
- Talent agrees to reasonably cooperate with the Brand on pre-live preparation, including run-of-show alignment, product talking points, and compliance requirements, communicated in a timely manner prior to the livestream.
- Talent shall confirm each livestream session to the Brand no later than twenty-four (24) hours in advance, specifying the date, scheduled start time, scheduled end time, and total planned duration for that session. Any session not confirmed in accordance with this provision shall not be treated as a scheduled session, and the Brand shall have no obligation to prepare for, or to credit toward the total hours, any such unconfirmed session.
- Once a session has been confirmed under this Schedule, Talent shall not cancel or reschedule that session except upon at least twenty-four (24) hours' prior written notice to the Brand, together with a reasonable explanation. A cancellation made with less than twenty-four (24) hours' notice, or a failure to go live at the confirmed time (a "no-show"), shall result in a written warning for the first occurrence; a second occurrence, or any pattern of repeated late cancellations or no-shows, shall constitute a material breach entitling the Brand to terminate this Agreement. Delays or failures excused as Force Majeure are excepted from this provision.
## (b) Approval/Draft
- Talent shall provide livestream preparation materials (including but not limited to run-of-show, key talking points, product claims, pricing and promotional information) to the Brand for approval prior to the scheduled TikTok livestream.
- The Brand shall have the right to request up to one (1) round of reasonable revisions to the proposed livestream plan; provided, however, that there shall be no limit to revisions required to correct inaccuracies, misleading statements, or factual and compliance-related errors.
- Talent shall not be required to make changes unless Talent has failed to follow the material terms of the Brand's brief and/or the approved livestream plan. Such revisions may include the elimination or modification of specific portions of the proposed livestream content or talking points.
- Provided that Talent has submitted the required materials in accordance with the agreed timeline, the Brand shall provide approval or feedback within a reasonable time prior to the scheduled livestream.
- If the Brand does not provide approval or feedback within three (3) days of receipt and such delay results in the livestream being unable to proceed as scheduled, Talent shall be paid in full, and the livestream shall be rescheduled to another date and time determined by the Brand. If rescheduling is required for any reason attributable to Talent or Agency, Talent or Agency must notify the Brand in advance and provide a reasonable explanation.`,
  },
  {
    id: "live-additional",
    title: "Additional Terms and Conditions",
    body: `- Talent is required to notify the Client at the immediate start and conclusion of each livestream session. Any livestream duration not verified by such notifications will not be credited towards the total compensable time.
- If the actual duration of any livestream session is shorter than the confirmed planned duration, Talent shall notify the Brand of the actual duration and the reason for the shortfall. Undisclosed or unverified time shall not count toward compensable hours. Only repeated or intentional misrepresentation of a session's actual duration or activity, continuing after written notice from the Brand, may be treated as a material breach under the Cancellation section below.
- Compensable livestream hours shall include only time during which Talent is actively hosting and presenting the agreed d'Alba products in accordance with the Brand's brief. Idle time, time during which the stream is unattended, and time not actively promoting the agreed d'Alba products shall not count toward the minimum required hours or the total compensable time.
- The Brand may monitor any livestream in real time and may rely on TikTok Shop and TikTok LIVE backend analytics as the authoritative record of each session's start time, end time, duration, and activity. Where such platform records conflict with the hours reported by Talent, the platform records shall control for purposes of determining compensable time.
## (a) Exclusivity
- When hosting a livestream that features d'Alba products, Talent shall include only d'Alba products in the livestream showcase and shall not feature, introduce, or promote any other brand's products during that livestream. Any breach of this provision shall be handled in accordance with the Cancellation section below.
## (b) Confidentiality
- The parties agree not to utilize or disclose any confidential or proprietary information obtained while performing under the terms of this Agreement to any third party, other than (i) to the parties' agents and representatives; (ii) to carry out the terms of this Agreement; or (iii) as required by law or court order. Such confidential and proprietary information includes but is not limited to all trade secrets, know-how, Intellectual Property, computer software/programs, customer lists, client lists, business plans, vendor lists, promotional and marketing materials, finances, pricing, fees and commissions, audience and social media follower metrics, contracts, and agreements wherein Brand/Company and/or Influencer is a party and such information that is generally not known to the public.
- Confidential information includes livestream performance data, GMV figures, conversion metrics, and any internal sales or operational data disclosed in connection with the livestream collaboration.
## (c) Compliance
- Talent agrees to observe and comply with all local, state, and federal laws, rules, and government regulations, including but not limited to the Federal Trade Commission's Endorsement and Testimonial guidelines available for review online at FTC Endorsement Guides and the FTC's Native Advertising Guidelines. By executing this Agreement, Talent acknowledges that they have been given an opportunity to visit the links provided herein and review all the materials. Influencer also warrants that they periodically check for updates and take all steps to remain informed about the subject matter of this section of the Agreement.
* http://www.ftc.gov/os/2009/10/091005revisedendorsementguides.pdf
** https://www.ftc.gov/tips-advice/business-center/guidance/native-advertising-guide-businesses
- Talent further agrees to comply with all applicable platform rules and policies, including TikTok Community Guidelines and TikTok Shop livestream policies, during the livestream.
## (d) Force Majeure
- Any delay or failure of Talent to perform their obligations hereunder shall be excused to the extent that it is caused by an event or condition beyond their reasonable control such as, by way of example but not limitation, death, serious illness or injury, governmental action, acts of God, epidemic, pandemic or similarly widespread virus or disease, flood, storm or other natural disasters, fire, explosion, war, civil disorder or labor dispute ("Force Majeure").
- Upon the occurrence of any Force Majeure event, Talent shall promptly notify the Brand of said occurrence, the anticipated duration of the Force Majeure events, and the proposed steps taken to remedy or ameliorate the problem. The parties shall then negotiate in good faith to resolve the issue or as a last resort, terminate this Agreement. Notwithstanding the foregoing, if such Force Majeure event prevents the Talent from performing the Services for more than seven (7) consecutive days from the originally scheduled date, the Brand shall have the right to terminate this Agreement immediately upon written notice without any further liability or payment obligation, except for Services already rendered prior to such event.
## (e) Cancellation
- In the event of cancellation with cause (i.e., a material uncured breach by Talent), Client will pay Talent a pro-rata portion of the compensation based on the percentage attributable to Services rendered up to date of the cancellation and shall cease all further use of any Talent Attributes (as defined). Client will have the right to terminate this Agreement with written notice in the event that Talent breaches any material term of this Agreement, and such breach remains uncured five (5) business days after written notice from Client specifying such breach in reasonable detail, and Talent will not be entitled to any further payment under this Agreement, except Talent shall receive a pro-rata portion of the compensation based on the percentage attributable to Services rendered up to date of the cancellation.
- Talent will have the right to terminate this Agreement immediately upon written notice in the event that Client breaches any material term of this Agreement (including, without limitation, any failure to make payment when due), and Client shall immediately remit the Fee, in whole or the outstanding remainder, and shall immediately cease use of the Deliverable(s).`,
  },
  {
    id: "live-fees",
    title: "Fees & Compensation",
    body: `## (a) Total Fees
- {{fee_terms}} to be settled to Talent by bank transfer after the end of the contract term, payable within thirty (30) days, provided that (i) Talent fully and faithfully performs all obligations hereunder and (ii) Talent submits a written invoice to Client no later than the 3rd day of the month following the end of the contract term. The invoice shall include the date of the session, the actual duration, and the agreed-upon fees. Client shall cover all bank wire transaction fees when submitting payment.`,
  },
];

export const isLive = (f: { kind?: Kind }) => f.kind === "live";

/** Standard clauses for a contract type. */
export function defaultClauses(kind?: Kind): Clause[] {
  return kind === "live" ? LIVE_CLAUSES : DEFAULT_CLAUSES;
}

/** Agreed fee of a livestream contract: hourly rate x agreed hours. */
export function liveFee(f: Fields): number {
  return Math.round((Number(f.hourlyRate) || 0) * (Number(f.hours) || 0) * 100) / 100;
}

/** "Oct 1, 2026 - Nov 30, 2026" style period for the summary table and invoice. */
export function periodText(f: Fields): string {
  const a = longDate(f.startDate);
  const b = longDate(f.endDate);
  return a && b ? `${a} - ${b}` : a || b;
}

export const PLACEHOLDERS = [
  "product",
  "deliverables",
  "count",
  "start_date",
  "end_date",
  "paid_usage",
  "fee_terms",
  "handle",
];

const SYMBOL: Record<string, string> = { USD: "$", GBP: "£", EUR: "€" };

export function money(amount: number, currency: string): string {
  const n = Number(amount) || 0;
  const text = n.toLocaleString("en-US", { minimumFractionDigits: Number.isInteger(n) ? 0 : 2, maximumFractionDigits: 2 });
  return `${SYMBOL[currency] ?? ""}${text}`;
}

/** "2026-09-30" -> "September 30th, 2026" (matches the existing paper template). */
export function longDate(iso: string): string {
  const months = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
  // A month with no day ("2026-11"): the video content window is agreed by month.
  const ym = /^(\d{4})-(\d{2})$/.exec(iso || "");
  if (ym) return `${months[Number(ym[2]) - 1]} ${ym[1]}`;
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso || "");
  if (!m) return "";
  const d = Number(m[3]);
  const suffix = d % 10 === 1 && d !== 11 ? "st" : d % 10 === 2 && d !== 12 ? "nd" : d % 10 === 3 && d !== 13 ? "rd" : "th";
  return `${months[Number(m[2]) - 1]} ${d}${suffix}, ${m[1]}`;
}

/** ISO timestamp or date -> "MM/DD/YYYY" in UTC. */
export function shortDate(iso: string | Date | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "";
  return `${String(d.getUTCMonth() + 1).padStart(2, "0")}/${String(d.getUTCDate()).padStart(2, "0")}/${d.getUTCFullYear()}`;
}

/** Products of a deal. Older deals stored a single product and count. */
export function itemsOf(f: Fields): Item[] {
  if (Array.isArray(f.items) && f.items.length) return f.items;
  return [{ product: f.product || "", count: Number(f.deliverableCount) || 0 }];
}

export function totalVideos(f: Fields): number {
  return itemsOf(f).reduce((n, i) => n + (Number(i.count) || 0), 0);
}

/** "A", "A and B", "A, B and C" */
export function joinNames(names: string[]): string {
  const n = names.filter(Boolean);
  if (n.length <= 1) return n[0] ?? "";
  return `${n.slice(0, -1).join(", ")} and ${n[n.length - 1]}`;
}

/** Per-product lines for the summary table, only when there is more than one product. */
export function itemLines(f: Fields): string[] {
  const items = itemsOf(f);
  return items.length > 1 ? items.map((i) => `${i.count} x ${i.product}`) : [];
}

/** "Sep 30, 2026" */
export function medDate(iso: string | null | undefined): string {
  const short = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const ym = /^(\d{4})-(\d{2})$/.exec(iso || "");
  if (ym) return `${short[Number(ym[2]) - 1]} ${ym[1]}`;
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso || "");
  if (!m) return "";
  const mon = short[Number(m[2]) - 1];
  return `${mon} ${Number(m[3])}, ${m[1]}`;
}

/** Invoice line: the description with the number of videos in brackets, e.g. "… Package (10 videos)". */
export function invoiceLine(f: Fields): string {
  if (isLive(f)) return "Livestream hourly service";
  const n = totalVideos(f);
  return n > 0 ? `${f.invoiceDescription} (${n} video${n === 1 ? "" : "s"})` : f.invoiceDescription;
}

export function deliverables(f: Fields): string {
  return `${f.deliverableCount} x ${f.deliverableType}`;
}

export function campaignName(f: Fields): string {
  if (isLive(f)) return "Exclusive Live streaming with d'Alba";
  return `@${f.handle} X d'Alba`;
}

export function feeTerms(f: Fields): string {
  if (isLive(f)) {
    let live = `Flat Fee of ${money(Number(f.hourlyRate) || 0, f.currency)} per hour`;
    if (Number(f.commissionPct) > 0) live += ` and ${f.commissionPct}% commission based on TikTok Live GMV (paid automatically through TikTok platform)`;
    return live;
  }
  const cur = f.currency === "USD" ? "$USD" : f.currency;
  let s = `Total fee of ${money(f.fee, f.currency)} (${cur})`;
  if (Number(f.commissionPct) > 0) {
    s += ` and ${f.commissionPct}% commission based on TikTok shoppable video GMV (paid automatically through TikTok platform)`;
  }
  return s;
}

export function fill(text: string, f: Fields): string {
  const blank = "__________";
  const vars: Record<string, string> = {
    product: f.product || blank,
    deliverables: deliverables(f),
    count: String(f.deliverableCount),
    start_date: longDate(f.startDate) || blank,
    end_date: longDate(f.endDate) || blank,
    paid_usage: `${f.paidUsageDays} days`,
    fee_terms: feeTerms(f),
    handle: f.handle ? `@${f.handle}` : blank,
  };
  return text.replace(/\{\{\s*(\w+)\s*\}\}/g, (all, k) => vars[k] ?? all);
}

export type Block = { type: "h" | "li" | "p"; text: string };

export function parseBody(body: string): Block[] {
  const blocks: Block[] = [];
  for (const raw of body.split("\n")) {
    const line = raw.trim();
    if (!line) continue;
    if (line.startsWith("## ")) blocks.push({ type: "h", text: line.slice(3) });
    else if (line.startsWith("- ")) blocks.push({ type: "li", text: line.slice(2) });
    else blocks.push({ type: "p", text: line });
  }
  return blocks;
}

const norm = (s: string) => s.replace(/\s+/g, " ").trim();

/** How a deal's clause differs from the standard template (video and live clause ids never overlap). */
export function clauseState(c: Clause): "standard" | "modified" | "added" {
  const base = DEFAULT_CLAUSES.find((d) => d.id === c.id) ?? LIVE_CLAUSES.find((d) => d.id === c.id);
  if (!base) return "added";
  return norm(base.body) === norm(c.body) && norm(base.title) === norm(c.title) ? "standard" : "modified";
}

/** Number of clauses changed, added or removed relative to the standard template of that contract type. */
export function customCount(clauses: Clause[], kind?: Kind): number {
  const changed = clauses.filter((c) => clauseState(c) !== "standard").length;
  const removed = defaultClauses(kind).filter((d) => !clauses.some((c) => c.id === d.id)).length;
  return changed + removed;
}

/** Canonical text of what the creator agrees to; hashed at signing. */
export function canonicalDocument(f: Fields, clauses: Clause[]): string {
  return JSON.stringify({
    client: CLIENT_NAME,
    fields: Object.fromEntries(Object.entries(f).sort(([a], [b]) => a.localeCompare(b))),
    clauses: clauses.map((c) => ({ title: c.title, body: fill(c.body, f) })),
  });
}
