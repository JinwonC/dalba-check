"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ContractDoc, InvoiceDoc } from "@/components/Document";
import { EMPTY_BILLING, type Billing, type Clause, type Fields } from "@/lib/template";
import { requestChanges, signDeal } from "./actions";

const BANK_FIELDS: { key: keyof Billing; label: string; hint?: string; required?: boolean; wide?: boolean }[] = [
  { key: "beneficiaryName", label: "Beneficiary name", hint: "Must match the legal name on the bank account", required: true, wide: true },
  { key: "beneficiaryAddress", label: "Beneficiary address", required: true, wide: true },
  { key: "bankName", label: "Bank name", required: true },
  { key: "accountNumber", label: "Bank account number", required: true },
  { key: "routingNumber", label: "Routing number (ABA)", hint: "US accounts" },
  { key: "swift", label: "SWIFT / BIC code" },
  { key: "iban", label: "IBAN", hint: "UK and EU accounts" },
  { key: "branchCode", label: "Bank branch / sort code" },
  { key: "bankAddress", label: "Bank address", wide: true },
];

export default function SignFlow({ token, fields, clauses }: { token: string; fields: Fields; clauses: Clause[] }) {
  const router = useRouter();
  const [billing, setBilling] = useState<Billing>(EMPTY_BILLING);
  const [name, setName] = useState("");
  const [title, setTitle] = useState("Content Creator");
  const [signature, setSignature] = useState("");
  const [consent, setConsent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [changing, setChanging] = useState(false);
  const [message, setMessage] = useState("");
  const [pending, start] = useTransition();

  const sign = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    start(async () => {
      const res = await signDeal(token, billing, { signature, name, title, consent });
      if ("error" in res) setError(res.error);
      else {
        router.refresh();
        window.scrollTo({ top: 0 });
      }
    });
  };

  const sendChanges = () => {
    setError(null);
    start(async () => {
      const res = await requestChanges(token, message);
      if ("error" in res) setError(res.error);
      else {
        setChanging(false);
        setMessage("");
        router.refresh();
        window.scrollTo({ top: 0 });
      }
    });
  };

  return (
    <form onSubmit={sign}>
      <h2 className="stepline">
        <span>1</span> Review the agreement
      </h2>
      <div className="paper-wrap">
        <ContractDoc fields={fields} clauses={clauses} />
      </div>

      <div className="card changes">
        {changing ? (
          <>
            <label className="field">
              <span>What should be changed?</span>
              <textarea rows={4} value={message} onChange={(e) => setMessage(e.target.value)} placeholder="e.g. The fee we agreed on was $350." />
            </label>
            <div className="row">
              <button type="button" className="btn btn-primary" disabled={pending} onClick={sendChanges}>
                Send to d&apos;Alba
              </button>
              <button type="button" className="btn btn-ghost" onClick={() => setChanging(false)}>
                Never mind
              </button>
            </div>
          </>
        ) : (
          <p>
            Something not right?{" "}
            <button type="button" className="linkish" onClick={() => setChanging(true)}>
              Request changes
            </button>{" "}
            instead of signing.
          </p>
        )}
      </div>

      <h2 className="stepline">
        <span>2</span> Your payment details
      </h2>
      <div className="card">
        <p className="hint">We use these to pay you and to fill in your invoice. Fill in what applies to your bank; leave the rest empty.</p>
        <div className="grid">
          {BANK_FIELDS.map((b) => (
            <label key={b.key} className={b.wide ? "field span-2" : "field"}>
              <span>
                {b.label}
                {b.required && " *"}
              </span>
              <input
                value={billing[b.key]}
                required={b.required}
                autoComplete="off"
                onChange={(e) => setBilling((p) => ({ ...p, [b.key]: e.target.value }))}
              />
              {b.hint && <small>{b.hint}</small>}
            </label>
          ))}
        </div>
      </div>

      <h2 className="stepline">
        <span>3</span> Check your invoice
      </h2>
      <p className="hint">We prepared this invoice for you from the agreement and the details above. You do not need to send your own.</p>
      <div className="paper-wrap">
        <InvoiceDoc fields={fields} billing={billing} />
      </div>

      <h2 className="stepline">
        <span>4</span> Sign
      </h2>
      <div className="card">
        <div className="grid">
          <label className="field">
            <span>Full legal name *</span>
            <input value={name} required onChange={(e) => setName(e.target.value)} autoComplete="name" />
          </label>
          <label className="field">
            <span>Title</span>
            <input value={title} onChange={(e) => setTitle(e.target.value)} />
          </label>
          <label className="field span-2">
            <span>Type your name to sign *</span>
            <input className="sig-input" value={signature} required onChange={(e) => setSignature(e.target.value)} placeholder="Your signature" autoComplete="off" />
          </label>
        </div>
        <label className="check">
          <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} required />
          <span>
            I have read and agree to this agreement, I confirm the invoice and payment details above are correct, and I agree that typing my
            name is my legal electronic signature.
          </span>
        </label>
        {error && <p className="alert alert-warn">{error}</p>}
        <button className="btn btn-primary btn-lg btn-block" disabled={pending}>
          {pending ? "Signing…" : "Sign agreement and confirm invoice"}
        </button>
      </div>
    </form>
  );
}
