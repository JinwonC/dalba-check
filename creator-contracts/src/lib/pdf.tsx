import path from "node:path";
import fs from "node:fs";
import React from "react";
import { Document, Image, Page, StyleSheet, Text, View, renderToBuffer } from "@react-pdf/renderer";
import {
  CLIENT_NAME,
  campaignName,
  deliverables,
  invoiceLine,
  isLive,
  periodText,
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
} from "./template";

// Server-side PDF of the signed agreement + invoice + signature record.
// Laid out to match the existing paper template (Letter, Times).

let logo: Buffer | null = null;
function logoData(): Buffer {
  if (!logo) logo = fs.readFileSync(path.join(process.cwd(), "public", "logo.png"));
  return logo;
}

const s = StyleSheet.create({
  page: { paddingTop: 96, paddingBottom: 56, paddingHorizontal: 72, fontFamily: "Times-Roman", fontSize: 11, lineHeight: 1.3 },
  logo: { position: "absolute", top: 20, left: 246, width: 120, height: 46 },
  footer: { position: "absolute", bottom: 24, left: 72, right: 72, fontSize: 8, color: "#777", textAlign: "center" },
  table: { borderWidth: 0.75, borderColor: "#000", marginBottom: 14 },
  row: { flexDirection: "row", borderBottomWidth: 0.75, borderColor: "#000" },
  rowLast: { flexDirection: "row" },
  th: { width: 116, padding: 4, fontFamily: "Times-Bold", borderRightWidth: 0.75, borderColor: "#000" },
  td: { flex: 1, padding: 4 },
  b: { fontFamily: "Times-Bold" },
  h1: { fontFamily: "Times-Bold", fontSize: 13, marginTop: 12, marginBottom: 4 },
  h2: { fontFamily: "Times-Bold", marginTop: 4, marginBottom: 3 },
  p: { marginBottom: 6 },
  li: { flexDirection: "row", marginBottom: 4, paddingLeft: 18 },
  bullet: { width: 16 },
  liText: { flex: 1 },
  sigLine: { marginBottom: 6 },
  sig: { fontFamily: "Times-Italic", fontSize: 14 },
  invTitle: { fontFamily: "Times-Bold", fontSize: 20, textAlign: "center", marginBottom: 18 },
  invHead: { flexDirection: "row", backgroundColor: "#f0f0f0", borderBottomWidth: 1, borderColor: "#888", paddingVertical: 6, paddingHorizontal: 4, marginTop: 14 },
  invRow: { flexDirection: "row", paddingVertical: 8, paddingHorizontal: 4, borderBottomWidth: 0.5, borderColor: "#bbb", minHeight: 60 },
  c1: { flex: 1 },
  c2: { width: 90, textAlign: "center" },
  c3: { width: 90, textAlign: "right" },
  cp: { width: 120, fontSize: 9.5 },
  cq: { width: 62, textAlign: "center", fontSize: 10 },
  small: { fontSize: 9, color: "#444" },
  mono: { fontFamily: "Courier", fontSize: 8 },
});

const dash = (v?: string) => (v && v.trim() ? v : "N/A");

function Chrome() {
  return (
    <>
      <Image src={logoData()} style={s.logo} fixed />
      <Text style={s.footer} fixed render={({ pageNumber, totalPages }) => `${pageNumber} / ${totalPages}`} />
    </>
  );
}

function Row({ label, last, children }: { label: string; last?: boolean; children: React.ReactNode }) {
  return (
    <View style={last ? s.rowLast : s.row} wrap={false}>
      <Text style={s.th}>{label}</Text>
      <View style={s.td}>{children}</View>
    </View>
  );
}

function ClauseBlocks({ body, fields }: { body: string; fields: Fields }) {
  return (
    <>
      {parseBody(fill(body, fields)).map((b, i) =>
        b.type === "h" ? (
          <Text key={i} style={s.h2} minPresenceAhead={30}>
            {b.text}
          </Text>
        ) : b.type === "li" ? (
          <View key={i} style={s.li}>
            <Text style={s.bullet}>•</Text>
            <Text style={s.liText}>{b.text}</Text>
          </View>
        ) : (
          <Text key={i} style={s.p}>
            {b.text}
          </Text>
        ),
      )}
    </>
  );
}

export type PdfInput = {
  fields: Fields;
  clauses: Clause[];
  billing: Billing;
  signature: Signature;
  invoiceNumber: string | null;
  issueDate: Date | null;
  dealId: string;
};

