import Link from "next/link";
import { getT } from "@/lib/lang";

export const dynamic = "force-dynamic";

type Who = "me" | "creator" | "finance";
type Act = { who: Who; text: string };
type StepDef = { n: string; title: string; acts: Act[]; auto: string[]; sheet?: string };

const STEPS: StepDef[] = [
  {
    n: "0",
    title: "Create the agreement and send the link",
    acts: [{ who: "me", text: "In “+ New agreement”, enter the handle, videos per product, dates and fee → “Save and create link” → send the link to the creator." }],
    auto: ["The agreement and the invoice are created together.", "Clauses can be edited per creator."],
  },
  {
    n: "1",
    title: "Creator signs",
    acts: [
      { who: "creator", text: "Opens the link, reviews the agreement, enters bank details, checks the invoice, and types their name to sign." },
      { who: "me", text: "Nothing to do. Wait for the notification email." },
    ],
    auto: ["The signed PDF (agreement + invoice) is ready.", "You get a sign notification in your NAVER WORKS mailbox."],
  },
  {
    n: "2",
    title: "Company stamp (계약서 상신)",
    acts: [
      { who: "me", text: "“Save to Google Drive” → “Request stamp”." },
      { who: "finance", text: "Puts the stamped copy in the same Drive folder." },
      { who: "me", text: "When the stamped copy is there, click “Company stamp received”." },
    ],
    auto: ["The signed PDF is saved to the team Drive folder.", "A row is added to the work-request sheet."],
    sheet: "계약서 상신 · 계약서 1건 날인 요청 @handle · folder link",
  },
  {
    n: "3",
    title: "Content",
    acts: [
      { who: "creator", text: "Each time they post, they paste the video link on the same link they signed with." },
      { who: "me", text: "When every video is in, click “Content complete”." },
    ],
    auto: ["Shows progress such as “3 of 10 submitted, 7 left”.", "You can add links the creator sent you directly."],
  },
  {
    n: "4",
    title: "Transfer request (지출결의서 상신)",
    acts: [{ who: "me", text: "Enter the request date, the expected transfer date, and the purpose and expected effect → “Transfer requested”." }],
    auto: ["Creator, fee and video links are filled in for you.", "The folder link from step 2 is reused.", "A row is added to the work-request sheet."],
  },
  {
    n: "5",
    title: "Transfer sent",
    acts: [
      { who: "finance", text: "Sends the transfer on the expected date." },
      { who: "me", text: "After confirming the transfer, click “Transfer sent”." },
    ],
    auto: ["If the expected date passes, the dashboard shows it in red.", "The deal moves to Completed."],
  },
];

const NEXT: { state: string; who: Who }[] = [
  { state: "Link sent, not signed yet", who: "creator" },
  { state: "Signed → request the stamp", who: "me" },
  { state: "Stamp requested", who: "finance" },
  { state: "Videos being posted", who: "creator" },
  { state: "All videos in → mark complete, request transfer", who: "me" },
  { state: "Transfer requested", who: "finance" },
];

const REMEMBER = [
  "Sign in with the same ID and password as the outreach tool.",
  "One link for the creator: signing and video links use the same link.",
  "One Drive folder per contract: the stamp request and the transfer request use the same folder.",
  "Keep the “need your action” number at the top of the dashboard at 0.",
  "After the creator signs, the agreement can no longer be edited.",
];

export default async function GuidePage() {
  const { t } = await getT();
  const whoLabel: Record<Who, string> = { me: t("Manager (me)"), creator: t("Creator"), finance: t("Finance team") };
  return (
    <>
      <p className="crumbs">
        <Link href="/">{t("← Agreements")}</Link>
      </p>
      <header className="hero">
        <p className="kicker">{t("d'Alba · creator partnerships")}</p>
        <h1>{t("How a creator contract works")}</h1>
        <p className="hero-sub">{t("From signing the agreement and invoice to the transfer, in five steps. No files back and forth: one link does it.")}</p>
        <div className="guide-legend">
          <span>{t("Who does it?")}</span>
          <span className="gwho gwho-me">{whoLabel.me}</span>
          <span className="gwho gwho-creator">{whoLabel.creator}</span>
          <span className="gwho gwho-finance">{whoLabel.finance}</span>
          <span className="gwho gwho-auto">{t("Done automatically")}</span>
        </div>
      </header>

      <div className="guide-steps">
        {STEPS.map((s) => (
          <section key={s.n} className="guide-step">
            <div className={s.n === "0" ? "guide-num prep" : "guide-num"}>
              {s.n === "0" ? <b>{t("Prep")}</b> : <b>{s.n}</b>}
              {s.n !== "0" && <span>STEP</span>}
            </div>
            <div className="guide-body">
              <h2>{t(s.title)}</h2>
              {s.acts.map((a, i) => (
                <div key={i} className="guide-act">
                  <span className={`gwho gwho-${a.who}`}>{whoLabel[a.who]}</span>
                  <span>{t(a.text)}</span>
                </div>
              ))}
            </div>
            <aside className="guide-auto">
              <h3>{t("Automatic")}</h3>
              <ul>
                {s.auto.map((x) => (
                  <li key={x}>{t(x)}</li>
                ))}
              </ul>
              {s.sheet && <code className="guide-sheet">{t(s.sheet)}</code>}
            </aside>
          </section>
        ))}
      </div>

      <div className="guide-foot">
        <section className="card">
          <h2>{t("Reading “Next step” on the dashboard")}</h2>
          <table className="guide-table">
            <tbody>
              {NEXT.map((n) => (
                <tr key={n.state}>
                  <td>{t(n.state)}</td>
                  <td>
                    <span className={`gwho gwho-${n.who}`}>{whoLabel[n.who]}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
        <section className="card">
          <h2>{t("Things to remember")}</h2>
          <ul className="guide-list">
            {REMEMBER.map((r) => (
              <li key={r}>{t(r)}</li>
            ))}
          </ul>
        </section>
      </div>
    </>
  );
}
