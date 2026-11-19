import {
  CLIENT_NAME,
  campaignName,
  deliverables,
  itemLines,
  fill,
  longDate,
  money,
  parseBody,
  shortDate,
  type Billing,
  type Clause,
  type Fields,
  type Signature,
} from "@/lib/template";

// On-screen rendering of the agreement and invoice. Pure, so it works in both
// server components and the creator's client-side form (live invoice preview).

function Letterhead() {
  // eslint-disable-next-line @next/next/no-img-element
  return <img src="/logo.png" alt="d'Alba Talent" className="doc-logo" />;
}

const dash = (v?: string) => (v && v.trim() ? v : "—");

export function ClauseBody({ body, fields }: { body: string; fields: Fields }) {
  const blocks = parseBody(fill(body, fields));
  const out: React.ReactNode[] = [];
  let list: string[] = [];
  const flush = () => {
    if (list.length) {
      out.push(
        <ul key={`u${out.length}`}>
          {list.map((t, i) => (
            <li key={i}>{t}</li>
          ))}
        </ul>,
      );
      list = [];
    }
  };
  blocks.forEach((b, i) => {
    if (b.type === "li") return void list.push(b.text);
    flush();
    out.push(b.type === "h" ? <h4 key={i}>{b.text}</h4> : <p key={i}>{b.text}</p>);
  });
  flush();
  return <>{out}</>;
}

export function ContractDoc({
  fields,
  clauses,
  billing,
  signature,
}: {
  fields: Fields;
  clauses: Clause[];
  billing?: Billing | null;
  signature?: Signature | null;
}) {
  return (
    <article className="doc">
      <Letterhead />
      <table className="doc-summary">
        <tbody>
          <tr>
            <th>Talent / Agency</th>
            <td>{dash(fields.talentName)}</td>
          </tr>
          <tr>
            <th>Client</th>
            <td>{CLIENT_NAME}</td>
          </tr>
          <tr>
            <th>Effective Date</th>
            <td>{dash(longDate(fields.effectiveDate))}</td>
          </tr>
          <tr>
            <th>Scope of Work</th>
            <td>
              <div>Campaign Name: {campaignName(fields)}</div>
              <div>Date: {dash(longDate(fields.startDate))}</div>
              <div>Duration: {dash(longDate(fields.endDate))}</div>
              <div>Deliverable Details: {deliverables(fields)}</div>
              {itemLines(fields).map((l) => (
                <div key={l} className="doc-item">
                  {l}
                </div>
              ))}
              <div>Paid Usage: {fields.paidUsageDays} days</div>
            </td>
          </tr>
          <tr>
            <th>Billing Information</th>
            <td>
              {billing ? (
                <>
                  <div>Beneficiary Name: {dash(billing.beneficiaryName)}</div>
                  <div>Beneficiary Address: {dash(billing.beneficiaryAddress)}</div>
                  <div>Bank Name: {dash(billing.bankName)}</div>
                  <div>Bank Address: {dash(billing.bankAddress)}</div>
                  <div>
                    Bank Branch Code: {dash(billing.branchCode)} | Routing Number: {dash(billing.routingNumber)}
                  </div>
                  <div>SWIFT: {dash(billing.swift)}</div>
                  <div>Bank Account: {dash(billing.accountNumber)}</div>
                  <div>IBAN: {dash(billing.iban)}</div>
                </>
              ) : (
                <span className="muted">To be completed by Talent before signing.</span>
              )}
            </td>
          </tr>
        </tbody>
      </table>

      {clauses.map((c, i) => (
        <section key={c.id}>
          <h3>
            {i + 1}. {c.title}
          </h3>
          <ClauseBody body={c.body} fields={fields} />
        </section>
      ))}

      <section className="doc-sign">
        <p>
          <strong>IN WITNESS WHEREOF, the Parties have executed this Agreement as of the Effective Date.</strong>
        </p>
        <p>
          <strong>Talent/Agency:</strong>
        </p>
        {signature ? (
          <>
            <p>
              Signature: <span className="sig">{signature.signature}</span>
            </p>
            <p>Name: {signature.name}</p>
            <p>Title: {signature.title}</p>
            <p>Date: {shortDate(signature.signedAt)}</p>
          </>
        ) : (
          <p className="muted">Signature, name, title and date are added when Talent signs.</p>
        )}
        <p style={{ marginTop: 16 }}>
          <strong>CLIENT: {CLIENT_NAME}</strong>
        </p>
        <p className="muted">Company seal and date are added by d&apos;Alba after Talent signs.</p>
      </section>
    </article>
  );
}

export function InvoiceDoc({
  fields,
  billing,
  invoiceNumber,
  issueDate,
}: {
  fields: Fields;
  billing: Billing;
  invoiceNumber?: string | null;
  issueDate?: string | Date | null;
}) {
  const total = money(fields.fee, fields.currency);
  return (
    <article className="doc invoice">
      <Letterhead />
      <h2>INVOICE</h2>
      <p>
        {invoiceNumber && (
          <>
            <strong>Invoice No.:</strong> {invoiceNumber}
            <br />
          </>
        )}
        <strong>Issue Date:</strong>{" "}
        {issueDate ? shortDate(issueDate) : <span className="muted">the date you sign</span>}
      </p>
      <p>
        <strong>From</strong>
        <br />
        Creator Name: {dash(billing.beneficiaryName)}
        <br />
        Address: {dash(billing.beneficiaryAddress)}
      </p>
      <p>
        <strong>Bill To</strong>
        <br />
        {CLIENT_NAME}
      </p>
      <table className="inv-table">
        <thead>
          <tr>
            <th>Description</th>
            <th>Quantity</th>
            <th>Amount</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>{fields.invoiceDescription}</td>
            <td>1</td>
            <td>{total}</td>
          </tr>
        </tbody>
        <tfoot>
          <tr>
            <td />
            <th>Total Due</th>
            <td>{total}</td>
          </tr>
        </tfoot>
      </table>
      <h4 className="inv-bank">Bank Transfer Information</h4>
      <p>
        Beneficiary Name: {dash(billing.beneficiaryName)}
        <br />
        Bank Name: {dash(billing.bankName)}
        <br />
        Bank Address: {dash(billing.bankAddress)}
        <br />
        Bank Branch Code: {dash(billing.branchCode)}
        <br />
        SWIFT Code: {dash(billing.swift)}
        <br />
        Bank Account Number: {dash(billing.accountNumber)}
        <br />
        Routing Number (ABA): {dash(billing.routingNumber)}
        <br />
        IBAN: {dash(billing.iban)}
      </p>
    </article>
  );
}