function DealPdf({ fields, clauses, billing, signature, invoiceNumber, issueDate, dealId }: PdfInput) {
  const total = money(fields.fee, fields.currency);
  return (
    <Document title={`d'Alba x ${fields.handle} agreement`} author={CLIENT_NAME}>
      <Page size="LETTER" style={s.page}>
        <Chrome />
        <View style={s.table}>
          <Row label="Talent/ Agency">
            <Text>{fields.talentName}</Text>
          </Row>
          <Row label="Client">
            <Text>{CLIENT_NAME}</Text>
          </Row>
          <Row label="Effective Date">
            <Text style={s.b}>{isLive(fields) ? periodText(fields) : longDate(fields.effectiveDate)}</Text>
          </Row>
          <Row label="Scope of Work">
            <Text style={s.p}>Campaign Name: {campaignName(fields)}</Text>
            {isLive(fields) ? (
              <>
                <Text style={[s.b, s.p]}>Date and Time: {fields.liveSchedule || ""}</Text>
                <Text style={[s.b, s.p]}>Session Length: {fields.sessionLength || ""}</Text>
                <Text style={[s.b, s.p]}>Total Hours: {fields.hours || 0} hours</Text>
                <Text>Exclusive Live with d&apos;Alba only (during d&apos;Alba live session showcase)</Text>
              </>
            ) : (
              <>
                <Text style={[s.b, s.p]}>Date: {longDate(fields.startDate)}</Text>
                <Text style={[s.b, s.p]}>Duration: {longDate(fields.endDate)}</Text>
                <Text style={[s.b, s.p]}>Deliverable Details: {deliverables(fields)}</Text>
                {itemLines(fields).map((l) => (
                  <Text key={l} style={[s.p, { paddingLeft: 12 }]}>
                    {l}
                  </Text>
                ))}
                <Text style={s.b}>Paid Usage: {fields.paidUsageDays} days</Text>
              </>
            )}
          </Row>
          <Row label="Billing Information" last>
            <Text style={s.b}>Beneficiary Name: {dash(billing.beneficiaryName)}</Text>
            <Text style={s.b}>Beneficiary Address: {dash(billing.beneficiaryAddress)}</Text>
            <Text style={s.b}>
              Bank Branch Code: {dash(billing.branchCode)} | Routing Number: {dash(billing.routingNumber)}
            </Text>
            <Text style={s.b}>Bank Name: {dash(billing.bankName)}</Text>
            <Text style={s.b}>Bank Address: {dash(billing.bankAddress)}</Text>
            <Text style={s.b}>Swift NO.: {dash(billing.swift)}</Text>
            <Text style={s.b}>Bank Account: {dash(billing.accountNumber)}</Text>
            <Text style={s.b}>IBAN: {dash(billing.iban)}</Text>
          </Row>
        </View>

        {clauses.map((c, i) => (
          <View key={c.id}>
            <Text style={s.h1} minPresenceAhead={40}>
              {i + 1}. {c.title}
            </Text>
            <ClauseBlocks body={c.body} fields={fields} />
          </View>
        ))}

        <View wrap={false} style={{ marginTop: 22 }}>
          <Text style={[s.b, s.sigLine]}>IN WITNESS WHEREOF, the Parties have executed this Agreement as of the Effective Date.</Text>
          <Text style={[s.b, s.sigLine]}>Talent/Agency:</Text>
          <Text style={s.sigLine}>
            Signature: <Text style={s.sig}>{signature.signature}</Text>
          </Text>
          <Text style={s.sigLine}>Name: {signature.name}</Text>
          <Text style={s.sigLine}>Title: {signature.title}</Text>
          <Text style={s.sigLine}>Date: {shortDate(signature.signedAt)}</Text>
          <Text style={[s.sigLine, { marginTop: 22 }]}>CLIENT: {CLIENT_NAME}</Text>
          <Text style={[s.sigLine, { marginTop: 26 }]}>Signature: ______________________________</Text>
          <Text style={s.sigLine}>Date: ______________________________</Text>
        </View>
      </Page>

      <Page size="LETTER" style={s.page}>
        <Chrome />
        <Text style={s.invTitle}>INVOICE</Text>
        {invoiceNumber && (
          <Text>
            <Text style={s.b}>Invoice No.: </Text>
            {invoiceNumber}
          </Text>
        )}
        <Text style={{ marginBottom: 16 }}>
          <Text style={s.b}>Issue Date: </Text>
          {issueDate ? shortDate(issueDate) : ""}
        </Text>
        <Text style={s.b}>From</Text>
        <Text style={s.b}>Creator Name: {billing.beneficiaryName}</Text>
        <Text style={[s.b, { marginBottom: 16 }]}>Address: {billing.beneficiaryAddress}</Text>
        <Text style={s.b}>Bill To</Text>
        <Text style={s.b}>{CLIENT_NAME}</Text>

        <View style={s.invHead}>
          <Text style={[s.c1, s.b]}>DESCRIPTION</Text>
          {isLive(fields) && <Text style={[s.cp, s.b]}>SERVICE PERIOD</Text>}
          {isLive(fields) && <Text style={[s.cq, s.b]}>QTY (HOURS)</Text>}
          {isLive(fields) && <Text style={[s.cq, s.b]}>RATE</Text>}
          <Text style={[s.c3, s.b]}>AMOUNT</Text>
        </View>
        <View style={s.invRow}>
          <Text style={s.c1}>{invoiceLine(fields)}</Text>
          {isLive(fields) && <Text style={s.cp}>{periodText(fields)}</Text>}
          {isLive(fields) && <Text style={s.cq}>{fields.hours || 0}</Text>}
          {isLive(fields) && <Text style={s.cq}>{money(Number(fields.hourlyRate) || 0, fields.currency)}</Text>}
          <Text style={s.c3}>{total}</Text>
        </View>
        <View style={{ flexDirection: "row", paddingVertical: 8, paddingHorizontal: 4 }}>
          <Text style={[s.c1, s.b, { textAlign: "right", paddingRight: 16 }]}>TOTAL DUE</Text>
          <Text style={[s.c3, s.b, { borderBottomWidth: 0.75, borderColor: "#888" }]}>{total}</Text>
        </View>

        <Text style={[s.b, { marginTop: 18, paddingBottom: 3, marginBottom: 8, borderBottomWidth: 0.75, borderColor: "#888" }]}>
          BANK TRANSFER INFORMATION
        </Text>
        <Text style={s.b}>Beneficiary Name: {dash(billing.beneficiaryName)}</Text>
        <Text style={s.b}>Bank Name: {dash(billing.bankName)}</Text>
        <Text style={s.b}>Bank Address: {dash(billing.bankAddress)}</Text>
        <Text style={s.b}>Bank Branch Code: {dash(billing.branchCode)}</Text>
        <Text style={s.b}>SWIFT Code: {dash(billing.swift)}</Text>
        <Text style={s.b}>Bank Account Number: {dash(billing.accountNumber)}</Text>
        <Text style={s.b}>Routing Number (ABA): {dash(billing.routingNumber)}</Text>
        <Text style={s.b}>IBAN: {dash(billing.iban)}</Text>
      </Page>

      <Page size="LETTER" style={s.page}>
        <Chrome />
        <Text style={s.h1}>Electronic Signature Record</Text>
        <Text style={[s.p, s.small]}>
          This page records how the Talent signed the agreement above. The Talent reviewed the agreement and invoice online, confirmed
          consent to sign electronically, and typed their name as their signature.
        </Text>
        <View style={s.table}>
          <Row label="Signed by">
            <Text>{signature.name}</Text>
          </Row>
          <Row label="Typed signature">
            <Text>{signature.signature}</Text>
          </Row>
          <Row label="Title">
            <Text>{signature.title}</Text>
          </Row>
          <Row label="Signed at (UTC)">
            <Text>{new Date(signature.signedAt).toISOString()}</Text>
          </Row>
          <Row label="IP address">
            <Text>{signature.ip || "unknown"}</Text>
          </Row>
          <Row label="Browser">
            <Text style={s.small}>{signature.userAgent || "unknown"}</Text>
          </Row>
          <Row label="Document ID">
            <Text style={s.mono}>{dealId}</Text>
          </Row>
          <Row label="Document SHA-256" last>
            <Text style={s.mono}>{signature.docHash}</Text>
          </Row>
        </View>
      </Page>
    </Document>
  );
}

export async function renderDealPdf(input: PdfInput): Promise<Buffer> {
  return renderToBuffer(<DealPdf {...input} />);
}

export function pdfFileName(fields: Fields, suffix: string): string {
  const handle = fields.handle.replace(/[^\w.-]+/g, "_") || "creator";
  return `dAlba_x_${handle}_contract_${suffix}.pdf`;
}
